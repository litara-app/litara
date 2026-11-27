package com.litara.core.litara

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.io.File
import java.time.Instant
import java.util.UUID

@Serializable
enum class SessionKind { READ, LISTEN }

/**
 * One reading or listening session as known so far (ADR-0092, ADR-0109). [targetId] is the edition or the recording.
 * It is sent repeatedly under the same [sessionId]; the server keeps the longest one it has seen.
 */
@Serializable
data class SessionEntry(
    val sessionId: String,
    val kind: SessionKind,
    val targetId: String,
    val startedAtMs: Long,
    val endedAtMs: Long,
    val seconds: Long,
    val startFraction: Double? = null,
    val endFraction: Double? = null,
)

@Serializable
data class LReadingSessionWrite(val startedAt: String, val endedAt: String, val activeSeconds: Long, val startFraction: Double? = null, val endFraction: Double? = null)

@Serializable
data class LListeningSessionWrite(val startedAt: String, val endedAt: String, val listenedSeconds: Long, val startFraction: Double? = null, val endFraction: Double? = null)

/**
 * Counts the time of one open session.
 *
 * Call [active] whenever there is evidence the person is still reading or the audio is still playing, and [pause] when
 * it stops. Time is the wall-clock time between those calls. A stretch longer than [maxStepMs] counts as [maxStepMs]
 * when [countCappedStep] (reading: a page stays "active" for two minutes after the last sign of life), and not at all
 * otherwise (listening: a long silence means the device slept). More than [gapMs] without activity ends the session.
 */
class SessionClock(
    private val kind: SessionKind,
    private val maxStepMs: Long,
    private val countCappedStep: Boolean,
    private val gapMs: Long = SESSION_GAP_MS,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    private var entry: SessionEntry? = null
    private var countedFromMs: Long? = null
    private var lastActiveMs = 0L
    private var millis = 0L

    val targetId: String? get() = entry?.targetId

    /** Records activity on [target]. Returns the previous session when this call ended it, so it can still be sent. */
    fun active(target: String, fraction: Double?, nowMs: Long): SessionEntry? {
        var finished: SessionEntry? = null
        val cur = entry
        if (cur != null && (cur.targetId != target || nowMs - lastActiveMs > gapMs || nowMs - cur.startedAtMs > MAX_SESSION_MS)) {
            count(nowMs)
            finished = snapshot()
            entry = null
        }
        if (entry == null) {
            entry = SessionEntry(newId(), kind, target, nowMs, nowMs, 0, fraction, fraction)
            millis = 0
            countedFromMs = null
        }
        count(nowMs)
        countedFromMs = nowMs
        lastActiveMs = nowMs
        if (fraction != null) {
            val e = entry!!
            entry = e.copy(startFraction = e.startFraction ?: fraction, endFraction = fraction)
        }
        return finished
    }

    /** Counts up to now and stops counting until the next [active]. */
    fun pause(nowMs: Long) {
        count(nowMs)
        countedFromMs = null
    }

    /** The open session, or null when there is none or it is too short to keep. */
    fun snapshot(): SessionEntry? = entry?.copy(seconds = millis / 1000)?.takeIf { it.seconds >= MIN_SECONDS }

    /** Ends the session. */
    fun end(nowMs: Long): SessionEntry? {
        count(nowMs)
        val out = snapshot()
        entry = null
        countedFromMs = null
        return out
    }

    private fun count(nowMs: Long) {
        val from = countedFromMs ?: return
        val e = entry ?: return
        var step = nowMs - from
        if (step <= 0) return
        if (step > maxStepMs) step = if (countCappedStep) maxStepMs else 0
        countedFromMs = nowMs
        if (step == 0L) return
        millis += step
        entry = e.copy(endedAtMs = minOf(nowMs, from + step))
    }

    companion object {
        const val SESSION_GAP_MS = 30 * 60_000L
        const val MIN_SECONDS = 5L
        /** The server refuses a session longer than 24 hours. */
        const val MAX_SESSION_MS = 23 * 3600_000L

        fun listening() = SessionClock(SessionKind.LISTEN, maxStepMs = 90_000, countCappedStep = false)
        fun reading() = SessionClock(SessionKind.READ, maxStepMs = 120_000, countCappedStep = true)
    }
}

/**
 * Sessions waiting to be sent, one file each, in the signed-in account's own directory (ADR-0109: Android keeps unsent
 * sessions and sends them when it can). A later save of the same session replaces the earlier one.
 */
class SessionOutbox(private val dir: File, private val nowMs: () -> Long = System::currentTimeMillis) {
    private fun file(id: String) = File(dir, "$id.json")

    fun put(e: SessionEntry) = synchronized(LOCK) { AtomicFile.write(file(e.sessionId), LitaraJson.encodeToString(e)) }

    fun all(): List<SessionEntry> = synchronized(LOCK) {
        dir.listFiles { f -> f.name.endsWith(".json") }.orEmpty()
            .mapNotNull { runCatching { LitaraJson.decodeFromString<SessionEntry>(it.readText()) }.getOrNull() }
            .sortedBy { it.startedAtMs }
    }

    /** Removes [sent] unless a longer version of it was saved while it was on its way. */
    private fun removeIfUnchanged(sent: SessionEntry) = synchronized(LOCK) {
        val f = file(sent.sessionId)
        val now = runCatching { LitaraJson.decodeFromString<SessionEntry>(f.readText()) }.getOrNull()
        if (now == sent) f.delete()
    }

    /**
     * Sends what is waiting. A session the server definitively refuses is dropped; anything else stays for later.
     * Returns true while sessions remain.
     */
    suspend fun flush(client: LitaraClient): Boolean = sending.withLock {
        for (e in all()) {
            try {
                client.putSession(e)
                removeIfUnchanged(e)
            } catch (x: LitaraHttpException) {
                if (refusedForGood(x.status, e)) removeIfUnchanged(e)
            } catch (_: TransientException) {
                return@withLock true
            } catch (_: SessionEndedException) {
                return@withLock true
            }
        }
        all().isNotEmpty()
    }

    /**
     * Whether retrying cannot change the answer. A revoked grant (403) keeps the session in case access returns. An
     * invalid session (422) is kept for a day first: the server refuses one that ends in its future, which a device
     * with a fast clock produces and which is accepted once the server's time catches up.
     */
    private fun refusedForGood(status: Int, e: SessionEntry): Boolean =
        status in REFUSED || (status == 422 && nowMs() - e.endedAtMs > DAY_MS)

    private companion object {
        val REFUSED = setOf(400, 404, 409, 410, 413)
        const val DAY_MS = 24 * 3600_000L
        val LOCK = Any()
        val sending = Mutex()
    }
}

internal fun SessionEntry.iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()
