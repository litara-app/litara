package com.litara.core.litara

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** Protocol behavior of the Litara client against a scripted server (contracts/t003 refresh rules). */
class LitaraClientTest {
    private lateinit var server: MockWebServer
    private lateinit var store: InMemoryCredentialStore
    private lateinit var client: LitaraClient

    private val session = """{"id":"s","deviceName":"d","client":"native","createdAt":"2026-11-13T12:00:00Z","lastUsedAt":"2026-11-13T12:00:00Z","idleExpiresAt":"2026-12-13T12:00:00Z","absoluteExpiresAt":"2027-02-11T12:00:00Z"}"""
    private val user = """{"id":"u","username":"a","displayName":"A","isAdmin":false,"active":true}"""
    private fun pair(access: String, refresh: String) =
        """{"accessToken":"$access","tokenType":"Bearer","expiresIn":900,"refreshToken":"$refresh","session":$session,"user":$user}"""

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
        store = InMemoryCredentialStore().also { it.save(StoredCredentials("old-access", "old-refresh")) }
        // No transparent transport retry: the test must observe the ambiguous failure itself.
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)
    }

    @After
    fun tearDown() = server.shutdown()

    private fun problem(status: Int, code: String) = MockResponse().setResponseCode(status).setHeader("Content-Type", "application/problem+json")
        .setBody("""{"type":"urn:litara:problem:$code","title":"$code","status":$status,"detail":"x","code":"$code","requestId":"r"}""")

    @Test
    fun `concurrent expired requests share exactly one refresh exchange`() = runBlocking {
        val refreshes = AtomicInteger()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when {
                request.path!!.endsWith("/auth/native/refresh") -> { refreshes.incrementAndGet(); Thread.sleep(150); MockResponse().setBody(pair("new-access", "new-refresh")) }
                request.getHeader("Authorization") == "Bearer old-access" -> problem(401, "token_expired")
                request.getHeader("Authorization") == "Bearer new-access" -> MockResponse().setBody("""{"revision":"0","position":null,"unresolvedConflicts":[]}""")
                else -> MockResponse().setResponseCode(500)
            }
        }
        val results = (1..6).map { async { client.position("rec") } }.awaitAll()
        assertEquals(6, results.size)
        assertEquals("one single-flight exchange, not one per caller", 1, refreshes.get())
        assertEquals("new-access", store.load()!!.accessToken)
        assertNull(store.pendingRefreshId)
    }

    @Test
    fun `an ambiguous refresh failure retries the same request id and keeps the session`() = runBlocking {
        val ids = mutableListOf<String>()
        var failFirst = true
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.path!!.endsWith("/auth/native/refresh")) {
                    ids += Regex(""""requestId":"([^"]+)"""").find(request.body.readUtf8())!!.groupValues[1]
                    if (failFirst) { failFirst = false; return MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST) } // response lost
                    return MockResponse().setBody(pair("new-access", "new-refresh"))
                }
                return if (request.getHeader("Authorization") == "Bearer old-access") problem(401, "token_expired")
                else MockResponse().setBody("""{"revision":"0","position":null,"unresolvedConflicts":[]}""")
            }
        }
        try { client.position("rec"); fail("a lost refresh response must surface as transient") } catch (e: TransientException) { /* expected */ }
        assertNotNull("credentials must not be cleared by a network error", store.load())
        val pending = store.pendingRefreshId
        assertNotNull(pending)
        client.position("rec") // retry
        assertEquals("the ORIGINAL request id is retried, not a second exchange id", listOf(pending, pending), ids)
        assertNull(store.pendingRefreshId)
    }

    @Test
    fun `server session end clears credentials but 503 and 429 do not`() = runBlocking {
        val mode = java.util.concurrent.atomic.AtomicReference("503")
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.path!!.endsWith("/auth/native/refresh")) return when (val m = mode.get()) {
                    "503" -> problem(503, "temporarily_unavailable")
                    "429" -> problem(429, "rate_limited")
                    else -> problem(401, m)
                }
                return problem(401, "token_expired")
            }
        }
        for (m in listOf("503", "429")) {
            mode.set(m)
            try { client.position("rec"); fail() } catch (e: TransientException) { assertNotNull("$m must not log out", store.load()) }
        }
        mode.set("refresh_reuse")
        try { client.position("rec"); fail() } catch (e: SessionEndedException) { assertEquals("refresh_reuse", e.code) }
        assertNull("a confirmed session end clears credentials", store.load())
        assertNull(store.pendingRefreshId)
    }

    @Test
    fun `a revoked session is surfaced and stops the credentials`() = runBlocking {
        server.enqueue(problem(401, "session_revoked"))
        try { client.position("rec"); fail() } catch (e: SessionEndedException) { assertEquals("session_revoked", e.code) }
        assertNull(store.load())
    }

    @Test
    fun `typed problems carry code, status and conflict ids and never depend on detail text`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(409).setBody(
            """{"type":"x","title":"position_conflict","status":409,"detail":"anything","code":"position_conflict","requestId":"r","conflictId":"c-1"}"""))
        try {
            client.writePosition("rec", LPositionWrite("op", "0", "layout", LPositionInput("f", "v", 1, "2026-11-13T12:00:00Z")))
            fail()
        } catch (e: LitaraHttpException) {
            assertEquals(409, e.status)
            assertEquals("position_conflict", e.problem.code)
            assertEquals("c-1", e.problem.conflictId)
        }
        val body = server.takeRequest().body.readUtf8()
        assertTrue(body.contains(""""operationId":"op"""") && body.contains(""""baseRevision":"0""""))
    }

    @Test
    fun `explicit nulls are sent where the contract requires them`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"revision":"1","position":null,"unresolvedConflicts":[]}"""))
        client.resolveConflict("rec", "c", LResolveConflict("op", "1", "layout", "keep_server", null))
        assertTrue(server.takeRequest().body.readUtf8().contains(""""position":null"""))
    }
}
