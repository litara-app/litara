package com.litara.core.litara

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class EditionCompletionSyncTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var client: LitaraClient

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val store = InMemoryCredentialStore().also { it.save(StoredCredentials("a", "r")) }
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)
    }

    @After fun tearDown() = server.shutdown()

    private val pending get() = File(tmp.root, "pending-completion.json")
    private fun sync() = EditionCompletionSync(client, "e1", "f1", "v1", pending)
    private fun done(rev: String, finished: Boolean) = MockResponse().setBody("{\"revision\":\"$rev\",\"finished\":$finished,\"changedAt\":\"2026-11-17T12:00:00Z\"}")
    private fun problem(status: Int, code: String, extra: String) =
        MockResponse().setResponseCode(status).setBody("{\"type\":\"t\",\"title\":\"$code\",\"status\":$status,\"detail\":\"d\",\"code\":\"$code\",\"requestId\":\"r\"$extra}")
    private fun body(r: RecordedRequest) = Json.parseToJsonElement(r.body.readUtf8()).jsonObject
    private fun completion(rev: String, finished: Boolean) = LCompletion(rev, finished, "2026-11-17T12:00:00Z")

    @Test fun `finishing sends the exact identity and clears the saved write`() = runBlocking {
        server.enqueue(done("1", true))
        val out = sync().submit(true, "0")
        assertEquals(EditionCompletionOutcome.Accepted(completion("1", true)), out)
        val b = body(server.takeRequest())
        assertEquals("manual_finish", b["event"]!!.jsonPrimitive.content)
        assertEquals("0", b["baseRevision"]!!.jsonPrimitive.content)
        assertEquals("f1", b["fileId"]!!.jsonPrimitive.content)
        assertEquals("v1", b["contentVersion"]!!.jsonPrimitive.content)
        assertFalse(pending.exists())
    }

    @Test fun `a lost response replays the same operation after a restart`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(EditionCompletionOutcome.Queued, sync().submit(false, "3"))
        assertTrue("the write stays on disk until the server answers definitively", pending.exists())
        val id1 = body(server.takeRequest())["operationId"]!!.jsonPrimitive.content

        server.enqueue(done("4", false))
        val restarted = sync() // a new process finds the same file
        assertEquals(EditionCompletionOutcome.Accepted(completion("4", false)), restarted.flush())
        assertEquals(id1, body(server.takeRequest())["operationId"]!!.jsonPrimitive.content)
        assertFalse(pending.exists())
    }

    @Test fun `a second intent is never stacked behind an undelivered one`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503))
        val s = sync()
        s.submit(true, "0")
        server.takeRequest()
        server.enqueue(MockResponse().setResponseCode(503)) // still offline
        assertEquals(EditionCompletionOutcome.Queued, s.submit(false, "0"))
        assertEquals("only the original operation is retried", "manual_finish", body(server.takeRequest())["event"]!!.jsonPrimitive.content)
        assertEquals(2, server.requestCount)
        // Online again: the SAVED write goes out and the new request is not silently sent.
        server.enqueue(done("1", true))
        assertTrue(s.submit(false, "0") is EditionCompletionOutcome.EarlierDelivered)
        assertEquals("manual_finish", body(server.takeRequest())["event"]!!.jsonPrimitive.content)
        assertEquals(3, server.requestCount)
    }

    @Test fun `stale revision and changed bytes are surfaced with their candidate id`() = runBlocking {
        server.enqueue(problem(409, "stale_revision", ",\"conflictId\":\"c1\",\"currentRevision\":\"5\""))
        assertEquals(EditionCompletionOutcome.Conflict("c1", "5"), sync().submit(true, "2"))
        assertFalse("the server kept it as a candidate; no blind retry", pending.exists())
        server.enqueue(problem(412, "content_changed", ",\"conflictId\":\"c2\",\"currentContentVersion\":\"v9\""))
        assertEquals(EditionCompletionOutcome.ContentChanged("content_changed", "v9"), sync().submit(true, "5"))
        assertFalse(pending.exists())
    }

    @Test fun `conflict models round trip the contract and resolve sends the current revision`() = runBlocking {
        val conflicts = "{\"items\":[{\"id\":\"c1\",\"resourceKind\":\"completion\",\"resourceId\":\"e1\",\"editionId\":\"e1\",\"reason\":\"stale_revision\"," +
            "\"baseRevision\":\"2\",\"currentRevision\":\"5\",\"candidate\":{\"operationId\":\"o\",\"baseRevision\":\"2\",\"fileId\":\"f1\",\"contentVersion\":\"v1\"," +
            "\"event\":\"manual_finish\",\"capturedAt\":\"2026-11-17T12:00:00Z\"},\"createdAt\":\"2026-11-17T12:00:00Z\",\"resolvedAt\":null}],\"total\":1,\"page\":0,\"size\":50}"
        server.enqueue(MockResponse().setBody(conflicts))
        val all = client.listAllPersonalConflicts()
        assertEquals("completion", all.single().resourceKind)
        assertEquals("manual_finish", all.single().candidate.jsonObject["event"]!!.jsonPrimitive.content)
        assertTrue(server.takeRequest().path!!.contains("includeResolved=false"))

        server.enqueue(MockResponse().setBody("{\"conflictId\":\"c1\",\"resourceKind\":\"completion\",\"resourceId\":\"e1\",\"revision\":\"6\",\"resolvedAt\":\"2026-11-17T12:01:00Z\"}"))
        val res = client.resolvePersonalConflict("c1", LResolve("op1", "5", "use_candidate", null))
        assertEquals("6", res.revision)
        val b = body(server.takeRequest())
        assertEquals("5", b["baseRevision"]!!.jsonPrimitive.content)
        assertEquals("use_candidate", b["choice"]!!.jsonPrimitive.content)
        assertTrue("contentVersion must be sent explicitly as null", b.containsKey("contentVersion"))
    }
}
