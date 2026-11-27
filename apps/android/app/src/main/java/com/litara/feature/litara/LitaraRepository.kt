package com.litara.feature.litara

import android.content.Context
import com.litara.core.litara.AccountScope
import com.litara.core.litara.ContentChangedException
import com.litara.core.litara.AtomicFile
import com.litara.core.litara.EditionProgressSync
import com.litara.core.litara.LEdition
import com.litara.core.litara.LEditionFile
import com.litara.core.litara.LReaderSnapshot
import com.litara.core.litara.CompletionSync
import com.litara.core.litara.FinishOutcome
import com.litara.core.litara.LAnchor
import com.litara.core.litara.LFile
import com.litara.core.litara.LRecording
import com.litara.core.litara.LRecordingSummary
import com.litara.core.litara.LitaraClient
import com.litara.core.litara.LitaraHttpException
import com.litara.core.litara.LitaraJson
import com.litara.core.litara.OfflineStore
import com.litara.core.litara.ProgressSync
import com.litara.core.litara.RangeDownloader
import com.litara.core.litara.ScopeToken
import com.litara.core.litara.SessionEndedException
import com.litara.core.litara.StaleScopeException
import com.litara.core.litara.TransientException
import com.litara.core.network.UserCaTrust
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import okhttp3.Authenticator
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** Why a Litara URL was refused before any request was made. */
class InsecureServerException : IOException("Plain HTTP needs the explicit development opt-in")

/** "Wi-Fi only" is on and the connection is metered. What was already fetched stays, so a later try resumes. */
class MeteredNetworkException : IOException("Downloads are set to Wi-Fi only")

/** A list that may come from the device cache rather than the server. */
data class RecordingList(val items: List<LRecordingSummary>, val fromCache: Boolean)

/** A snapshot plus how it relates to what is downloaded. */
data class SnapshotView(
    val snapshot: LRecording,
    val downloaded: LRecording?,
    val offline: Boolean,
    val locked: Boolean,
) {
    val updateAvailable: Boolean get() = downloaded != null && downloaded.layoutRevision != snapshot.layoutRevision
}

/**
 * The Litara data edge for the Android app: connects to a Litara server, keeps credentials in protected
 * storage, partitions every offline artifact by serverId + userId (audit L6, ADR-0013/0043) and gives
 * the player authenticated, refresh-capable media access. Plain HTTP is refused unless the user opts
 * in explicitly, and a TLS failure never falls back to HTTP.
 */
