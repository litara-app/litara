package com.litara.core.litara

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.io.File
import java.time.Instant
import java.util.UUID

/** What happened to one ebook position report. */
sealed interface EditionReportOutcome {
    /** Stored on this device only: the native renderer is not proven compatible with the snapshot's engine profile. */
    data class LocalOnly(val engineProfile: String) : EditionReportOutcome

    data object Accepted : EditionReportOutcome

    /** Network/server trouble: kept as the single pending write and retried with the SAME operation id. */
    data object Queued : EditionReportOutcome

    /** Another client advanced first (409 stale_revision). The server kept this write as a durable candidate. */
    data class Conflict(val conflictId: String) : EditionReportOutcome

    /** The bytes or locator profile no longer match (412). The candidate is preserved; nothing is reinterpreted. */
    data class ContentChanged(val code: String, val currentContentVersion: String?) : EditionReportOutcome

    data class AccessEnded(val code: String) : EditionReportOutcome
}

/** A reading location stored on this device for exactly one file version. Never applied to other bytes. */
@Serializable
data class LocalEditionPosition(val fileId: String, val contentVersion: String, val cfi: String, val fraction: Double, val savedAt: String)

/**
 * Revision-aware ebook position reporting for one edition (T005, ADR-0065). Every location is first stored
 * locally for the exact file/version; it is sent to the server only when [compatibleProfiles] contains the
 * snapshot's engine profile. The preserved native Foliate build is not yet proven to produce or consume
 * locators of the web profile (contracts/t005/README.md: ancestry is not compatibility evidence), so by
 * default nothing native is ever stored under that profile. The one pending write survives restarts.
 */
class EditionProgressSync(
    private val client: LitaraClient,
    private val editionId: String,
    private val fileId: String,
    private val contentVersion: String,
    private val engineProfile: String,
    private val compatibleProfiles: Set<String>,
    private val dir: File,
) {
    private val gate = Mutex()
    private val localFile = File(dir, "local-position.json")
    private val pendingFile = File(dir, "pending-position.json")

    var revision: String = "0"
        private set
    var unresolvedConflicts: Long = 0
        private set

    val canonical: Boolean get() = engineProfile in compatibleProfiles

    private fun adopt(s: LEditionPositionState) { revision = s.revision; unresolvedConflicts = s.unresolvedConflictCount }

    /** The device-local location for exactly this file version, or null (a position for other bytes is never returned). */
    fun local(): LocalEditionPosition? =
        localFile.takeIf { it.exists() }
            ?.let { runCatching { LitaraJson.decodeFromString<LocalEditionPosition>(it.readText()) }.getOrNull() }
            ?.takeIf { it.fileId == fileId && it.contentVersion == contentVersion }

    /** The server's saved CFI for exactly these bytes, but only when this renderer is allowed to read that profile. */
    suspend fun serverCfi(): String? = gate.withLock {
        if (!canonical) return null
        val state = try { client.editionPosition(editionId) } catch (_: TransientException) { return null }
        adopt(state)
        val a = state.position?.anchor ?: return null
        val loc = a.locator as? LLocator.FoliateCfi ?: return null
        if (a.fileId != fileId || a.contentVersion != contentVersion) return null
        loc.cfi
    }

    suspend fun report(cfi: String, fraction: Double): EditionReportOutcome = gate.withLock {
        val now = Instant.now().toString()
        AtomicFile.write(localFile, LitaraJson.encodeToString(LocalEditionPosition(fileId, contentVersion, cfi, fraction, now)))
        if (!canonical) return@withLock EditionReportOutcome.LocalOnly(engineProfile)
        flushPendingLocked()?.let { if (it !is EditionReportOutcome.Accepted) return@withLock it }
        send(LEditionPositionWrite(UUID.randomUUID().toString(), revision, LEditionAnchor(fileId, contentVersion, LLocator.FoliateCfi(cfi)), now))
    }

    /** Retries the saved write with its original operation id. Null when nothing was pending. */
    suspend fun flushPending(): EditionReportOutcome? = gate.withLock { flushPendingLocked() }

    fun hasPending(): Boolean = pendingFile.exists()

    private suspend fun flushPendingLocked(): EditionReportOutcome? = readPending()?.let { send(it) }

    private suspend fun send(w: LEditionPositionWrite): EditionReportOutcome = try {
        adopt(client.writeEditionPosition(editionId, w))
        pendingFile.delete()
        EditionReportOutcome.Accepted
    } catch (e: LitaraHttpException) {
        when {
            e.status == 409 && e.problem.code == "stale_revision" -> {
                pendingFile.delete() // the server preserved it as a durable candidate
                runCatching { client.editionPosition(editionId).also(::adopt) }
                EditionReportOutcome.Conflict(e.problem.conflictId.orEmpty())
            }
            e.status == 412 -> { pendingFile.delete(); EditionReportOutcome.ContentChanged(e.problem.code, e.problem.currentContentVersion) }
            e.status == 401 || e.status == 403 -> queue(w).let { EditionReportOutcome.AccessEnded(e.problem.code) }
            e.status in 500..599 || e.status == 429 -> queue(w)
            else -> throw e
        }
    } catch (_: TransientException) {
        queue(w)
    } catch (e: SessionEndedException) {
        queue(w)
        EditionReportOutcome.AccessEnded(e.code)
    }

    private fun queue(w: LEditionPositionWrite): EditionReportOutcome {
        AtomicFile.write(pendingFile, LitaraJson.encodeToString(w))
        return EditionReportOutcome.Queued
    }

    private fun readPending(): LEditionPositionWrite? =
        pendingFile.takeIf { it.exists() }?.let { runCatching { LitaraJson.decodeFromString<LEditionPositionWrite>(it.readText()) }.getOrNull() }
}
