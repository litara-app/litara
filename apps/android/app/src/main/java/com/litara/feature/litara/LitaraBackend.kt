package com.litara.feature.litara

import com.litara.core.litara.LFile
import com.litara.core.litara.LRecording
import com.litara.core.litara.ProgressSync
import com.litara.core.litara.ReportOutcome
import com.litara.core.litara.ScopeToken
import com.litara.core.litara.LitaraJson
import com.litara.core.litara.SessionEndedException
import com.litara.core.litara.StaleScopeException
import com.litara.core.litara.TransientException
import com.litara.core.model.AudioMetadata
import com.litara.core.model.AudioProgress
import com.litara.core.model.AudiobookChapter
import com.litara.core.model.BookCard
import com.litara.core.model.BookDetail
import com.litara.core.model.BookFileRef
import com.litara.core.model.NarratorRef
import com.litara.feature.player.LitaraPlayback
import com.litara.feature.player.LitaraSource
import com.litara.feature.player.LitaraSource.Companion.HANDLE_BASE
import com.litara.feature.player.PlaybackQueue
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/** Persistent two-way map between Litara UUIDs and the Int handles the imported player code uses. */
@Serializable
internal data class IdMap(val next: Int = HANDLE_BASE, val byUuid: Map<String, Int> = emptyMap())

/**
 * Presents Litara recordings and files to the imported player, Android Auto and Cast code as Int
 * handles (ADR-0018: wire identities stay opaque UUIDs + content versions; handles are local aliases that
 * are allocated once per account scope, never reused and never sent anywhere). Positions are file/version
 * plus millisecond offset on the wire; whole-recording time comes from the ordered snapshot.
 */
