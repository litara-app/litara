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
import java.io.File

/**
 * Pins exactly what [LocatorPolicy.NATIVE] allows. The evidence (research/t007/evidence/m1-locators) covers EPUB and FB2 with
 * Foliate CFIs and range selections, PDF pages and the rectangles of highlight mode (ADR-0113), and comic page identities.
 * Everything else must stay refused.
 */
class NativePolicyTest {
    private val p = LocatorPolicy.NATIVE
    private val web = "foliate-js@78914aef/profile-1"
    private val cfi = LLocator.FoliateCfi("epubcfi(/6/4!/4/2/1:0)")

    @Test fun `epub and fb2 foliate locators and selections are allowed`() {
        for (f in listOf("epub", "fb2")) {
            assertTrue(f, p.allows(web, cfi, f))
            assertTrue(f, p.allowsSelection(web, LSelection.FoliateRange("epubcfi(/6/4!/4,/1:0,/1:3)"), f))
        }
    }

    @Test fun `formats without evidence stay device-only`() {
        for (f in listOf("kepub", "mobi", "azw", "azw3", "cbz")) assertFalse(f, p.allows(web, cfi, f))
    }

    @Test fun `pdf pages and highlight rectangles are allowed for pdf files only`() {
        val pdfProfile = "pdfjs-dist@6.5.438/profile-1"
        assertTrue(p.allows(pdfProfile, LLocator.PdfPage(3, 0.0, 0.0), "pdf"))
        val rectangles = LSelection.PdfRectangles(3, listOf(LRectangle(0.1, 0.1, 0.2, 0.02)))
        assertTrue(p.allowsSelection(pdfProfile, rectangles, "pdf"))
        assertFalse(p.allowsSelection(pdfProfile, rectangles, "epub"))
        assertFalse("a pdf locator is not valid for other formats", p.allows(pdfProfile, LLocator.PdfPage(3, 0.0, 0.0), "epub"))
    }

    @Test fun `comic page identities are allowed for every comic format`() {
        val c = LLocator.ComicPage(2, "e", "m")
        for (f in listOf("cbz", "cbr", "cb7")) assertTrue(f, p.allows("image-pages@profile-1", c, f))
    }

    @Test fun `no blanket profile is claimed`() {
        assertTrue(p.compatibleProfiles.isEmpty())
    }
}

/** With the product policy an EPUB position and highlight are sent, and annotations made while device-only are adopted. */
class NativePolicySyncTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var client: LitaraClient
    private val profile = "foliate-js@78914aef/profile-1"

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val store = InMemoryCredentialStore().also { it.save(StoredCredentials("a", "r")) }
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)
    }

    @After fun tearDown() = server.shutdown()

    private fun state(rev: String) = "{\"revision\":\"$rev\",\"position\":null,\"unresolvedConflictCount\":0,\"conflictsPath\":\"/api/v1/personal-conflicts\"}"
    private fun annotation(id: String, rev: String) =
        "{\"id\":\"$id\",\"editionId\":\"e1\",\"revision\":\"$rev\",\"deleted\":false,\"updatedAt\":\"2026-11-17T12:00:00Z\",\"data\":null}"

    @Test fun `an epub position is sent as a foliate cfi under the native policy`() = runBlocking {
        server.enqueue(MockResponse().setBody(state("1")))
        val s = EditionProgressSync(client, "e1", "f1", "v1", profile, "epub", LocatorPolicy.NATIVE, tmp.newFolder("p"))
        assertEquals(EditionReportOutcome.Accepted, s.report("epubcfi(/6/4!/4/2/1:5)", 0.2))
        val loc = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject["anchor"]!!.jsonObject["locator"]!!.jsonObject
        assertEquals("foliate-cfi", loc["kind"]!!.jsonPrimitive.content)
    }

    @Test fun `a kepub position is still device-only`() = runBlocking {
        val s = EditionProgressSync(client, "e1", "f1", "v1", profile, "kepub", LocatorPolicy.NATIVE, tmp.newFolder("k"))
        assertEquals(EditionReportOutcome.LocalOnly(profile), s.report("epubcfi(/6/4!/4/2/1:5)", 0.2))
        assertEquals(0, server.requestCount)
    }

    @Test fun `a pdf position is sent at page granularity`() = runBlocking {
        server.enqueue(MockResponse().setBody(state("1")))
        val s = EditionProgressSync(client, "e1", "f1", "v1", "pdfjs-dist@6.5.438/profile-1", "pdf", LocatorPolicy.NATIVE, tmp.newFolder("pdf"))
        assertEquals(EditionReportOutcome.Accepted, s.report(LLocator.PdfPage(4, 0.0, 0.0), 0.8))
        val loc = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject["anchor"]!!.jsonObject["locator"]!!.jsonObject
        assertEquals("pdf-page", loc["kind"]!!.jsonPrimitive.content)
        assertEquals("0.0", loc["y"]!!.jsonPrimitive.content)
    }

    @Test fun `a highlight made while device-only is queued and sent once the policy allows it`() = runBlocking {
        val dir = tmp.newFolder("a")
        val old = EditionAnnotationSync(client, "e1", "f1", "v1", profile, "epub", LocatorPolicy.NONE, AnnotationStore(dir, "f1", "v1"))
        val (a, out) = old.create("highlight", LLocator.FoliateCfi("epubcfi(/6/4!/4,/1:0,/1:3)"), LSelection.FoliateRange("epubcfi(/6/4!/4,/1:0,/1:3)"), "one", "", "green", null)
        assertEquals(EditionReportOutcome.LocalOnly(profile), out)
        assertEquals(0, server.requestCount)

        val now = EditionAnnotationSync(client, "e1", "f1", "v1", profile, "epub", LocatorPolicy.NATIVE, AnnotationStore(dir, "f1", "v1"))
        server.enqueue(MockResponse().setBody(annotation(a.id, "1")))
        server.enqueue(MockResponse().setBody("{\"items\":[],\"total\":0,\"page\":0,\"size\":200}"))
        now.refresh(setOf("foliate-cfi"))
        val put = server.takeRequest()
        assertEquals("PUT", put.method)
        assertEquals("0", Json.parseToJsonElement(put.body.readUtf8()).jsonObject["baseRevision"]!!.jsonPrimitive.content)
        assertTrue(now.store.get(a.id)!!.synced)
        assertNull(now.store.get(a.id)!!.pending)
    }
}
