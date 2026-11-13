package com.litara.core.litara

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.UUID

/** Credentials as stored on the device (protected storage in the app; in memory in tests). */
data class StoredCredentials(val accessToken: String, val refreshToken: String)

/**
 * Protected credential storage. [pendingRefreshId] is the request ID of an exchange whose outcome is
 * unknown (ADR-0033): after an ambiguous failure the SAME ID is retried so a lost response is
 * recoverable inside the server's 60-second window instead of causing a second rotation.
 */
interface CredentialStore {
    fun load(): StoredCredentials?
    fun save(credentials: StoredCredentials)
    fun clear()
    var pendingRefreshId: String?
}

class InMemoryCredentialStore : CredentialStore {
    @Volatile private var creds: StoredCredentials? = null
    @Volatile override var pendingRefreshId: String? = null
    override fun load() = creds
    override fun save(credentials: StoredCredentials) { creds = credentials }
    override fun clear() { creds = null; pendingRefreshId = null }
}

/** A non-success HTTP answer. Branch on [problem].code / [status]; [Problem.detail] is display text only. */
class LitaraHttpException(val status: Int, val problem: Problem) : Exception("HTTP $status ${problem.code}")

/** The server ended this device session (revoked, reused, expired, retry window gone). Credentials were cleared. */
class SessionEndedException(val code: String) : Exception("session ended: $code")

/** A failure that says nothing about authorization (network, 5xx, throttling): the scope is kept and the call may be retried. */
class TransientException(cause: Throwable?, message: String) : Exception(message, cause)

/**
 * Litara API client: bearer on every request, single-flight refresh with a persisted request ID,
 * refresh-then-retry for an expired access token (including ranged media), and typed errors.
 * It never follows redirects to another host and never falls back from TLS to HTTP.
 */
