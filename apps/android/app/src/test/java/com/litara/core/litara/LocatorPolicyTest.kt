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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Each locator kind is gated on evidence; the policy decides what may leave the device, not the call site. */
class LocatorPolicyTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var client: LitaraClient
    private val policy = LocatorPolicy(canonicalKinds = setOf("comic-page"))

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val store = InMemoryCredentialStore().also { it.save(StoredCredentials("a", "r")) }
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)
    }

    @After fun tearDown() = server.shutdown()

    private fun sync(profile: String, sub: String) = EditionProgressSync(client, "e1", "f1", "v1", profile, policy, tmp.newFolder(sub))
    private fun state(rev: String, position: String = "null") =
        "{\"revision\":\"$rev\",\"position\":$position,\"unresolvedConflictCount\":0,\"conflictsPath\":\"/api/v1/personal-conflicts\"}"
    private fun comic(index: Int) = LLocator.ComicPage(index, "entry-$index", "m1")

    @Test fun `a comic page locator is sent exactly as the manifest defined it`() = runBlocking {
        server.enqueue(MockResponse().setBody(state("1")))
        val out = sync("image-pages@profile-1", "c").report(comic(4), 4 / 9.0)
        assertEquals(EditionReportOutcome.Accepted, out)
        val b = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject["anchor"]!!.jsonObject["locator"]!!.jsonObject
        assertEquals("comic-page", b["kind"]!!.jsonPrimitive.content)
        assertEquals("4", b["pageIndex"]!!.jsonPrimitive.content)
        assertEquals("entry-4", b["entryId"]!!.jsonPrimitive.content)
        assertEquals("m1", b["manifestVersion"]!!.jsonPrimitive.content)
    }

    @Test fun `the same comic locator is canonical for a cbz that the server labels with the foliate profile`() = runBlocking {
        server.enqueue(MockResponse().setBody(state("1")))
        assertEquals(EditionReportOutcome.Accepted, sync("foliate-js@78914aef/profile-1", "cbz").report(comic(1), null))
    }

    @Test fun `pdf coordinates and foliate cfi stay on the device because no renderer profile is proven`() = runBlocking {
        val pdf = sync("pdfjs-dist@6.5.438/profile-1", "pdf")
        assertEquals(EditionReportOutcome.LocalOnly("pdfjs-dist@6.5.438/profile-1"), pdf.report(LLocator.PdfPage(3, 0.0, 0.0), 0.5))
        val epub = sync("foliate-js@78914aef/profile-1", "epub")
        assertEquals(EditionReportOutcome.LocalOnly("foliate-js@78914aef/profile-1"), epub.report("epubcfi(/6/2)", 0.1))
        assertEquals("nothing was sent", 0, server.requestCount)
        assertEquals(LLocator.PdfPage(3, 0.0, 0.0), pdf.local()?.anchor)
        assertEquals(LLocator.FoliateCfi("epubcfi(/6/2)"), epub.local()?.anchor)
    }

    @Test fun `a server comic position is applied only for the exact file version and a refused kind is never applied`() = runBlocking {
        val anchor = { v: String, loc: String ->
            "{\"anchor\":{\"fileId\":\"f1\",\"contentVersion\":\"$v\",\"locator\":$loc},\"capturedAt\":\"2026-11-17T12:00:00Z\",\"receivedAt\":\"2026-11-17T12:00:00Z\",\"deviceName\":\"web\"}"
        }
        val comicLoc = "{\"kind\":\"comic-page\",\"version\":1,\"pageIndex\":7,\"entryId\":\"entry-7\",\"manifestVersion\":\"m1\"}"
        server.enqueue(MockResponse().setBody(state("3", anchor("v1", comicLoc))))
        assertEquals(comic(7).copy(), sync("image-pages@profile-1", "r1").serverLocator(setOf("comic-page")))
        server.enqueue(MockResponse().setBody(state("3", anchor("v-other", comicLoc))))
        assertNull("other bytes are never applied", sync("image-pages@profile-1", "r2").serverLocator(setOf("comic-page")))
        val pdfLoc = "{\"kind\":\"pdf-page\",\"version\":1,\"pageIndex\":2,\"x\":0.1,\"y\":0.2}"
        server.enqueue(MockResponse().setBody(state("3", anchor("v1", pdfLoc))))
        assertNull("renderer-defined locators are not interpreted without proof", sync("pdfjs-dist@6.5.438/profile-1", "r3").serverLocator(setOf("pdf-page")))
    }

    @Test fun `older cfi only local records still read back as foliate cfis`() {
        val dir = tmp.newFolder("legacy")
        java.io.File(dir, "local-position.json").writeText(
            "{\"fileId\":\"f1\",\"contentVersion\":\"v1\",\"cfi\":\"epubcfi(/6/4)\",\"fraction\":0.5,\"savedAt\":\"2026-11-17T12:00:00Z\"}")
        val s = EditionProgressSync(client, "e1", "f1", "v1", "p", LocatorPolicy.NONE, dir)
        assertTrue(s.local()?.anchor is LLocator.FoliateCfi)
        assertEquals("epubcfi(/6/4)", (s.local()?.anchor as LLocator.FoliateCfi).cfi)
    }
}
