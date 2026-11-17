package com.litara.core.litara

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ComicPageStoreTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var client: LitaraClient

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val store = InMemoryCredentialStore().also { it.save(StoredCredentials("a", "r")) }
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)
    }

    @After fun tearDown() = server.shutdown()

    private fun manifest(version: String = "m1") = LPageManifest("f1", "v1", version, "ready",
        (0..2).map { LPage(it, "e$it", "image/png", 10, 10, "/api/v1/files/f1/versions/v1/pages/$it") })

    @Test fun `a page is downloaded once with the bearer and then served from the exact version directory`() = runBlocking {
        val bytes = ByteArray(2048) { (it % 251).toByte() }
        server.enqueue(MockResponse().setBody(Buffer().write(bytes)))
        val s = ComicPageStore(client, tmp.root, manifest())
        assertNull(s.cached(1))
        val f = s.page(1)
        assertArrayEquals(bytes, f.readBytes())
        val req = server.takeRequest()
        assertEquals("Bearer a", req.getHeader("Authorization"))
        assertEquals("/api/v1/files/f1/versions/v1/pages/1", req.path)
        assertEquals("second read needs no request", f, s.page(1))
        assertEquals(1, server.requestCount)
        assertTrue(f.path.replace('\\', '/').endsWith("v1/m1/1"))
    }

    @Test fun `a re extracted manifest never reuses pages of the earlier one`() = runBlocking {
        server.enqueue(MockResponse().setBody("old"))
        ComicPageStore(client, tmp.root, manifest("m1")).page(0)
        assertNull(ComicPageStore(client, tmp.root, manifest("m2")).cached(0))
    }

    @Test fun `an interrupted or short download leaves no page behind`() = runBlocking {
        server.enqueue(MockResponse().setBody(Buffer().write(ByteArray(100))).setHeader("Content-Length", "500"))
        val s = ComicPageStore(client, tmp.root, manifest())
        try { s.page(2); fail("short body must fail") } catch (_: Exception) { }
        assertNull(s.cached(2))
        assertFalse(java.io.File(s.fileFor(2).path + ".part").exists())
    }

    @Test fun `a changed version is reported not shown`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(412).setBody("{\"code\":\"content_changed\",\"status\":412}"))
        try { ComicPageStore(client, tmp.root, manifest()).page(0); fail() } catch (e: ContentChangedException) { assertNotNull(e) }
    }

    @Test fun `manifest models decode the contract shape`() {
        val json = "{\"fileId\":\"f1\",\"contentVersion\":\"v1\",\"manifestVersion\":\"m1\",\"state\":\"ready\",\"pages\":[{\"index\":0,\"entryId\":\"e0\",\"mimeType\":\"image/png\",\"width\":1,\"height\":2,\"contentPath\":\"/p\"}],\"issues\":[]}"
        val m = LitaraJson.decodeFromString<LPageManifest>(json)
        assertEquals("e0", m.pages.single().entryId)
        assertEquals("ready", m.state)
    }
}
