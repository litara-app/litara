package com.litara.feature.litara

import android.content.Context
import androidx.media3.datasource.okhttp.OkHttpDataSource
import com.litara.core.litara.AccountScope
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
    private val session: com.litara.core.auth.SessionManager,
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

    /** Screen to reopen after a scope change; null reopens the app's normal launcher (the Litara shell when signed in). */
    @Volatile var restartInto: Class<*>? = null

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
    private fun restartOnScopeChange() {
        if (session.dataScopeChanged()) com.litara.core.data.ProcessRestarter.restart(context, restartInto)
    }

    /** Logout locks the account's scope immediately; data is kept, not deleted. */
    suspend fun signOut() {
        offline.lock()
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
            val items = requireClient().listRecordings(size = 200).items
            offline.publish(t) { File(it, "recordings.json").writeText(LitaraJson.encodeToString(serializer, items)) }
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
        val dl = RangeDownloader(c)
        snap.files.forEachIndexed { i, f ->
            onProgress(i, snap.files.size)
            dl.download(f, File(rd, fileName(f)))
            offline.read(t) { } // fail fast if the scope changed mid-download
        }
        offline.publish(t) {
            val tmp = File(rd, "downloaded.json.tmp")
            tmp.writeText(LitaraJson.encodeToString(snap))
            tmp.copyTo(File(rd, "downloaded.json"), overwrite = true)
            tmp.delete()
            val keep = snap.files.map { fileName(it) }.toSet() + setOf("downloaded.json", "pending-position.json", "LOCKED")
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

    /** HTTP data source for streaming inside the Litara screen. */
    fun mediaDataSourceFactory(): OkHttpDataSource.Factory =
        OkHttpDataSource.Factory(baseHttp().newBuilder().addInterceptor(bearerInterceptor()).authenticator(refreshAuthenticator()).build())

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

    suspend fun finish(snap: LRecording, event: String, finalFile: LFile?): com.litara.core.litara.LCompletion {
        val c = requireClient()
        val cur = c.completion(snap.id)
        val final = if (event == "natural_end" && finalFile != null) LAnchor(finalFile.id, finalFile.contentVersion, finalFile.durationMs!!) else null
        return c.writeCompletion(snap.id, com.litara.core.litara.LCompletionWrite(java.util.UUID.randomUUID().toString(), cur.revision,
            snap.layoutRevision, event, java.time.Instant.now().toString(), final))
    }
}
