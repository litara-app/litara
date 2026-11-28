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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class EditionAnnotationsTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var client: LitaraClient
    private val comicPolicy = LocatorPolicy(canonicalKinds = setOf("comic-page"))
    private val comic = LLocator.ComicPage(2, "entry-2", "m1")
    private val cfi = LLocator.FoliateCfi("epubcfi(/6/4)")

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val store = InMemoryCredentialStore().also { it.save(StoredCredentials("a", "r")) }
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)
    }

    @After fun tearDown() = server.shutdown()

    private fun sync(policy: LocatorPolicy, version: String = "v1", sub: String = "d", profile: String = "image-pages@profile-1", format: String = "cbz"): EditionAnnotationSync {
        val dir = java.io.File(tmp.root, sub).apply { mkdirs() }
        return EditionAnnotationSync(client, "e1", "f1", version, profile, format, policy, AnnotationStore(dir, "f1", version))
    }

    private fun serverCopy(id: String, rev: String, kind: String = "bookmark", version: String = "v1", loc: String = "{\"kind\":\"comic-page\",\"version\":1,\"pageIndex\":2,\"entryId\":\"entry-2\",\"manifestVersion\":\"m1\"}", text: String = "") =
        "{\"id\":\"$id\",\"editionId\":\"e1\",\"revision\":\"$rev\",\"deleted\":false,\"updatedAt\":\"2026-11-17T12:00:00Z\"," +
            "\"data\":{\"kind\":\"$kind\",\"anchor\":{\"fileId\":\"f1\",\"contentVersion\":\"$version\",\"locator\":$loc},\"selection\":null,\"text\":\"$text\",\"quote\":\"\"}}"

    private fun body(r: RecordedRequest) = Json.parseToJsonElement(r.body.readUtf8()).jsonObject

    @Test fun `epub style highlights and notes stay on the device and never touch the network`() = runBlocking {
        val s = sync(LocatorPolicy.NONE, profile = "foliate-js@78914aef/profile-1", format = "epub")
        val (a, out) = s.create("highlight", cfi, LSelection.FoliateRange("epubcfi(/6/4,/1:0,/1:5)"), "quote", "my note", "green", "Chapter 1")
        assertEquals(EditionReportOutcome.LocalOnly("foliate-js@78914aef/profile-1"), out)
        assertEquals(0, server.requestCount)
        assertEquals(listOf(a.id), s.store.visible().map { it.id })
        s.edit(a.id, text = "changed", color = "blue")
        assertEquals("changed", s.store.get(a.id)!!.text)
        assertEquals("blue", s.store.get(a.id)!!.color)
        s.delete(a.id)
        assertTrue(s.store.visible().isEmpty())
        assertEquals("a refresh asks nothing of the server either", null, s.refresh(setOf("foliate-cfi")))
        assertEquals(0, server.requestCount)
    }

    @Test fun `a version change shows none of the old annotations and keeps them`() = runBlocking {
        val s1 = sync(LocatorPolicy.NONE, "v1", "same", format = "epub")
        s1.create("bookmark", cfi, null, "", "", "yellow", null)
        val s2 = sync(LocatorPolicy.NONE, "v2", "same", format = "epub")
        assertTrue("never painted onto new bytes", s2.store.visible().isEmpty())
        assertEquals("the old record is still recoverable", 1, s1.store.visible().size)
    }

    @Test fun `PDF highlights from the web are stored, and one made in highlight mode is sent with its rectangles`() = runBlocking {
        val page = "{\"kind\":\"pdf-page\",\"version\":1,\"pageIndex\":3,\"x\":0.1,\"y\":0.2}"
        val highlight = serverCopy("h1", "1", "highlight", loc = page).replace("\"selection\":null",
            "\"selection\":{\"kind\":\"pdf-rectangles\",\"version\":1,\"pageIndex\":3,\"rectangles\":[{\"x\":0.1,\"y\":0.2,\"width\":0.3,\"height\":0.05}]}")
        val otherBytes = highlight.replace("\"h1\"", "\"h2\"").replace("\"contentVersion\":\"v1\"", "\"contentVersion\":\"v0\"")
        val s = sync(LocatorPolicy.NATIVE, profile = "pdfjs-dist@x/profile-1", format = "pdf")
        server.enqueue(MockResponse().setBody("{\"items\":[$highlight,$otherBytes],\"total\":2,\"page\":0,\"size\":200}"))
        s.refresh(setOf("pdf-page", "pdf-rectangles"))
        assertEquals("only this file's highlight", listOf("h1"), s.store.visible().map { it.id })
        server.takeRequest()

        server.enqueue(MockResponse().setBody(highlight))
        val picked = LSelection.PdfRectangles(3, listOf(LRectangle(0.2, 0.3, 0.25, 0.04)))
        val (_, outcome) = s.create("highlight", LLocator.PdfPage(3, 0.2, 0.3), picked, "words", "", "green", null)
        assertEquals(EditionReportOutcome.Accepted, outcome)
        val data = body(server.takeRequest())["data"]!!.jsonObject
        assertEquals("pdf-rectangles", data["selection"]!!.jsonObject["kind"]!!.jsonPrimitive.content)
        assertEquals("green", data["color"]!!.jsonPrimitive.content)
    }

    @Test fun `a comic bookmark is created with base 0 and a client id and then carries the server revision`() = runBlocking {
        server.enqueue(MockResponse().setBody(serverCopy("ignored", "1")))
        val s = sync(comicPolicy)
        val (a, out) = s.create("bookmark", comic, null, "", "", "yellow", null)
        assertEquals(EditionReportOutcome.Accepted, out)
        val req = server.takeRequest()
        assertEquals("PUT", req.method)
        assertEquals("/api/v1/editions/e1/annotations/${a.id}", req.path)
        val b = body(req)
        assertEquals("0", b["baseRevision"]!!.jsonPrimitive.content)
        assertEquals("bookmark", b["data"]!!.jsonObject["kind"]!!.jsonPrimitive.content)
        assertEquals("v1", b["data"]!!.jsonObject["anchor"]!!.jsonObject["contentVersion"]!!.jsonPrimitive.content)
        assertEquals("1", s.store.get(a.id)!!.revision)
        assertTrue(s.store.get(a.id)!!.synced)
        assertNull(s.store.get(a.id)!!.pending)
    }

    @Test fun `an offline create is saved first and retried with the same operation id`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503))
        val s = sync(comicPolicy)
        val (a, out) = s.create("note", comic, null, "", "remember", "yellow", null)
        assertEquals(EditionReportOutcome.Queued, out)
        val id1 = body(server.takeRequest())["operationId"]!!.jsonPrimitive.content
        assertEquals(id1, s.store.get(a.id)!!.pending!!.operationId)

        val restarted = sync(comicPolicy) // same directory: a new process
        server.enqueue(MockResponse().setBody(serverCopy(a.id, "1", "note", text = "remember")))
        restarted.refresh(setOf("comic-page"))
        val retry = server.takeRequest()
        assertEquals("PUT", retry.method)
        assertEquals(id1, body(retry)["operationId"]!!.jsonPrimitive.content)
        assertNull(restarted.store.get(a.id)!!.pending)
    }

    @Test fun `deleting a synced bookmark sends the current revision and keeps the tombstone`() = runBlocking {
        server.enqueue(MockResponse().setBody(serverCopy("x", "1")))
        val s = sync(comicPolicy)
        val (a, _) = s.create("bookmark", comic, null, "", "", "yellow", null)
        server.takeRequest()
        server.enqueue(MockResponse().setBody("{\"id\":\"${a.id}\",\"editionId\":\"e1\",\"revision\":\"2\",\"deleted\":true,\"data\":null,\"updatedAt\":\"2026-11-17T12:01:00Z\"}"))
        assertEquals(EditionReportOutcome.Accepted, s.delete(a.id))
        val req = server.takeRequest()
        assertEquals("DELETE", req.method)
        assertEquals("1", body(req)["baseRevision"]!!.jsonPrimitive.content)
        val t = s.store.get(a.id)!!
        assertTrue(t.deleted)
        assertEquals("2", t.revision)
        assertTrue(s.store.visible().isEmpty())
    }

    @Test fun `a stale revision is kept as a conflict and not retried`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(409).setBody("{\"type\":\"t\",\"title\":\"c\",\"status\":409,\"detail\":\"d\",\"code\":\"stale_revision\",\"requestId\":\"r\",\"conflictId\":\"c1\",\"currentRevision\":\"4\"}"))
        val s = sync(comicPolicy)
        val (a, out) = s.create("bookmark", comic, null, "", "", "yellow", null)
        assertEquals(EditionReportOutcome.Conflict("c1"), out)
        assertEquals("stale_revision", s.store.get(a.id)!!.conflict)
        assertNull(s.store.get(a.id)!!.pending)
        assertEquals(1, server.requestCount)
    }

    @Test fun `refresh merges only exact-version annotations, applies tombstones and keeps local work`() = runBlocking {
        val s = sync(comicPolicy)
        val mine = LocalAnnotation("mine", "bookmark", comic, createdAt = "t", updatedAt = "t", revision = "0", synced = false,
            pending = PendingAnnotationOp("op", "0", false, "t"))
        s.store.put(mine)
        val old = LocalAnnotation("old", "bookmark", comic, createdAt = "t", updatedAt = "t", revision = "1", synced = true)
        s.store.put(old)
        server.enqueue(MockResponse().setBody(serverCopy("mine", "1"))) // PUT for the pending create
        val list = "{\"items\":[" + listOf(
            serverCopy("new", "1"), // created elsewhere
            serverCopy("other-bytes", "1", version = "v-other"),
            "{\"id\":\"old\",\"editionId\":\"e1\",\"revision\":\"2\",\"deleted\":true,\"data\":null,\"updatedAt\":\"2026-11-17T12:00:00Z\"}",
        ).joinToString(",") + "],\"total\":3,\"page\":0,\"size\":200}"
        server.enqueue(MockResponse().setBody(list))
        s.refresh(setOf("comic-page"))
        val ids = s.store.visible().map { it.id }.toSet()
        assertTrue("created elsewhere appears", "new" in ids)
        assertFalse("other bytes are never shown", "other-bytes" in ids)
        assertFalse("a server tombstone hides the local copy", "old" in ids)
        assertNotNull(s.store.get("old")).also { assertTrue(s.store.get("old")!!.deleted) }
        assertTrue("local pending work was delivered, not overwritten", s.store.get("mine")!!.synced)
    }
}
