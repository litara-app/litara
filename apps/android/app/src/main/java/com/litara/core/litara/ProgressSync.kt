package com.litara.core.litara

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.io.File
import java.time.Instant
import java.util.UUID

/** What happened to one position report. */
sealed interface ReportOutcome {
    data object Accepted : ReportOutcome

    /** Network/server trouble: kept as the single pending write and retried with the SAME operation id. */
    data object Queued : ReportOutcome

    /** Another device advanced first. The server preserved this write as a durable conflict. */
    data class Conflict(val conflictId: String) : ReportOutcome

    /** Layout or content changed (412). The candidate is preserved; refetch the snapshot before continuing. */
    data class SnapshotChanged(val code: String, val currentLayoutRevision: String?) : ReportOutcome

    /** The session ended or access was revoked; the caller must lock the account scope. */
    data class AccessEnded(val code: String) : ReportOutcome

    /**
     * The saved server position belongs to different bytes (same file id, other content version). Nothing is
     * written until the user explicitly chooses; the old position stays on the server untouched.
     */
    data class NeedsChoice(val saved: LPosition) : ReportOutcome
}

/**
 * Revision-aware position reporting for one recording (ADR-0036/0038): every write carries the last
 * known server revision and the snapshot's layout revision; offsets are file/version relative.
 * Device clocks never order writes. One pending write survives restarts in [pendingFile].
 */
class ProgressSync(
    private val client: LitaraClient,
    private val recordingId: String,
    layoutRevision: String,
    private val files: List<LFile>,
    private val pendingFile: File,
) {
    /** One request in flight per recording: overlapping reports from this device must not race each other into a self-conflict. */
    private val gate = Mutex()

    var layout: String = layoutRevision
        private set
    var revision: String = "0"
        private set
    var conflicts: List<LConflict> = emptyList()
        private set
    var position: LPosition? = null
        private set

    private var startOverConfirmed = false

    private var loaded = false

    private fun adopt(state: LPositionState) {
        loaded = true
        revision = state.revision
        position = state.position
        conflicts = state.unresolvedConflicts
    }

    /**
     * The saved position if its file/version still exists in this snapshot (a compatible reorder keeps it
     * valid because offsets are file-relative); null if there is none or it belongs to other bytes (ADR-0019/0040).
     */
    fun resumeCandidate(): LPosition? = position?.takeIf { p -> files.any { it.id == p.fileId && it.contentVersion == p.contentVersion } }

    /** A saved position that no longer matches this snapshot's bytes; it is preserved, never reinterpreted. */
    fun incompatiblePosition(): LPosition? = position?.takeIf { it != resumeCandidate() }

    /** The user chose to start over from the current bytes; the next report may replace the saved position. */
    fun confirmStartOver() { startOverConfirmed = true }

    /** Reads server state (and any unresolved conflicts, which survive app restarts). */
    suspend fun load(): LPositionState = gate.withLock { client.position(recordingId).also(::adopt) }

    /**
     * Learns the server revision once, best effort. A reporter that has never read the server would send base
     * revision 0 and conflict with its own device (for example after a chapter jump rebuilds the queue).
     */
    suspend fun ensureLoaded() {
        if (loaded) return
        try { load() } catch (_: TransientException) { } catch (_: SessionEndedException) { }
    }

    /** Index into [files] of the anchored file, or null if the anchor is not a member. */
    fun indexOf(fileId: String): Int? = files.indexOfFirst { it.id == fileId }.takeIf { it >= 0 }

    suspend fun report(fileIndex: Int, offsetMs: Long): ReportOutcome = gate.withLock {
        incompatiblePosition()?.takeIf { !startOverConfirmed }?.let { return@withLock ReportOutcome.NeedsChoice(it) }
        flushPendingLocked()?.let { if (it !is ReportOutcome.Accepted) return@withLock it }
        val f = files[fileIndex]
        val max = f.durationMs ?: Long.MAX_VALUE
        val write = LPositionWrite(UUID.randomUUID().toString(), revision, layout,
            LPositionInput(f.id, f.contentVersion, offsetMs.coerceIn(0, max), Instant.now().toString()))
        send(write)
    }

    /** Retries the saved write with its original operation id. Null when nothing was pending. */
    suspend fun flushPending(): ReportOutcome? = gate.withLock { flushPendingLocked() }

    private suspend fun flushPendingLocked(): ReportOutcome? {
        val write = readPending() ?: return null
        // The saved base revision may be stale if this device raced itself; the server decides (409 + conflict).
        return send(write)
    }

    private suspend fun send(write: LPositionWrite): ReportOutcome = try {
        adopt(client.writePosition(recordingId, write))
        clearPending()
        ReportOutcome.Accepted
    } catch (e: LitaraHttpException) {
        clearPending() // the server answered definitively and preserved the candidate
        when {
            e.status == 409 && e.problem.code == "position_conflict" ->
                ReportOutcome.Conflict(e.problem.conflictId.orEmpty()).also { runCatching { client.position(recordingId).also(::adopt) } }
            e.status == 412 -> ReportOutcome.SnapshotChanged(e.problem.code, e.problem.currentLayoutRevision)
            e.status == 403 -> ReportOutcome.AccessEnded(e.problem.code)
            e.status in 500..599 || e.status == 429 -> queue(write)
            else -> throw e // 4xx validation: a programming error, not a retry case
        }
    } catch (e: TransientException) {
        queue(write)
    } catch (e: SessionEndedException) {
        queue(write) // keep the candidate locally (locked with the scope); nothing is uploaded under another account
        ReportOutcome.AccessEnded(e.code)
    }

    private fun queue(write: LPositionWrite): ReportOutcome {
        pendingFile.parentFile?.mkdirs()
        pendingFile.writeText(LitaraJson.encodeToString(write))
        return ReportOutcome.Queued
    }

    private fun readPending(): LPositionWrite? =
        pendingFile.takeIf { it.exists() }?.let { runCatching { LitaraJson.decodeFromString<LPositionWrite>(it.readText()) }.getOrNull() }

    private fun clearPending() { pendingFile.delete() }

    fun hasPending(): Boolean = pendingFile.exists()

    /** The user's explicit choice for one conflict; each is a new revision-aware operation. */
    suspend fun resolve(conflictId: String, choice: String, explicit: LPositionInput? = null): LPositionState = gate.withLock {
        val state = client.resolveConflict(recordingId, conflictId,
            LResolveConflict(UUID.randomUUID().toString(), revision, layout, choice, explicit))
        adopt(state)
        state
    }

    /** After a snapshot refresh the layout revision moves; callers re-validate their anchor first. */
    fun updateLayout(newLayout: String) { layout = newLayout }
}