@Singleton
class LitaraBackend @Inject constructor(
    private val repo: LitaraRepository,
    imageUrls: com.litara.core.network.ImageUrls,
    private val artwork: dagger.Lazy<com.litara.feature.player.AutoArtwork>,
) : LitaraSource {
    init { imageUrls.handleArtwork = { id -> if (owns(id)) artwork.get().uri(id).toString() else null } }

    private data class Cache(val scopeDir: String, var map: IdMap, val byHandle: MutableMap<Int, String>)

    @Volatile private var cache: Cache? = null
    private val syncs = java.util.concurrent.ConcurrentHashMap<String, Pair<LRecording, ProgressSync>>()
    private val lock = Any()

    private fun token(): ScopeToken? = try { repo.offline.begin() } catch (_: StaleScopeException) { null }

    private fun mapFile(t: ScopeToken) = repo.offline.read(t) { File(it, "idmap.json") }

    /** Loads (and if needed rewrites) the registry for the active scope. */
    private fun registry(t: ScopeToken): Cache = synchronized(lock) {
        val dir = t.scope.dirName()
        cache?.takeIf { it.scopeDir == dir }?.let { return it }
        val f = mapFile(t)
        val map = f.takeIf { it.exists() }?.let { runCatching { LitaraJson.decodeFromString<IdMap>(it.readText()) }.getOrNull() } ?: IdMap()
        Cache(dir, map, map.byUuid.entries.associate { it.value to it.key }.toMutableMap()).also { cache = it; syncs.clear() }
    }

    /** Stable handle for [uuid] in this scope, allocating one on first sight. */
    internal fun handle(t: ScopeToken, uuid: String): Int = synchronized(lock) {
        val c = registry(t)
        c.map.byUuid[uuid]?.let { return it }
        val h = c.map.next
        c.map = IdMap(h + 1, c.map.byUuid + (uuid to h))
        c.byHandle[h] = uuid
        mapFile(t).also { it.parentFile?.mkdirs() }.writeText(LitaraJson.encodeToString(c.map))
        h
    }

    /** The handle for a recording or file UUID in the active scope (allocating one); null when locked. */
    fun handleFor(uuid: String): Int? = token()?.let { handle(it, uuid) }

    internal fun uuidOf(handle: Int): String? {
        val t = token() ?: return null
        return synchronized(lock) { registry(t).byHandle[handle] }
    }

    override fun scopeKey(): String = repo.currentIdentity?.takeIf { repo.signedIn }?.let { "${it.serverId}|${it.user.id}" }.orEmpty()

    override fun owns(id: Int): Boolean = id >= HANDLE_BASE && repo.signedIn && uuidOf(id) != null

    private fun ext(f: LFile) = f.filename.substringAfterLast('.', "").lowercase().ifEmpty { if (f.mimeType == "audio/mpeg") "mp3" else "m4b" }

    private fun fileRefs(t: ScopeToken, snap: LRecording): List<BookFileRef> = snap.files.map { f ->
        BookFileRef(handle(t, f.id), ext(f), "primary", f.sizeBytes, f.durationMs?.div(1000.0), f.filename)
    }

    override suspend fun cards(): List<BookCard> {
        val t = token() ?: return emptyList()
        if (!repo.signedIn) return emptyList()
        val list = try { repo.recordings() } catch (_: SessionEndedException) { return emptyList() } catch (_: TransientException) { return emptyList() }
        return list.items.filter { it.readiness == "ready" }.map { r ->
            val h = handle(t, r.id)
            BookCard(h, r.title, r.authors, files = listOf(BookFileRef(h, "m4b", "primary", durationSeconds = r.durationMs?.div(1000.0))),
                addedAt = "", narrators = r.narrators, hasCover = r.artwork?.thumbnailPath != null)
        }
    }

    override suspend fun downloaded(): List<BookCard> {
        val t = token() ?: return emptyList()
        if (!repo.signedIn) return emptyList()
        return repo.downloadedRecordings().map { r ->
            val h = handle(t, r.id)
            BookCard(h, r.title, r.authors, files = listOf(BookFileRef(h, "m4b", "primary", durationSeconds = r.durationMs?.div(1000.0))),
                addedAt = "", narrators = r.narrators, hasCover = false)
        }
    }

    private suspend fun snapshot(uuid: String): LRecording? = try {
        val v = repo.snapshot(uuid)
        if (v.locked) null else (v.downloaded?.takeIf { v.offline } ?: v.snapshot)
    } catch (_: SessionEndedException) { null } catch (_: TransientException) { null } catch (_: com.litara.core.litara.LitaraHttpException) { null }

    override suspend fun playback(bookId: Int): LitaraPlayback? {
        val t = token() ?: return null
        val uuid = uuidOf(bookId) ?: return null
        val snap = snapshot(uuid)?.takeIf { it.capabilities.play } ?: return null
        val files = fileRefs(t, snap)
        val book = BookDetail(
            id = bookId, libraryId = 0, libraryName = "Litara", status = "ready", addedAt = "", title = snap.title,
            seriesName = null, authors = emptyList(), files = files,
            audioMetadata = AudioMetadata(
                narrators = snap.narrators.mapIndexed { i, n -> NarratorRef(i, n) },
                durationSeconds = snap.durationMs?.div(1000.0),
                chapters = snap.chapters.map { AudiobookChapter(it.label, it.recordingStartMs ?: 0) },
            ),
        )
        val uris = snap.files.map { f -> repo.localFile(snap.id, f)?.let { android.net.Uri.fromFile(it).toString() } ?: repo.streamUrl(f) }
        syncs[uuid] = snap to repo.progress(snap)
        return LitaraPlayback(book, files, uris)
    }

    private suspend fun syncFor(uuid: String): Pair<LRecording, ProgressSync>? {
        syncs[uuid]?.let { return it }
        val snap = snapshot(uuid) ?: return null
        return (snap to repo.progress(snap)).also { syncs[uuid] = it }
    }

    private fun fileHandle(t: ScopeToken, f: LFile) = handle(t, f.id)

    override suspend fun serverPosition(bookId: Int): AudioProgress? {
        val t = token() ?: return null
        val uuid = uuidOf(bookId) ?: return null
        val (snap, sync) = syncFor(uuid) ?: return null
        val state = try { sync.load() } catch (_: TransientException) { return null } catch (_: SessionEndedException) { return null }
        val p = state.position ?: return null
        val file = snap.files.firstOrNull { it.id == p.fileId } ?: return null
        val files = fileRefs(t, snap)
        val idx = snap.files.indexOf(file)
        // Conflicts stay unresolved for the phone UI to ask about; a car never picks a winner.
        return AudioProgress(fileHandle(t, file), p.offsetMs / 1000.0, PlaybackQueue.percentageFor(files, idx, p.offsetMs / 1000.0), p.receivedAt)
    }

    override suspend fun push(bookId: Int, fileId: Int, positionSeconds: Double): Boolean {
        val uuid = uuidOf(bookId) ?: return true // not (or no longer) this account's recording: nothing may be uploaded
        val (snap, sync) = syncFor(uuid) ?: return false
        val t = token() ?: return true
        val index = snap.files.indexOfFirst { fileHandle(t, it) == fileId }.takeIf { it >= 0 } ?: return true
        return when (sync.report(index, (positionSeconds * 1000).toLong())) {
            ReportOutcome.Queued -> false
            is ReportOutcome.AccessEnded -> true // locked; the candidate stays with this account's pending file
            else -> true
        }
    }

    override suspend fun ended(bookId: Int) {
        val uuid = uuidOf(bookId) ?: return
        val (snap, sync) = syncFor(uuid) ?: return
        val last = snap.files.last()
        sync.report(snap.files.lastIndex, last.durationMs ?: return)
        try { repo.finish(snap, "natural_end", last) } catch (_: TransientException) { } catch (_: SessionEndedException) { }
    }

    override suspend fun artwork(bookId: Int, destination: File): Boolean {
        val uuid = uuidOf(bookId) ?: return false
        val path = repo.recordings().items.firstOrNull { it.id == uuid }?.artwork?.thumbnailPath ?: return false
        return try { repo.fetchToFile(path, destination, 5L * 1024 * 1024) } catch (_: TransientException) { false } catch (_: SessionEndedException) { false }
    }

}
