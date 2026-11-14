package com.litara.core.litara

import kotlinx.coroutines.async
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
import java.util.concurrent.CopyOnWriteArrayList

/** Offline queue, same-operation retry and conflict handling of the position reporter. */
class ProgressSyncTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var sync: ProgressSync
    private val bodies = CopyOnWriteArrayList<String>()
    private val files = listOf(
        LFile("f0", "v0", 0, "a", "audio/mpeg", 10, 60_000, true, "/x"),
        LFile("f1", "v1", 1, "b", "audio/mpeg", 10, 90_000, true, "/y"),
    )
    private val position = """{"fileId":"f0","contentVersion":"v0","offsetMs":5000,"layoutRevision":"L","capturedAt":"t","receivedAt":"t","deviceName":"d"}"""

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
        val store = InMemoryCredentialStore().also { it.save(StoredCredentials("tok", "ref")) }
        val client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)
        sync = ProgressSync(client, "rec", "L", files, tmp.newFile("pending.json").also { it.delete() })
    }

    @After
    fun tearDown() = server.shutdown()

    private fun script(vararg answers: (String) -> MockResponse) {
        var i = 0
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = request.body.readUtf8()
                if (request.method == "PUT") bodies += body
                return answers[minOf(i++, answers.size - 1)](body)
            }
        }
    }

    private fun accepted(rev: String) = { _: String -> MockResponse().setBody("""{"revision":"$rev","position":$position,"unresolvedConflicts":[]}""") }

    @Test
    fun `reports carry the last revision and the layout, never a device clock decision`() = runBlocking {
        script(accepted("1"), accepted("2"))
        assertEquals(ReportOutcome.Accepted, sync.report(0, 5000))
        assertEquals(ReportOutcome.Accepted, sync.report(1, 7000))
        assertTrue(bodies[0].contains(""""baseRevision":"0"""") && bodies[0].contains(""""layoutRevision":"L""""))
        assertTrue(bodies[1].contains(""""baseRevision":"1""""))
        assertEquals("2", sync.revision)
    }

    @Test
    fun `an offline report is queued and retried with the SAME operation id`() = runBlocking {
        script({ MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST) }, accepted("1"))
        assertEquals(ReportOutcome.Queued, sync.report(0, 5000))
        assertTrue(sync.hasPending())
        assertEquals(ReportOutcome.Accepted, sync.flushPending())
        assertFalse(sync.hasPending())
        val ids = bodies.map { Regex(""""operationId":"([^"]+)"""").find(it)!!.groupValues[1] }
        assertEquals("a retry must be the identical operation", 2, ids.size)
        assertEquals(ids[0], ids[1])
    }

    @Test
    fun `a stale write becomes a durable conflict, is surfaced, and is not retried`() = runBlocking {
        script(
            { MockResponse().setResponseCode(409).setBody("""{"code":"position_conflict","status":409,"detail":"x","requestId":"r","conflictId":"c1"}""") },
            { MockResponse().setBody("""{"revision":"3","position":$position,"unresolvedConflicts":[{"id":"c1","reason":"stale_revision","candidate":null,"baseRevision":"0","createdAt":"t","resolvedAt":null}]}""") },
        )
        val out = sync.report(0, 5000)
        assertEquals(ReportOutcome.Conflict("c1"), out)
        assertFalse("the server preserved the candidate; nothing stays queued", sync.hasPending())
        assertEquals("3", sync.revision)
        assertEquals(listOf("c1"), sync.conflicts.map { it.id })
    }

    @Test
    fun `layout or content change is reported so the snapshot is refetched`() = runBlocking {
        script({ MockResponse().setResponseCode(412).setBody("""{"code":"content_changed","status":412,"detail":"x","requestId":"r","conflictId":"c2","currentLayoutRevision":"L2"}""") })
        val out = sync.report(1, 100)
        assertEquals(ReportOutcome.SnapshotChanged("content_changed", "L2"), out)
        assertFalse(sync.hasPending())
    }

    @Test
    fun `revoked access stops reporting and keeps the candidate locally`() = runBlocking {
        script({ MockResponse().setResponseCode(403).setBody("""{"code":"library_access_denied","status":403,"detail":"x","requestId":"r"}""") })
        assertEquals(ReportOutcome.AccessEnded("library_access_denied"), sync.report(0, 1))
    }

    @Test
    fun `the offset is never beyond the file duration`() = runBlocking {
        script(accepted("1"))
        sync.report(0, 999_999)
        assertTrue(bodies[0].contains(""""offsetMs":60000"""))
    }

    @Test
    fun `overlapping reports are serialized`() = runBlocking {
        script(accepted("1"), accepted("2"), accepted("3"), accepted("4"))
        val r = (1..4).map { i -> async { sync.report(0, 1000L * i) } }.map { it.await() }
        assertTrue(r.all { it == ReportOutcome.Accepted })
        assertEquals(listOf("0", "1", "2", "3"), bodies.map { Regex(""""baseRevision":"(\d+)"""").find(it)!!.groupValues[1] })
    }
}

/** R1: a saved position for different bytes is preserved and never applied; a compatible reorder still resumes. */
class ProgressSyncCompatibilityTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private val puts = CopyOnWriteArrayList<String>()

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
    }

    @After
    fun tearDown() = server.shutdown()

    private fun sync(files: List<LFile>, savedFile: String, savedVersion: String): ProgressSync {
        val pos = """{"fileId":"$savedFile","contentVersion":"$savedVersion","offsetMs":5000,"layoutRevision":"L0","capturedAt":"t","receivedAt":"t","deviceName":"d"}"""
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.method == "PUT") puts += request.body.readUtf8()
                return MockResponse().setBody("""{"revision":"3","position":$pos,"unresolvedConflicts":[]}""")
            }
        }
        val client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().build(),
            InMemoryCredentialStore().also { it.save(StoredCredentials("t", "r")) })
        return ProgressSync(client, "rec", "L1", files, tmp.newFile().also { it.delete() })
    }

    private fun file(id: String, version: String) = LFile(id, version, 0, id, "audio/mpeg", 10, 60_000, true, "/x")

    @Test
    fun `same file id with a new content version does not resume the old offset`() = runBlocking {
        val s = sync(listOf(file("F", "V2")), "F", "V1")
        s.load()
        assertNull("the V1 offset must not be applied to V2 bytes", s.resumeCandidate())
        assertEquals("F", s.incompatiblePosition()!!.fileId)
        assertEquals("V1", s.incompatiblePosition()!!.contentVersion)
    }

    @Test
    fun `an incompatible saved position blocks writes until the user chooses to start over`() = runBlocking {
        val s = sync(listOf(file("F", "V2")), "F", "V1")
        s.load()
        assertTrue(s.report(0, 1000) is ReportOutcome.NeedsChoice)
        assertTrue("nothing was written over the preserved position", puts.isEmpty())
        s.confirmStartOver()
        assertEquals(ReportOutcome.Accepted, s.report(0, 1000))
        assertEquals(1, puts.size)
    }

    @Test
    fun `a reporter that never read the server learns the revision first instead of conflicting with itself`() = runBlocking {
        val s = sync(listOf(file("F", "V1")), "F", "V1")
        s.ensureLoaded()
        assertEquals(ReportOutcome.Accepted, s.report(0, 1000))
        assertTrue("the first write carries the server revision, not 0", puts[0].contains("\"baseRevision\":\"3\""))
    }

    @Test
    fun `a compatible reorder keeps the saved position because offsets are file relative`() = runBlocking {
        val s = sync(listOf(file("G", "VG"), file("F", "V1")), "F", "V1")
        s.load()
        assertEquals("F", s.resumeCandidate()!!.fileId)
        assertNull(s.incompatiblePosition())
    }
}
