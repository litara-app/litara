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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AudioBookmarksTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var client: LitaraClient

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val store = InMemoryCredentialStore().also { it.save(StoredCredentials("a", "r")) }
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)
    }

    @After fun tearDown() = server.shutdown()

    private fun sync() = AudioBookmarkSync(client, "r1", AudioBookmarkStore(tmp.root))

    private val place = LAudioBookmarkData("f1", "v1", 1500, "layout-1", "here")

    private fun copy(id: String, revision: String, note: String = "here", deleted: Boolean = false) =
        "{\"id\":\"$id\",\"recordingId\":\"r1\",\"revision\":\"$revision\",\"deleted\":$deleted,\"available\":true," +
            "\"createdAt\":\"2026-11-26T12:00:00Z\",\"updatedAt\":\"2026-11-26T12:00:00Z\",\"data\":" +
            (if (deleted) "null" else "{\"fileId\":\"f1\",\"contentVersion\":\"v1\",\"offsetMs\":1500,\"layoutRevision\":\"layout-1\",\"note\":\"$note\"}") + "}"

    private fun body(r: RecordedRequest) = Json.parseToJsonElement(r.body.readUtf8()).jsonObject
    private fun field(r: kotlinx.serialization.json.JsonObject, name: String) = r[name]!!.jsonPrimitive.content
    private fun down() = server.enqueue(MockResponse().setResponseCode(503).setBody("{}"))
    private fun ok(text: String) = server.enqueue(MockResponse().setBody(text))

    @Test fun `a bookmark made offline is kept and later sent with the same operation id`() = runBlocking {
        down()
        val made = sync().create(place)
        assertNotNull(made.pending)
        assertEquals(listOf(made.id), sync().store.visible().map { it.id })
        val firstOp = field(body(server.takeRequest()), "operationId")

        ok(copy(made.id, "1"))
        assertEquals(false, sync().flushPending())
        val retried = body(server.takeRequest())
        assertEquals(firstOp, field(retried, "operationId"))
        assertEquals("0", field(retried, "baseRevision"))
        val stored = sync().store.get(made.id)!!
        assertEquals("1", stored.revision)
        assertNull(stored.pending)
    }

    @Test fun `delete checks the revision and a bookmark never sent is simply removed`() = runBlocking {
        ok(copy("x", "1"))
        val made = sync().create(place)
        server.takeRequest()
        sync().store.put(made.copy(id = "x", revision = "1", pending = null))
        sync().store.remove(made.id)
        ok(copy("x", "2", deleted = true))
        sync().delete("x")
        val del = server.takeRequest()
        assertEquals("DELETE", del.method)
        assertEquals("1", field(body(del), "baseRevision"))
        assertTrue(sync().store.all().isEmpty())
    }

    @Test fun `a refused change is marked for a choice and the server's version comes back`() = runBlocking {
        val local = LocalAudioBookmark("x", place, "2026-11-26T12:00:00Z", revision = "1")
        sync().store.put(local)
        server.enqueue(MockResponse().setResponseCode(409).setBody("{\"code\":\"stale_revision\",\"conflictId\":\"c1\"}"))
        sync().rename("x", "mine")
        assertEquals("stale_revision", sync().store.get("x")!!.conflict)
        assertNull(sync().store.get("x")!!.pending)

        ok("{\"items\":[${copy("x", "2", note = "theirs")}],\"total\":1,\"page\":0,\"size\":200}")
        sync().refresh()
        val after = sync().store.get("x")!!
        assertEquals("theirs", after.data.note)
        assertEquals("2", after.revision)
    }

    @Test fun `refresh removes what the server deleted and keeps this device's unsent change`() = runBlocking {
        sync().store.put(LocalAudioBookmark("gone", place, "t", revision = "1"))
        down()
        val unsent = sync().create(place)
        down() // the retry during refresh
        ok("{\"items\":[${copy("gone", "2", deleted = true)},${copy("other", "1")}],\"total\":2,\"page\":0,\"size\":200}")
        sync().refresh()
        assertEquals(setOf(unsent.id, "other"), sync().store.visible().map { it.id }.toSet())
    }

    @Test fun `a bookmark is unavailable once its file version or layout changes`() {
        val b = LocalAudioBookmark("x", place, "t")
        fun snap(layout: String, version: String) = LRecording("r1", "t", "l", "T", emptyList(), emptyList(), "ready", 1000, LArtwork(null, null),
            LCompletion("0", false, null), null, 1, layout, listOf(LFile("f1", version, 0, "a.mp3", "audio/mpeg", 1, 1000, true, "/c")),
            emptyList(), LCapabilities(true, true, true), emptyList())
        assertTrue(b.availableIn(snap("layout-1", "v1")))
        assertEquals(false, b.availableIn(snap("layout-2", "v1")))
        assertEquals(false, b.availableIn(snap("layout-1", "v2")))
    }
}
