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
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class SessionsTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var client: LitaraClient

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val store = InMemoryCredentialStore().also { it.save(StoredCredentials("a", "r")) }
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)
    }

    @After fun tearDown() = server.shutdown()

    private fun outbox(name: String = "sessions") = SessionOutbox(File(tmp.root, name))

    private fun entry(id: String = "s1", kind: SessionKind = SessionKind.LISTEN, seconds: Long = 60) =
        SessionEntry(id, kind, "target", 1_000_000, 1_000_000 + seconds * 1000, seconds, 0.1, 0.2)

    @Test fun `listening counts played wall-clock time and leaves out pauses and sleep`() {
        val clock = SessionClock.listening()
        var t = 0L
        clock.active("r1", 0.1, t)
        repeat(6) { t += 5_000; clock.active("r1", 0.2, t) }
        t += 5_000
        clock.pause(t) // 35 s played
        t += 10 * 60_000 // paused: not counted, same session
        assertNull(clock.active("r1", 0.2, t))
        t += 20_000
        clock.active("r1", 0.3, t) // 55 s
        t += 20 * 60_000 // the device slept while "playing": not counted
        clock.active("r1", 0.3, t)
        val s = clock.snapshot()!!
        assertEquals(55, s.seconds)
        assertEquals(0.1, s.startFraction!!, 0.0001)
        assertEquals(0.3, s.endFraction!!, 0.0001)
    }

    @Test fun `a long pause or another target starts a new session`() {
        val clock = SessionClock.listening()
        clock.active("r1", 0.0, 0)
        clock.active("r1", 0.0, 30_000)
        clock.pause(30_000)
        val first = clock.active("r1", 0.0, 30_000 + 31 * 60_000L)!!
        assertEquals(30, first.seconds)
        val second = clock.active("r2", 0.0, 30_000 + 31 * 60_000L + 40_000)!!
        assertEquals("r1", second.targetId)
        assertEquals(40, second.seconds)
        assertNotEquals(first.sessionId, second.sessionId)
    }

    @Test fun `reading stays active for two minutes after the last page turn`() {
        val clock = SessionClock.reading()
        clock.active("e1", 0.1, 0)
        clock.active("e1", 0.2, 60_000) // 60 s
        clock.active("e1", 0.3, 60_000 + 10 * 60_000L) // ten idle minutes count as two
        assertEquals(180, clock.snapshot()!!.seconds)
    }

    @Test fun `less than five seconds is not kept`() {
        val clock = SessionClock.listening()
        clock.active("r1", 0.0, 0)
        assertNull(clock.end(3_000))
    }

    @Test fun `sessions survive an outage and a restart, then are sent to their own routes`() = runBlocking {
        outbox().put(entry("listen-1"))
        outbox().put(entry("read-1", SessionKind.READ, 90))
        server.enqueue(MockResponse().setResponseCode(503).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(503).setBody("{}"))
        assertTrue(outbox().flush(client))
        assertEquals(2, outbox().all().size)
        repeat(2) { server.takeRequest() }

        server.enqueue(MockResponse().setResponseCode(204))
        server.enqueue(MockResponse().setResponseCode(204))
        assertFalse(outbox().flush(client)) // a new object, as after a restart
        val sent = listOf(server.takeRequest(), server.takeRequest()).associateBy { it.path!! }
        val listen = sent.getValue("/api/v1/recordings/target/listening-sessions/listen-1")
        val read = sent.getValue("/api/v1/editions/target/reading-sessions/read-1")
        assertEquals("PUT", listen.method)
        assertEquals("60", Json.parseToJsonElement(listen.body.readUtf8()).jsonObject["listenedSeconds"]!!.jsonPrimitive.content)
        assertEquals("90", Json.parseToJsonElement(read.body.readUtf8()).jsonObject["activeSeconds"]!!.jsonPrimitive.content)
    }

    @Test fun `a definitive refusal drops a session but lost access keeps it`() = runBlocking {
        outbox().put(entry("a"))
        server.enqueue(MockResponse().setResponseCode(403).setBody("{\"code\":\"access_denied\"}"))
        assertTrue(outbox().flush(client))
        assertEquals(1, outbox().all().size)
        server.enqueue(MockResponse().setResponseCode(422).setBody("{\"code\":\"validation_failed\"}"))
        assertFalse(outbox().flush(client))
        assertTrue(outbox().all().isEmpty())
    }

    @Test fun `a recent session the server calls invalid is kept for a day, as a fast clock would need`() = runBlocking {
        val recent = SessionOutbox(File(tmp.root, "clock"), nowMs = { 1_100_000 })
        recent.put(entry("fast-clock"))
        server.enqueue(MockResponse().setResponseCode(422).setBody("{\"code\":\"validation_failed\"}"))
        assertTrue(recent.flush(client))
        val later = SessionOutbox(File(tmp.root, "clock"), nowMs = { 1_100_000 + 25 * 3600_000L })
        server.enqueue(MockResponse().setResponseCode(422).setBody("{\"code\":\"validation_failed\"}"))
        assertFalse(later.flush(client))
    }

    @Test fun `another account's queue is separate`() {
        outbox("account-a").put(entry("a"))
        assertTrue(outbox("account-b").all().isEmpty())
    }
}