class LitaraClient(
    baseUrl: String,
    private val http: OkHttpClient,
    private val creds: CredentialStore,
) {
    private val base = baseUrl.trimEnd('/')
    private val refreshMutex = Mutex()
    private val jsonType = "application/json".toMediaType()

    /** Number of refresh exchanges attempted (for tests and diagnostics). */
    @Volatile var refreshAttempts = 0
        private set

    private val origin: String = baseUrl.toHttpUrl().let { u ->
        val port = if (u.port == okhttp3.HttpUrl.defaultPort(u.scheme)) "" else ":${u.port}"
        "${u.scheme}://${u.host}$port"
    }

    /** An API-relative path (for example `/recordings`) under the configured API base. */
    fun url(path: String) = base + path

    /**
     * A server-relative path returned by the API (contentPath, artwork paths) already includes the
     * mount prefix and /api/v1, so it is resolved against the origin. It is never an absolute URL:
     * credentials are never sent to a different host.
     */
    fun serverUrl(path: String): String {
        require(path.startsWith("/")) { "server paths must be relative" }
        return origin + path
    }

    // ---- unauthenticated ----------------------------------------------------

    suspend fun discover(): Discovery = getJson("/discovery", authenticated = false)

    suspend fun login(username: String, password: String, deviceName: String): TokenPair {
        val tp: TokenPair = postJson("/auth/native/login", LitaraJson.encodeToString(LLogin(username, password, deviceName)), authenticated = false)
        creds.save(StoredCredentials(tp.accessToken, tp.refreshToken))
        return tp
    }

    /** Native logout revokes this device session; local credentials are cleared either way. */
    suspend fun logout() {
        try {
            execute(Request.Builder().url(url("/auth/native/logout")).post("".toRequestBody(jsonType))).use { }
        } finally {
            creds.clear()
        }
    }

    // ---- authenticated -------------------------------------------------------

    suspend fun listRecordings(page: Int = 0, size: Int = 50, q: String? = null, completion: String = "any", sort: String = "title"): LRecordings {
        val qs = buildString {
            append("?page=$page&size=$size&completion=$completion&sort=$sort")
            if (q != null) append("&q=").append(java.net.URLEncoder.encode(q, "UTF-8"))
        }
        return getJson("/recordings$qs")
    }

    suspend fun snapshot(recordingId: String): LRecording = getJson("/recordings/$recordingId")
    suspend fun position(recordingId: String): LPositionState = getJson("/recordings/$recordingId/position")
    suspend fun completion(recordingId: String): LCompletion = getJson("/recordings/$recordingId/completion")

    suspend fun writePosition(recordingId: String, w: LPositionWrite): LPositionState =
        sendJson("PUT", "/recordings/$recordingId/position", LitaraJson.encodeToString(w))

    suspend fun resolveConflict(recordingId: String, conflictId: String, r: LResolveConflict): LPositionState =
        postJson("/recordings/$recordingId/conflicts/$conflictId/resolve", LitaraJson.encodeToString(r))

    suspend fun writeCompletion(recordingId: String, w: LCompletionWrite): LCompletion =
        sendJson("PUT", "/recordings/$recordingId/completion", LitaraJson.encodeToString(w))

    // ---- plumbing ---------------------------------------------------------------

    private suspend inline fun <reified T> getJson(path: String, authenticated: Boolean = true): T =
        decode(call(Request.Builder().url(url(path)).get(), authenticated))

    private suspend inline fun <reified T> postJson(path: String, body: String, authenticated: Boolean = true): T =
        sendJson("POST", path, body, authenticated)

    private suspend inline fun <reified T> sendJson(method: String, path: String, body: String, authenticated: Boolean = true): T =
        decode(call(Request.Builder().url(url(path)).method(method, body.toRequestBody(jsonType)), authenticated))

    private suspend fun call(b: Request.Builder, authenticated: Boolean): String {
        val resp = if (authenticated) execute(b) else raw(b.build())
        // Reading the body is network I/O; it must never run on the caller's (possibly main) thread.
        return withContext(Dispatchers.IO) {
            resp.use { r ->
                val text = r.body?.string().orEmpty()
                if (!r.isSuccessful) throw LitaraHttpException(r.code, problemOf(text, r.code))
                text
            }
        }
    }

    private inline fun <reified T> decode(text: String): T = LitaraJson.decodeFromString(text)

    internal fun problemOf(text: String, status: Int): Problem =
        runCatching { LitaraJson.decodeFromString<Problem>(text) }.getOrNull() ?: Problem(status = status)

    private suspend fun raw(req: Request): Response = withContext(Dispatchers.IO) {
        try {
            http.newCall(req).execute()
        } catch (e: IOException) {
            throw TransientException(e, "network error") // not an authorization denial
        }
    }

    /**
     * Executes an authenticated request. On 401 token_expired the access token is refreshed
     * (single-flight) and the request retried once. The caller closes the returned response.
     * Non-2xx answers are returned as-is so media callers can inspect 206/416/412.
     */
    suspend fun execute(builder: Request.Builder): Response {
        var attempt = 0
        while (true) {
            val used = creds.load()?.accessToken ?: throw SessionEndedException("signed_out")
            val resp = raw(builder.header("Authorization", "Bearer $used").build())
            if (resp.code != 401 || attempt > 0) return resp
            val problem = problemOf(withContext(Dispatchers.IO) { resp.peekBody(64 * 1024).string() }, 401)
            if (problem.code != "token_expired") {
                if (problem.code == "session_revoked" || problem.code == "session_expired") {
                    resp.close()
                    creds.clear()
                    throw SessionEndedException(problem.code)
                }
                return resp
            }
            resp.close()
            refreshIfStale(used)
            attempt++
        }
    }

    /** The current access token, for media data sources that attach it themselves. */
    fun accessToken(): String? = creds.load()?.accessToken

    /**
     * Refreshes the access token if [staleAccess] is still current (single-flight). Used by media
     * data sources (OkHttp Authenticator) so a ranged stream survives token expiry.
     */
    suspend fun refreshAfter(staleAccess: String?): String? {
        refreshIfStale(staleAccess ?: return creds.load()?.accessToken)
        return creds.load()?.accessToken
    }

    /** Single-flight: concurrent callers that saw the same expired token share one exchange. */
    private suspend fun refreshIfStale(usedAccess: String) = refreshMutex.withLock {
        val cur = creds.load() ?: throw SessionEndedException("signed_out")
        if (cur.accessToken != usedAccess) return@withLock // someone else already refreshed
        val requestId = creds.pendingRefreshId ?: UUID.randomUUID().toString().also { creds.pendingRefreshId = it }
        refreshAttempts++
        val req = Request.Builder().url(url("/auth/native/refresh"))
            .post(LitaraJson.encodeToString(LRefresh(cur.refreshToken, requestId)).toRequestBody(jsonType)).build()
        val resp = try {
            raw(req)
        } catch (e: TransientException) {
            throw e // keep credentials and the pending request ID; retry the SAME exchange later
        }
        withContext(Dispatchers.IO) { resp.use { r ->
            val text = r.body?.string().orEmpty()
            when {
                r.isSuccessful -> {
                    val tp = LitaraJson.decodeFromString<TokenPair>(text)
                    creds.save(StoredCredentials(tp.accessToken, tp.refreshToken))
                    creds.pendingRefreshId = null
                }
                r.code == 401 -> {
                    val code = problemOf(text, 401).code
                    creds.clear()
                    throw SessionEndedException(code)
                }
                else -> throw TransientException(null, "refresh failed with HTTP ${r.code}") // 429/5xx: keep scope and request ID
            }
        } }
    }
}
