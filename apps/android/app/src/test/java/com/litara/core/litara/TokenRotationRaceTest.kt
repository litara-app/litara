package com.litara.core.litara

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/**
 * Found on a real device: after an idle hour two screens loaded at once. One refreshed (rotating both tokens);
 * the other had already read the OLD access token and sent it afterwards. The server no longer knows a rotated-away
 * token and answers `unauthenticated` (not `token_expired`), so the request failed although the account was fine.
 * A request whose token was replaced while it was in flight must be retried once with the current one.
 */
class TokenRotationRaceTest {
    private lateinit var server: MockWebServer
    private lateinit var store: InMemoryCredentialStore
    private lateinit var client: LitaraClient

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        store = InMemoryCredentialStore().also { it.save(StoredCredentials("old-access", "old-refresh")) }
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)
    }

    @After fun tearDown() = server.shutdown()

    private fun unauthenticated() = MockResponse().setResponseCode(401).setHeader("Content-Type", "application/problem+json")
        .setBody("{\"type\":\"t\",\"title\":\"u\",\"status\":401,\"detail\":\"d\",\"code\":\"unauthenticated\",\"requestId\":\"r\"}")

    @Test fun `a request sent with a token that was rotated while it was in flight is retried with the new one`() = runBlocking {
        val oldTokenRequests = AtomicInteger()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.getHeader("Authorization")) {
                "Bearer old-access" -> { // meanwhile another caller finished a refresh
                    oldTokenRequests.incrementAndGet()
                    store.save(StoredCredentials("new-access", "new-refresh"))
                    unauthenticated()
                }
                "Bearer new-access" -> MockResponse().setBody("{\"revision\":\"0\",\"position\":null,\"unresolvedConflicts\":[]}")
                else -> MockResponse().setResponseCode(500)
            }
        }
        val r = client.position("rec")
        assertEquals("0", r.revision)
        assertEquals("the stale token was tried once, not looped", 1, oldTokenRequests.get())
        assertEquals("exactly one retry with the current token", 2, server.requestCount)
    }

    @Test fun `a genuinely unknown token with nothing newer still fails and is not retried`() = runBlocking {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = unauthenticated()
        }
        try {
            client.position("rec")
            org.junit.Assert.fail("must surface the 401")
        } catch (e: LitaraHttpException) {
            assertEquals("unauthenticated", e.problem.code)
        }
        assertEquals(1, server.requestCount)
    }

    @Test fun `parallel callers after expiry all succeed`() = runBlocking {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when {
                request.path!!.endsWith("/auth/native/refresh") -> { Thread.sleep(100); MockResponse().setBody(pair("new-access", "new-refresh")) }
                request.getHeader("Authorization") == "Bearer old-access" ->
                    // the first ones learn the token expired; later ones arrive after rotation and hear `unauthenticated`
                    if (store.load()?.accessToken == "old-access") MockResponse().setResponseCode(401).setBody("{\"code\":\"token_expired\",\"status\":401}") else unauthenticated()
                request.getHeader("Authorization") == "Bearer new-access" -> MockResponse().setBody("{\"revision\":\"0\",\"position\":null,\"unresolvedConflicts\":[]}")
                else -> MockResponse().setResponseCode(500)
            }
        }
        val results = (1..8).map { async { client.position("rec") } }.awaitAll()
        assertEquals(8, results.size)
    }

    private fun pair(access: String, refresh: String) =
        "{\"accessToken\":\"$access\",\"tokenType\":\"Bearer\",\"expiresIn\":900,\"refreshToken\":\"$refresh\"," +
            "\"session\":{\"id\":\"s\",\"deviceName\":\"d\",\"client\":\"native\",\"createdAt\":\"2026-11-13T12:00:00Z\",\"lastUsedAt\":\"2026-11-13T12:00:00Z\",\"idleExpiresAt\":\"2026-12-13T12:00:00Z\",\"absoluteExpiresAt\":\"2027-02-11T12:00:00Z\"}," +
            "\"user\":{\"id\":\"u\",\"username\":\"a\",\"displayName\":\"A\",\"isAdmin\":false,\"active\":true}}"
}
