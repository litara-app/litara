package com.litara.core.litara

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.time.Instant
import java.util.UUID

/** What happened to one completion event. */
sealed interface FinishOutcome {
    data class Done(val completion: LCompletion) : FinishOutcome

    /** Offline or server trouble: durably queued with its original operation id and retried later. */
    data object Queued : FinishOutcome

    /** The server answered definitively (409 completion conflict, 412 layout change) and preserved the event. */
    data class Preserved(val code: String, val conflictId: String?) : FinishOutcome

    /** The session ended; the event stays queued under this account's scope until it re-authenticates. */
    data class AccessEnded(val code: String) : FinishOutcome
}

/**
 * Durable, ordered completion events for one recording (ADR-0022/0036). Every event is written to
 * [pendingFile] with its own operation id, base revision, layout revision and capture time BEFORE it is
 * sent, so an offline finish, a lost response or a process death never loses the event; a retry re-sends
 * the same operation id (the server answers an identical retry with its recorded receipt). Only the head
 * may have reached the server, so later, never-sent events are re-based when the head succeeds.
 */
class CompletionSync(
    private val client: LitaraClient,
    private val recordingId: String,
    private val pendingFile: File,
) {
    private val gate = Mutex()
    private val serializer = ListSerializer(LCompletionWrite.serializer())

    private fun read(): List<LCompletionWrite> =
        pendingFile.takeIf { it.exists() }?.let { runCatching { LitaraJson.decodeFromString(serializer, it.readText()) }.getOrNull() }.orEmpty()

    private fun save(list: List<LCompletionWrite>) {
        if (list.isEmpty()) pendingFile.delete() else AtomicFile.write(pendingFile, LitaraJson.encodeToString(serializer, list))
    }

    fun hasPending(): Boolean = read().isNotEmpty()

    /**
     * Records [event] and tries to deliver everything pending. [knownRevision] is the last completion
     * revision this device knew (from the snapshot or the server), used as the base when offline.
     */
    suspend fun submit(event: String, layoutRevision: String, final: LAnchor?, knownRevision: String): FinishOutcome = gate.withLock {
        val queued = read()
        val base = if (queued.isEmpty()) (currentRevisionOrNull() ?: knownRevision) else knownRevision
        val write = LCompletionWrite(UUID.randomUUID().toString(), base, layoutRevision, event, Instant.now().toString(), final)
        save(queued + write)
        deliver(write.operationId)
    }

    /** Re-sends queued events in order (after reconnect or re-authentication). Null when nothing was pending. */
    suspend fun flush(): FinishOutcome? = gate.withLock {
        if (read().isEmpty()) return@withLock null
        deliver(null)
    }

    private suspend fun currentRevisionOrNull(): String? =
        try { client.completion(recordingId).revision } catch (_: TransientException) { null } catch (_: SessionEndedException) { null } catch (_: LitaraHttpException) { null }

    /** Delivers the queue head repeatedly; returns the outcome for [wanted] (or the last attempt). */
    private suspend fun deliver(wanted: String?): FinishOutcome {
        var last: FinishOutcome = FinishOutcome.Queued
        while (true) {
            val list = read()
            val head = list.firstOrNull() ?: return last
            val outcome: FinishOutcome = try {
                val done = client.writeCompletion(recordingId, head)
                // The head is in; never-sent followers are re-based on the revision it produced.
                save(list.drop(1).map { it.copy(baseRevision = done.revision) })
                FinishOutcome.Done(done)
            } catch (e: LitaraHttpException) {
                when {
                    e.status == 409 || e.status == 412 -> { // definitive: the server preserved the event as a durable conflict
                        save(list.drop(1))
                        FinishOutcome.Preserved(e.problem.code, e.problem.conflictId)
                    }
                    e.status == 403 -> return FinishOutcome.AccessEnded(e.problem.code)
                    e.status in 500..599 || e.status == 429 -> return FinishOutcome.Queued
                    else -> { save(list.drop(1)); throw e } // validation: a programming error, drop so it cannot wedge the queue
                }
            } catch (_: TransientException) {
                return FinishOutcome.Queued
            } catch (e: SessionEndedException) {
                return FinishOutcome.AccessEnded(e.code)
            }
            if (wanted != null && head.operationId == wanted) return outcome
            last = outcome
        }
    }
}