@Singleton
class LitaraRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val store: LitaraSessionStore,
    private val userCaTrust: UserCaTrust,
    private val dataScope: com.litara.core.auth.AccountDataScope,
    private val settings: com.litara.core.settings.AppSettingsStore,
) {
    val offline = OfflineStore(File(context.filesDir, "litara-offline"))

    @Volatile private var client: LitaraClient? = null
    @Volatile private var identity: LitaraIdentity? = null

    private val _signedInFlow = kotlinx.coroutines.flow.MutableStateFlow(false)

    /** Observable sign-in state for the app gate (true while a usable Litara session exists). */
    val signedInFlow: kotlinx.coroutines.flow.StateFlow<Boolean> = _signedInFlow

    init { restore(); _signedInFlow.value = signedIn }

    /** Call after a failure that may have ended the session (revoked refresh token). */
    fun refreshSignedIn() { _signedInFlow.value = signedIn }

    val currentIdentity: LitaraIdentity? get() = identity
    val signedIn: Boolean get() = client != null && store.load() != null

    private fun baseHttp(): OkHttpClient = userCaTrust.applyTo(OkHttpClient.Builder())
        .retryOnConnectionFailure(false) // refresh retries are explicit (same request id), never transparent
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()

    private fun buildClient(id: LitaraIdentity): LitaraClient =
        LitaraClient(id.serverUrl.trimEnd('/') + "/api/v1", baseHttp(), store)

    private fun restore() {
        val id = store.identity() ?: return
        identity = id
        if (store.load() != null) {
            client = buildClient(id)
            offline.activate(scopeOf(id))
        }
    }

    private fun scopeOf(id: LitaraIdentity) = AccountScope(id.serverId, id.user.id)

    /** Signs in. Only a new (server, account) pair gets its own directory; the same account finds its data again. */
    suspend fun signIn(serverUrl: String, allowInsecureHttp: Boolean, username: String, password: String, device: String): LitaraIdentity {
        val url = serverUrl.trim().trimEnd('/')
        val parsed = runCatching { url.toHttpUrl() }.getOrElse { throw IOException("Not a valid server URL") }
        if (parsed.scheme == "http" && !allowInsecureHttp) throw InsecureServerException()
        val probe = LitaraClient("$url/api/v1", baseHttp(), store)
        val disc = probe.discover()
        if (disc.product != "Litara" || "v1" !in disc.apiVersions) throw IOException("Not a compatible Litara server")
        val tp = probe.login(username.trim(), password, device)
        val id = LitaraIdentity(url, disc.serverId, tp.user, allowInsecureHttp && parsed.scheme == "http")
        store.saveIdentity(id)
        identity = id
        client = probe
        offline.activate(scopeOf(id))
        _signedInFlow.value = true
        restartOnScopeChange()
        return id
    }

    /** The Room database and downloads are per server+account; a different account needs the process to reopen them. */
    /** Instrumentation shares the app process and turns this off; production always restarts on a scope change. */
    @Volatile var allowProcessRestart: Boolean = true

    private fun restartOnScopeChange() {
        if (allowProcessRestart && dataScope.changed()) com.litara.core.data.ProcessRestarter.restart(context)
    }

    /** Logout locks the account's scope immediately; data is kept, not deleted. */
    suspend fun signOut() {
        offline.lock()
        forgetImages()
        val c = client
        client = null
        runCatching { c?.logout() }
        store.signOutKeepIdentity()
        _signedInFlow.value = false
        restartOnScopeChange()
    }

    private fun requireClient(): LitaraClient = client ?: throw SessionEndedException("signed_out")

    private fun token(): ScopeToken = offline.begin()

    private fun dir(token: ScopeToken): File = offline.publish(token) { it }

    // ---- catalog ------------------------------------------------------------------------------

    suspend fun recordings(): RecordingList {
        val t = token()
        val serializer = ListSerializer(LRecordingSummary.serializer())
        return try {
            val items = requireClient().listAllRecordings().items
            offline.publish(t) { File(it, "recordings.json").writeText(LitaraJson.encodeToString(serializer, items)) }
            runCatching { flushCompletions() } // reconnected: deliver finish events captured offline
            RecordingList(items, fromCache = false)
        } catch (e: TransientException) {
            val cached = offline.read(t) { d -> File(d, "recordings.json").takeIf { it.exists() }?.readText() }
            RecordingList(cached?.let { LitaraJson.decodeFromString(serializer, it) }.orEmpty(), fromCache = true)
        }
    }

    private fun recDir(t: ScopeToken, id: String) = File(dir(t), "rec/$id").apply { mkdirs() }

    fun downloaded(recordingId: String): LRecording? {
        val t = token()
        val f = File(recDir(t, recordingId), "downloaded.json")
        return f.takeIf { it.exists() }?.let { runCatching { LitaraJson.decodeFromString<LRecording>(it.readText()) }.getOrNull() }
    }

    /** Every recording with a complete offline copy in the active account scope (no network needed). */
    fun downloadedRecordings(): List<LRecording> {
        val t = token()
        val root = File(dir(t), "rec")
        return root.listFiles { f -> f.isDirectory }.orEmpty().mapNotNull { d ->
            if (File(d, "LOCKED").exists()) return@mapNotNull null
            File(d, "downloaded.json").takeIf { it.exists() }?.let { runCatching { LitaraJson.decodeFromString<LRecording>(it.readText()) }.getOrNull() }
        }.filter { snap -> snap.files.all { localFile(snap.id, it) != null } }
    }

    /** Removes the offline copy (bytes and snapshot). Positions waiting to upload stay. */
    fun deleteDownload(recordingId: String) {
        val t = token()
        offline.publish(t) {
            recDir(t, recordingId).listFiles()?.filter { it.name.endsWith(".bin") || it.name == "downloaded.json" }?.forEach { it.delete() }
        }
    }

    // ---- audiobook bookmarks (ADR-0110) -------------------------------------------------------

    private val bookmarkSyncs = java.util.concurrent.ConcurrentHashMap<String, com.litara.core.litara.AudioBookmarkSync>()

    /** One sync per account and recording, so two callers never deliver the same change at once. */
    fun bookmarks(recordingId: String): com.litara.core.litara.AudioBookmarkSync {
        val t = token()
        val directory = recDir(t, recordingId)
        val c = requireClient()
        return bookmarkSyncs.getOrPut("${System.identityHashCode(c)}|${directory.path}") {
            com.litara.core.litara.AudioBookmarkSync(c, recordingId, com.litara.core.litara.AudioBookmarkStore(directory))
        }
    }

    /** Delivers every waiting bookmark change of the active account. True while some remain. */
    suspend fun flushBookmarks(): Boolean {
        val t = token()
        val waiting = File(dir(t), "rec").listFiles { f -> f.isDirectory }.orEmpty()
            .filter { com.litara.core.litara.AudioBookmarkStore(it).hasPending() }
        var left = false
        for (directory in waiting) if (bookmarks(directory.name).flushPending()) left = true
        return left
    }

    fun isLocked(recordingId: String): Boolean = File(recDir(token(), recordingId), "LOCKED").exists()

    /** Online snapshot compared with the local download; offline falls back to the downloaded snapshot (no lease). */
    suspend fun snapshot(recordingId: String): SnapshotView {
        val t = token()
        val rd = recDir(t, recordingId)
        val local = downloaded(recordingId)
        return try {
            val snap = requireClient().snapshot(recordingId)
            File(rd, "LOCKED").delete() // access confirmed again
            SnapshotView(snap, local, offline = false, locked = false)
        } catch (e: LitaraHttpException) {
            if (e.status == 403) { // confirmed online revocation: lock the cache, keep its data
                File(rd, "LOCKED").writeText(e.problem.code)
                local?.let { return SnapshotView(it, it, offline = false, locked = true) }
            }
            throw e
        } catch (e: TransientException) { // a network outage is not an authorization denial
            val l = local ?: throw e
            SnapshotView(l, l, offline = true, locked = File(rd, "LOCKED").exists())
        }
    }

    // ---- downloads ------------------------------------------------------------------------------

    /** Whether the active connection costs by use. Tests replace it; an emulator's network is always unmetered. */
    @Volatile var meteredNetwork: () -> Boolean = {
        context.getSystemService(android.net.ConnectivityManager::class.java)?.isActiveNetworkMetered ?: false
    }

    /**
     * The check an explicit download makes before and during its transfer. Opening a book to read it and streaming
     * audio are not downloads and are not limited by the setting.
     */
    private suspend fun downloadGate(): () -> Unit {
        val wifiOnly = settings.wifiOnlyDownloads.first()
        val gate = { if (wifiOnly && meteredNetwork()) throw MeteredNetworkException() }
        gate()
        return gate
    }

    private fun fileName(f: LFile) = "${f.id}-${f.contentVersion}.bin"

    fun localFile(recordingId: String, f: LFile): File? =
        File(recDir(token(), recordingId), fileName(f)).takeIf { it.exists() && it.length() == f.sizeBytes }

    /**
     * Downloads every file of [snap] (staged beside any older copy) and publishes the snapshot atomically
     * only when all bytes validate. Old bytes stay untouched until then. The task is bound to the scope it
     * started in: a logout or account switch before publishing makes it fail with [StaleScopeException].
     */
    suspend fun download(snap: LRecording, onProgress: (done: Int, total: Int) -> Unit = { _, _ -> }) {
        check(snap.capabilities.download) { "recording is not ready for download" }
        val t = token()
        val c = requireClient()
        val rd = recDir(t, snap.id)
        val dl = RangeDownloader(c, downloadGate())
        snap.files.forEachIndexed { i, f ->
            onProgress(i, snap.files.size)
            dl.download(f, File(rd, fileName(f)))
            offline.read(t) { } // fail fast if the scope changed mid-download
        }
        offline.publish(t) {
            // Atomic swap: an interruption leaves the complete old manifest or the complete new one. Old bytes
            // are removed only after the new manifest is durably in place.
            AtomicFile.write(File(rd, "downloaded.json"), LitaraJson.encodeToString(snap))
            val keep = snap.files.map { fileName(it) }.toSet() + setOf("downloaded.json", "pending-position.json", ProgressSync.REVISION_FILE, "LOCKED")
            rd.listFiles()?.filter { it.name !in keep && it.name.endsWith(".bin") }?.forEach { it.delete() }
        }
        onProgress(snap.files.size, snap.files.size)
    }

    // ---- playback plumbing -------------------------------------------------------------------------

    private fun isLitaraServer(url: okhttp3.HttpUrl): Boolean {
        val id = identity ?: return false
        val server = id.serverUrl.toHttpUrl()
        return url.host == server.host && url.port == server.port && url.scheme == server.scheme
    }

    /**
     * Adds the Litara bearer to requests for the Litara server ONLY (never another host). Installed on the
     * shared stream and Cast-upstream clients, which are built before any Litara sign-in; it looks the
     * current session up per request, so it tracks refresh and sign-out.
     */
    fun bearerInterceptor(): okhttp3.Interceptor = okhttp3.Interceptor { chain ->
        val req = chain.request()
        val token = client?.accessToken()
        chain.proceed(if (token != null && isLitaraServer(req.url)) req.newBuilder().header("Authorization", "Bearer $token").build() else req)
    }

    /** Single refresh-then-retry on 401 for the Litara server's ranged media requests. */
    fun refreshAuthenticator(): Authenticator = Authenticator { _, response ->
        val c = client ?: return@Authenticator null
        if (!isLitaraServer(response.request.url) || response.request.header("X-Litara-Retried") != null) return@Authenticator null
        val stale = response.request.header("Authorization")?.removePrefix("Bearer ")
        val fresh = runBlocking { runCatching { c.refreshAfter(stale) }.getOrNull() } ?: return@Authenticator null
        response.request.newBuilder().header("Authorization", "Bearer $fresh").header("X-Litara-Retried", "1").build()
    }

    private var covers: coil.ImageLoader? = null

    /**
     * Loads covers and author photos for the browsing screens with this account's sign-in. Nothing is kept on disk, so
     * one account's private images are never read back for another (ADR-0032).
     */
    @Synchronized
    fun coverLoader(): coil.ImageLoader = covers ?: coil.ImageLoader.Builder(context)
        .okHttpClient { baseHttp().newBuilder().addInterceptor(bearerInterceptor()).authenticator(refreshAuthenticator()).build() }
        .diskCache(null)
        .diskCachePolicy(coil.request.CachePolicy.DISABLED)
        .respectCacheHeaders(false)
        .crossfade(true)
        .build().also { covers = it }

    /** The next account starts with no cached images and its own certificate trust. */
    @Synchronized
    private fun forgetImages() {
        covers?.memoryCache?.clear()
        covers = null
    }

    /** The current client, for the Android Auto/Cast adapter. Null when signed out. */
    fun clientOrNull(): LitaraClient? = client

    /** Downloads a server-relative path (artwork) into [destination], at most [maxBytes]. */
    suspend fun fetchToFile(path: String, destination: File, maxBytes: Long): Boolean {
        val c = client ?: return false
        return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            c.execute(okhttp3.Request.Builder().url(c.serverUrl(path)).get()).use { r ->
                val body = r.body
                if (!r.isSuccessful || body == null || body.contentType()?.type != "image") return@use false
                var total = 0L
                destination.outputStream().use { out ->
                    val buf = ByteArray(8192)
                    body.byteStream().use { input ->
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            total += n
                            if (total > maxBytes) return@use false
                            out.write(buf, 0, n)
                        }
                    }
                }
                total > 0
            }
        }
    }

    fun streamUrl(f: LFile): String = requireClient().serverUrl(f.contentPath)

    fun progress(snap: LRecording): ProgressSync =
        ProgressSync(requireClient(), snap.id, snap.layoutRevision, snap.files, File(recDir(token(), snap.id), "pending-position.json"))

    private fun completionSync(t: ScopeToken, recordingId: String) =
        CompletionSync(requireClient(), recordingId, File(recDir(t, recordingId), "pending-completion.json"))

    /**
     * Records a completion event durably (with its own operation id) and delivers it; offline it stays queued for
     * [flushCompletions]. A natural end carries the final file anchor.
     */
    suspend fun finish(snap: LRecording, event: String, finalFile: LFile?): FinishOutcome {
        val t = token()
        val final = if (event == "natural_end" && finalFile != null) LAnchor(finalFile.id, finalFile.contentVersion, finalFile.durationMs!!) else null
        return completionSync(t, snap.id).submit(event, snap.layoutRevision, final, snap.completion.revision)
    }

    /** Resolves one completion conflict by the user's explicit choice; [explicitEvent] only for `use_explicit`. */
    suspend fun resolveCompletionConflict(snap: LRecording, conflictId: String, choice: String, explicitEvent: String? = null) =
        completionSync(token(), snap.id).resolve(conflictId, choice, snap.layoutRevision, explicitEvent)

    /** Delivers queued completion events of the active account for every recording; best effort. */
    suspend fun flushCompletions() {
        val t = token()
        File(dir(t), "rec").listFiles { f -> f.isDirectory && File(f, "pending-completion.json").exists() }.orEmpty().forEach { d ->
            completionSync(t, d.name).flush()
        }
    }

    fun hasPendingCompletion(recordingId: String): Boolean = File(recDir(token(), recordingId), "pending-completion.json").exists()
    // ---- ebooks and comics (T005 editions) -----------------------------------------------------

    /** What the native readers may exchange with the server's canonical positions and annotations (G02); see [com.litara.core.litara.LocatorPolicy.NATIVE]. */
    val nativeLocatorPolicy = com.litara.core.litara.LocatorPolicy.NATIVE

    /** The page manifest of a comic edition's exact file version, asking the server to extract it first if needed. */
    suspend fun comicManifest(e: LEdition): com.litara.core.litara.LPageManifest {
        val c = requireClient()
        val f = e.file
        val current = try { c.comicManifest(f.id, f.contentVersion) } catch (ex: LitaraHttpException) {
            if (ex.status == 404 || ex.status == 409) null else throw ex
        }
        if (current != null && current.state != "processing" && current.pages.isNotEmpty()) return current
        return c.prepareComicPages(f.id, f.contentVersion,
            com.litara.core.litara.LExtraction(java.util.UUID.randomUUID().toString(), e.revision, f.contentVersion))
    }

    /** Re-reads the manifest (no job) until the server finishes extracting or [attempts] run out. */
    suspend fun waitForManifest(e: LEdition, first: com.litara.core.litara.LPageManifest, attempts: Int = 40): com.litara.core.litara.LPageManifest {
        var m = first
        var n = 0
        while (m.state == "processing" && n++ < attempts) {
            kotlinx.coroutines.delay(500)
            m = requireClient().comicManifest(e.file.id, e.file.contentVersion)
        }
        return m
    }

    fun comicPages(e: LEdition, manifest: com.litara.core.litara.LPageManifest): com.litara.core.litara.ComicPageStore =
        com.litara.core.litara.ComicPageStore(requireClient(), File(edDir(token(), e.id), "pages"), manifest)

    suspend fun editions(): List<LEdition> = requireClient().listAllEditions()

    suspend fun titles(): List<com.litara.core.litara.LTitleSummary> = requireClient().listAllTitles()

    suspend fun readerSnapshot(editionId: String): LReaderSnapshot {
        val t = token()
        return try {
            requireClient().readerSnapshot(editionId).also {
                offline.publish(t) { setBookLocked(edDir(t, editionId), false) }
            }
        } catch (e: LitaraHttpException) {
            if (e.status == 403 || e.status == 404) {
                offline.publish(t) { setBookLocked(edDir(t, editionId), true) }
            }
            throw e
        } catch (e: TransientException) {
            val directory = edDir(t, editionId)
            savedBook(directory)?.takeUnless { File(directory, "LOCKED").exists() }?.snapshot ?: throw e
        }
    }

    private fun edDir(t: ScopeToken, editionId: String) = File(dir(t), "ed/$editionId").apply { mkdirs() }

    @kotlinx.serialization.Serializable
    private data class SavedBook(val snapshot: LReaderSnapshot, val title: String, val authors: List<String>)

    private val bookFiles = Mutex()

    private fun bookFile(directory: File, f: LEditionFile): File {
        val ext = f.format.filter { it.isLetterOrDigit() }.ifEmpty { "bin" }
        return File(directory, "${f.id}-${f.contentVersion}.$ext")
    }

    private fun savedBook(directory: File): SavedBook? {
        val marker = File(directory, "downloaded.json")
        if (!marker.isFile) return null
        val saved = runCatching { LitaraJson.decodeFromString<SavedBook>(marker.readText()) }.getOrNull() ?: return null
        val file = saved.snapshot.edition.file
        val local = bookFile(directory, file)
        return saved.takeIf { local.isFile && local.length() == file.sizeBytes }
    }

    private fun setBookLocked(directory: File, locked: Boolean) {
        val lock = File(directory, "LOCKED")
        if (locked) {
            if (File(directory, "downloaded.json").isFile) AtomicFile.write(lock, "")
        } else if (lock.exists()) {
            check(lock.delete()) { "Could not unlock this download." }
        }
    }

    fun downloadedBooks(visible: Set<String>? = null): List<BookRow> = offline.read(token()) { directory ->
        File(directory, "ed").listFiles().orEmpty().mapNotNull { book ->
            val saved = savedBook(book) ?: return@mapNotNull null
            if (visible != null) setBookLocked(book, book.name !in visible)
            saved.takeUnless { File(book, "LOCKED").exists() }
        }.map {
            BookRow(it.snapshot.edition, it.title, it.authors, downloaded = true)
        }.sortedBy { it.title.lowercase() }
    }

    suspend fun downloadBook(row: BookRow) = bookFiles.withLock {
        val t = token()
        val c = requireClient()
        val gate = downloadGate()
        val snap = c.readerSnapshot(row.edition.id)
        val file = snap.edition.file
        if (file.id != row.edition.file.id || file.contentVersion != row.edition.file.contentVersion) {
            throw ContentChangedException(file.id)
        }
        check(bookDownloadable(snap.edition)) { "This book cannot be downloaded." }
        val directory = edDir(t, snap.edition.id)
        fetchEditionFile(c, snap, directory, gate)
        offline.publish(t) {
            AtomicFile.write(File(directory, "downloaded.json"), LitaraJson.encodeToString(SavedBook(snap, row.title, row.authors)))
            setBookLocked(directory, false)
        }
    }

    suspend fun removeBookDownload(editionId: String) = bookFiles.withLock {
        val t = token()
        offline.publish(t) {
            val directory = edDir(t, editionId)
            val saved = savedBook(directory)
            val marker = File(directory, "downloaded.json")
            saved?.snapshot?.edition?.file?.let {
                val file = bookFile(directory, it)
                check(!file.exists() || file.delete()) { "Could not remove downloaded file." }
            }
            check(!marker.exists() || marker.delete()) { "Could not remove download record." }
            setBookLocked(directory, false)
        }
        Unit
    }

    /** Readers and explicit downloads share the Range downloader and exact-version cache. */
    suspend fun editionFile(snap: LReaderSnapshot): File = bookFiles.withLock {
        val t = token()
        fetchEditionFile(requireClient(), snap, edDir(t, snap.edition.id)).also { offline.publish(t) { } }
    }

    private suspend fun fetchEditionFile(c: LitaraClient, snap: LReaderSnapshot, directory: File, gate: () -> Unit = {}): File {
        val f = snap.edition.file
        val path = f.contentPath ?: throw IllegalStateException("This edition has no readable content.")
        val dest = bookFile(directory, f)
        val file = LFile(f.id, f.contentVersion, 0, dest.name, f.mimeType, f.sizeBytes, null, f.availability == "available", path)
        RangeDownloader(c, gate).download(file, dest)
        return dest
    }

    /** Manual finish/unfinish for [e]'s exact file version; the saved write lives with the account's edition data. */
    fun editionCompletion(e: LEdition): com.litara.core.litara.EditionCompletionSync =
        com.litara.core.litara.EditionCompletionSync(requireClient(), e.id, e.file.id, e.file.contentVersion,
            File(edDir(token(), e.id), "pending-completion.json"))

    /** Edition ids of the active account that still have an undelivered finish/unfinish write. */
    fun editionsWithPendingCompletion(): List<String> {
        val t = token()
        return File(dir(t), "ed").listFiles { f -> f.isDirectory && File(f, "pending-completion.json").exists() }.orEmpty().map { it.name }
    }

    suspend fun personalConflicts(): List<com.litara.core.litara.LPersonalConflict> = requireClient().listAllPersonalConflicts()

    /** [currentRevision] must be the resource's CURRENT revision (refetch on a stale answer); a new operation id per decision. */
    suspend fun resolveConflict(c: com.litara.core.litara.LPersonalConflict, choice: String, currentRevision: String, contentVersion: String?) =
        requireClient().resolvePersonalConflict(c.id,
            com.litara.core.litara.LResolve(java.util.UUID.randomUUID().toString(), currentRevision, choice, contentVersion))

    /** Private annotations for [snap]'s exact file version; local-first, synced only where [nativeLocatorPolicy] allows. */
    fun editionAnnotations(snap: LReaderSnapshot): com.litara.core.litara.EditionAnnotationSync {
        val t = token()
        val f = snap.edition.file
        val d = edDir(t, snap.edition.id)
        return com.litara.core.litara.EditionAnnotationSync(requireClient(), snap.edition.id, f.id, f.contentVersion, snap.engineProfile, f.format,
            nativeLocatorPolicy, com.litara.core.litara.AnnotationStore(d, f.id, f.contentVersion))
    }

    fun editionProgress(snap: LReaderSnapshot): EditionProgressSync {
        val t = token()
        return EditionProgressSync(requireClient(), snap.edition.id, snap.edition.file.id, snap.edition.file.contentVersion,
            snap.engineProfile, snap.edition.file.format, nativeLocatorPolicy, edDir(t, snap.edition.id), snap.position)
    }
}
