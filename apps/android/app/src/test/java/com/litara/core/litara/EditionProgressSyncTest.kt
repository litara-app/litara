package com.litara.core.litara

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class EditionProgressSyncTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var client: LitaraClient
    private val web = "foliate-js@web-profile"

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val store = InMemoryCredentialStore().also { it.save(StoredCredentials("a", "r")) }
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)
    }

    @After fun tearDown() = server.shutdown()

    private fun sync(
        version: String = "v1",
        compatible: Set<String> = setOf(web),
        dir: java.io.File = tmp.root,
        downloadedState: LEditionPositionState? = null,
    ) = EditionProgressSync(client, "e1", "f1", version, web, "epub", LocatorPolicy(compatible), dir, downloadedState)

    private fun state(rev: String) = """{"revision":"$rev","position":null,"unresolvedConflictCount":0,"conflictsPath":"/api/v1/personal-conflicts"}"""
    private fun problem(status: Int, code: String, extra: String = "") =
        MockResponse().setResponseCode(status).setBody("""{"type":"t","title":"$code","status":$status,"detail":"d","code":"$code","requestId":"r"$extra}""")

    @Test fun `an unproven engine profile never leaves the device and is never reported as saved to the server`() = runBlocking {
        val s = sync(compatible = emptySet())
        val out = s.report("epubcfi(/6/2)", 0.25)
        assertEquals(EditionReportOutcome.LocalOnly(web), out)
        assertEquals("no request may be made", 0, server.requestCount)
        assertEquals("epubcfi(/6/2)", s.local()?.cfi)
        assertNull("a position for other bytes is never offered", sync(version = "v2", compatible = emptySet()).local())
        assertNull("no server read either", s.serverCfi())
        assertEquals(0, server.requestCount)
    }

    @Test fun `a compatible profile sends revision-aware writes and learns the new revision`() = runBlocking {
        server.enqueue(MockResponse().setBody(state("1")))
        server.enqueue(MockResponse().setBody(state("2")))
        val s = sync()
        assertEquals(EditionReportOutcome.Accepted, s.report("epubcfi(/6/2)", 0.1))
        assertEquals(EditionReportOutcome.Accepted, s.report("epubcfi(/6/4)", 0.2))
        val first = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        val second = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("0", first["baseRevision"]!!.jsonPrimitive.content)
        assertEquals("1", second["baseRevision"]!!.jsonPrimitive.content)
        assertEquals("v1", first["anchor"]!!.jsonObject["contentVersion"]!!.jsonPrimitive.content)
    }

    @Test fun `offline sends use the download revision and later restarts remember finer server progress`() = runBlocking {
        val downloaded = LitaraJson.decodeFromString<LEditionPositionState>(state("6"))
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(EditionReportOutcome.Queued, sync(downloadedState = downloaded).report("epubcfi(/6/2)", 0.1))
        val first = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("6", first["baseRevision"]!!.jsonPrimitive.content)

        server.enqueue(MockResponse().setBody(state("7")))
        assertEquals(EditionReportOutcome.Accepted, sync(downloadedState = downloaded).flushPending())
        server.takeRequest()
        assertEquals("7", sync(downloadedState = downloaded).revision)
        assertEquals("0", sync(version = "v2").revision)
    }

    @Test fun `a lost response is retried with the same operation id after a restart`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503))
        val s = sync()
        assertEquals(EditionReportOutcome.Queued, s.report("epubcfi(/6/2)", 0.1))
        val id1 = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject["operationId"]!!.jsonPrimitive.content

        val restarted = sync() // new process: same directory
        assertTrue(restarted.hasPending())
        server.enqueue(MockResponse().setBody(state("1")))
        assertEquals(EditionReportOutcome.Accepted, restarted.flushPending())
        val id2 = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject["operationId"]!!.jsonPrimitive.content
        assertEquals("replay must reuse the original operation identity", id1, id2)
        assertFalse(restarted.hasPending())
    }

    @Test fun `stale revision and content change are surfaced, not overwritten`() = runBlocking {
        server.enqueue(problem(409, "stale_revision", ""","conflictId":"c9","currentRevision":"5""""))
        server.enqueue(MockResponse().setBody(state("5"))) // refresh after conflict
        val s = sync()
        assertEquals(EditionReportOutcome.Conflict("c9"), s.report("epubcfi(/6/2)", 0.1))
        assertEquals("5", s.revision)
        server.enqueue(problem(412, "content_changed", ""","currentContentVersion":"v9""""))
        assertEquals(EditionReportOutcome.ContentChanged("content_changed", "v9"), s.report("epubcfi(/6/4)", 0.2))
        assertFalse("a definitive answer is not retried", s.hasPending())
    }
}
