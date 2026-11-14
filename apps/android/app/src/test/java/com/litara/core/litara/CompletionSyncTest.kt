package com.litara.core.litara

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/** R2: completion events are durable, keep their operation id across offline/restart/response loss, and stay account-scoped. */
class CompletionSyncTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var client: LitaraClient
    private val puts = CopyOnWriteArrayList<String>()
    @Volatile private var online = true
    @Volatile private var dropResponse = false
    private val anchor = LAnchor("f1", "v1", 90_000)

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(),
            InMemoryCredentialStore().also { it.save(StoredCredentials("tok", "ref")) })
        var revision = 0
        val seen = HashSet<String>()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (!online) return MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST)
                if (request.method == "GET") return MockResponse().setBody("""{"revision":"$revision","finished":false,"changedAt":null}""")
                val body = request.body.readUtf8()
                puts += body
                if (seen.add(opId(body))) revision++ // an identical retry is a recorded receipt, not a new revision
                if (dropResponse) { dropResponse = false; return MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST) }
                return MockResponse().setBody("""{"revision":"$revision","finished":true,"changedAt":"t"}""")
            }
        }
    }

    @After
    fun tearDown() = server.shutdown()

    private fun sync(file: File = File(tmp.root, "pending-completion.json")) = CompletionSync(client, "rec", file)
    private fun opId(body: String) = body.substringAfter("operationId\":\"").substringBefore('"')

    @Test
    fun `an offline natural end is queued durably and delivered later with its original operation id`() = runBlocking {
        online = false
        assertEquals(FinishOutcome.Queued, sync().submit("natural_end", "L", anchor, "0"))
        val file = File(tmp.root, "pending-completion.json")
        assertTrue(file.exists())
        val queuedId = opId(file.readText())

        online = true // process restart: a new instance reads the same file after reconnecting
        assertTrue(sync().flush() is FinishOutcome.Done)
        assertEquals(1, puts.size)
        assertEquals("the retry keeps the original operation id", queuedId, opId(puts[0]))
        assertTrue(puts[0].contains("\"event\":\"natural_end\"") && puts[0].contains("\"layoutRevision\":\"L\"") && puts[0].contains("\"v1\""))
        assertFalse(file.exists())
    }

    @Test
    fun `a lost response keeps the event and the retry re-sends the same operation id`() = runBlocking {
        dropResponse = true
        assertEquals(FinishOutcome.Queued, sync().submit("manual_finish", "L", null, "0"))
        assertTrue(sync().hasPending())
        assertTrue(sync().flush() is FinishOutcome.Done)
        assertEquals(2, puts.size)
        assertEquals(opId(puts[0]), opId(puts[1]))
    }

    @Test
    fun `a definitive 412 preserves the evidence server side and clears the local queue`() = runBlocking {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) =
                if (request.method == "GET") MockResponse().setBody("""{"revision":"0","finished":false,"changedAt":null}""")
                else MockResponse().setResponseCode(412).setHeader("Content-Type", "application/problem+json")
                    .setBody("""{"type":"x","title":"t","status":412,"detail":"d","code":"layout_changed","requestId":"r","conflictId":"c1"}""")
        }
        assertEquals(FinishOutcome.Preserved("layout_changed", "c1"), sync().submit("manual_finish", "L", null, "0"))
        assertFalse(sync().hasPending())
    }

    @Test
    fun `queued events are scoped to their file so another account never delivers them`() = runBlocking {
        online = false
        sync(File(tmp.root, "accountA/pending-completion.json")).submit("manual_finish", "L", null, "0")
        online = true
        assertNull("account B has its own queue and nothing to deliver", sync(File(tmp.root, "accountB/pending-completion.json")).flush())
        assertEquals(0, puts.size)
    }

    @Test
    fun `several offline events are delivered in order and later ones are re-based`() = runBlocking {
        online = false
        val s = sync()
        s.submit("manual_finish", "L", null, "0")
        s.submit("manual_unfinish", "L", null, "0")
        online = true
        s.flush()
        assertEquals(2, puts.size)
        assertTrue(puts[0].contains("manual_finish") && puts[1].contains("manual_unfinish"))
        assertTrue("the follower is re-based on the head's revision", puts[1].contains("\"baseRevision\":\"1\""))
    }
}
