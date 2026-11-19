package com.litara.core.litara

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.io.File
import java.time.Instant
import java.util.UUID

/** What happened to one manual finish/unfinish request. */
sealed interface EditionCompletionOutcome {
    data class Accepted(val completion: LCompletion) : EditionCompletionOutcome

    /**
     * An EARLIER saved write was delivered instead of the new request, which was not sent. The caller shows the
     * resulting state and lets the user act again; two intents are never stacked.
     */
    data class EarlierDelivered(val completion: LCompletion) : EditionCompletionOutcome

    /** Network/server trouble: the write is saved on disk and retried with the SAME operation id. */
    data object Queued : EditionCompletionOutcome

    /** Another client changed finished state first (409 stale_revision); the server kept this write as a candidate. */
    data class Conflict(val conflictId: String, val currentRevision: String?) : EditionCompletionOutcome

    /** The file bytes changed (412); the candidate is kept and not applied to the new version. */
    data class ContentChanged(val code: String, val currentContentVersion: String?) : EditionCompletionOutcome

    data class AccessEnded(val code: String) : EditionCompletionOutcome
}

/**
 * Manual finish/unfinish for one edition (T005, ADR-0065/0066). The write is saved to disk with its operation
 * id, base revision and file/version BEFORE it is sent, so a process death or a lost response is retried as the
 * same operation. Only one write per edition is outstanding: a new request first retries the saved one and, if
 * that cannot be delivered, reports [EditionCompletionOutcome.Queued] instead of stacking a second intent behind it.
 * Completion is independent of the reading position and does not depend on locator compatibility.
 */
class EditionCompletionSync(
    private val client: LitaraClient,
    private val editionId: String,
    private val fileId: String,
    private val contentVersion: String,
    private val pendingFile: File,
) {
    private val gate = Mutex()

    fun hasPending(): Boolean = pendingFile.exists()

    /** [finished] true marks the edition finished; [baseRevision] is the completion revision the caller last saw. */
    suspend fun submit(finished: Boolean, baseRevision: String): EditionCompletionOutcome = gate.withLock {
        readPending()?.let {
            val outcome = send(it)
            return@withLock if (outcome is EditionCompletionOutcome.Accepted) EditionCompletionOutcome.EarlierDelivered(outcome.completion) else outcome
        }
        val w = LEditionCompletionWrite(UUID.randomUUID().toString(), baseRevision, fileId, contentVersion,
            if (finished) "manual_finish" else "manual_unfinish", Instant.now().toString())
        AtomicFile.write(pendingFile, LitaraJson.encodeToString(w)) // durable before the network
        send(w)
    }

    /** Retries the saved write with its original operation id. Null when nothing was pending. */
    suspend fun flush(): EditionCompletionOutcome? = gate.withLock { readPending()?.let { send(it) } }

    private suspend fun send(w: LEditionCompletionWrite): EditionCompletionOutcome = try {
        val c = client.writeEditionCompletion(editionId, w)
        pendingFile.delete()
        EditionCompletionOutcome.Accepted(c)
    } catch (e: LitaraHttpException) {
        when {
            e.status == 409 && e.problem.code == "stale_revision" -> {
                pendingFile.delete() // the server preserved it as a durable candidate
                EditionCompletionOutcome.Conflict(e.problem.conflictId.orEmpty(), e.problem.currentRevision)
            }
            e.status == 412 -> { pendingFile.delete(); EditionCompletionOutcome.ContentChanged(e.problem.code, e.problem.currentContentVersion) }
            e.status == 401 || e.status == 403 -> EditionCompletionOutcome.AccessEnded(e.problem.code) // saved write stays, locked with the scope
            e.status in 500..599 || e.status == 429 -> EditionCompletionOutcome.Queued
            else -> throw e
        }
    } catch (_: TransientException) {
        EditionCompletionOutcome.Queued
    } catch (e: SessionEndedException) {
        EditionCompletionOutcome.AccessEnded(e.code)
    }

    private fun readPending(): LEditionCompletionWrite? =
        pendingFile.takeIf { it.exists() }?.let { runCatching { LitaraJson.decodeFromString<LEditionCompletionWrite>(it.readText()) }.getOrNull() }
}
