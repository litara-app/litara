package com.litara.core.litara

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.io.File
import java.time.Instant
import java.util.UUID

/** A bookmarked place (ADR-0110): one file version and offset under one recording layout. */
@Serializable
data class LAudioBookmarkData(val fileId: String, val contentVersion: String, val offsetMs: Long, val layoutRevision: String, val note: String)

@Serializable
data class LAudioBookmarkWrite(val operationId: String, val baseRevision: String, val data: LAudioBookmarkData, val capturedAt: String)

@Serializable
data class LAudioBookmark(val id: String, val recordingId: String, val revision: String, val deleted: Boolean, val data: LAudioBookmarkData?,
    val available: Boolean, val createdAt: String, val updatedAt: String)

@Serializable
data class LAudioBookmarks(val items: List<LAudioBookmark>, val total: Long, val page: Long, val size: Long)

/** One bookmark on this device. [revision] is "0" until the server has it; [pending] is saved before it is sent. */
@Serializable
data class LocalAudioBookmark(
    val id: String,
    val data: LAudioBookmarkData,
    val createdAt: String,
    val deleted: Boolean = false,
    val revision: String = "0",
    val pending: PendingAnnotationOp? = null,
    /** Set when the server refused a change and kept it; the listener chooses in the web player. */
    val conflict: String? = null,
) {
    /** Whether the place still means the same audio in [snap]. An unavailable bookmark is shown and never opened. */
    fun availableIn(snap: LRecording): Boolean =
        data.layoutRevision == snap.layoutRevision && snap.files.any { it.id == data.fileId && it.contentVersion == data.contentVersion }
}

/** One recording's bookmarks in the account's recording directory. Removing a download leaves this file. */
class AudioBookmarkStore(dir: File) {
    private val file = File(dir, FILE_NAME)

    @Synchronized
    fun all(): List<LocalAudioBookmark> =
        file.takeIf { it.exists() }?.let { runCatching { LitaraJson.decodeFromString<List<LocalAudioBookmark>>(it.readText()) }.getOrNull() }.orEmpty()

    fun visible(): List<LocalAudioBookmark> = all().filter { !it.deleted }

    fun get(id: String): LocalAudioBookmark? = all().firstOrNull { it.id == id }

    fun hasPending(): Boolean = all().any { it.pending != null }

    @Synchronized
    fun put(b: LocalAudioBookmark) = AtomicFile.write(file, LitaraJson.encodeToString(all().filter { it.id != b.id } + b))

    @Synchronized
    fun remove(id: String) = AtomicFile.write(file, LitaraJson.encodeToString(all().filter { it.id != id }))

    companion object {
        const val FILE_NAME = "bookmarks.json"
    }
}

/**
 * Local-first audiobook bookmarks with revision-aware delivery (ADR-0110), following the annotation rules: a change is
 * saved with its operation id before it is sent, retried under that id, and never stacked or silently overwritten.
 */
class AudioBookmarkSync(private val client: LitaraClient, private val recordingId: String, val store: AudioBookmarkStore) {
    private val gate = Mutex()

    private fun now() = Instant.now().toString()
    private fun op(base: String, delete: Boolean) = PendingAnnotationOp(UUID.randomUUID().toString(), base, delete, now())

    suspend fun create(data: LAudioBookmarkData): LocalAudioBookmark = gate.withLock {
        val b = LocalAudioBookmark(UUID.randomUUID().toString(), data, now(), pending = op("0", false))
        store.put(b)
        deliver(b.id)
        store.get(b.id)!!
    }

    /** Renames a bookmark; its place never changes. */
    suspend fun rename(id: String, note: String) = gate.withLock {
        // A change still waiting is delivered first, so this one has a real revision to be checked against.
        deliver(id)
        val cur = store.get(id) ?: return@withLock
        val data = cur.data.copy(note = note)
        val pending = cur.pending
        when {
            // Still unsent (offline): a bookmark the server never saw is created with the new name.
            pending != null && cur.revision == "0" && !pending.delete -> store.put(cur.copy(data = data, pending = op("0", false)))
            pending != null -> Unit // an earlier change is still waiting; do not stack another on it
            else -> {
                store.put(cur.copy(data = data, pending = op(cur.revision, false), conflict = null))
                deliver(id)
            }
        }
    }

    suspend fun delete(id: String) = gate.withLock {
        deliver(id)
        val cur = store.get(id) ?: return@withLock
        // Never sent: nothing for the server to delete. A create whose answer was lost is still pending and is kept.
        if (cur.revision == "0") {
            store.remove(id)
            return@withLock
        }
        store.put(cur.copy(deleted = true, pending = op(cur.revision, true), conflict = null))
        deliver(id)
    }

    /** Delivers waiting changes, then takes the server's list. Offline, the device's list stays as it is. */
    suspend fun refresh() = gate.withLock {
        store.all().filter { it.pending != null }.forEach { deliver(it.id) }
        val server = try {
            client.listAllBookmarks(recordingId)
        } catch (_: TransientException) {
            return@withLock
        } catch (_: SessionEndedException) {
            return@withLock
        }
        for (s in server) {
            val cur = store.get(s.id)
            if (cur?.pending != null) continue // this device's change is sent first
            val data = s.data
            if (data == null) {
                if (cur != null) store.remove(s.id)
                continue
            }
            val conflict = cur?.conflict?.takeIf { cur.revision == s.revision }
            store.put(LocalAudioBookmark(s.id, data, s.createdAt, false, s.revision, null, conflict))
        }
    }

    /** Sends everything waiting. Returns true while something remains. */
    suspend fun flushPending(): Boolean = gate.withLock {
        store.all().filter { it.pending != null }.forEach { deliver(it.id) }
        store.hasPending()
    }

    private suspend fun deliver(id: String) {
        val b = store.get(id) ?: return
        val p = b.pending ?: return
        try {
            val r = if (p.delete) client.deleteBookmark(recordingId, id, LAnnotationDelete(p.operationId, p.baseRevision, p.capturedAt))
            else client.putBookmark(recordingId, id, LAudioBookmarkWrite(p.operationId, p.baseRevision, b.data, p.capturedAt))
            if (r.deleted) store.remove(id) else store.put(b.copy(revision = r.revision, pending = null, conflict = null, deleted = false))
        } catch (e: LitaraHttpException) {
            when {
                // The server kept the attempt for the listener to decide. This device shows the server's version again
                // at the next refresh.
                e.status == 409 || e.status == 412 -> store.put(b.copy(pending = null, deleted = false, conflict = e.problem.code))
                e.status in 500..599 || e.status == 429 || e.status == 401 || e.status == 403 -> Unit // later
                else -> store.put(b.copy(pending = null, deleted = false, conflict = e.problem.code))
            }
        } catch (_: TransientException) {
        } catch (_: SessionEndedException) {
        }
    }
}
