package com.litara.core.litara

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.File

/** The native wire models must round-trip the shared T005 contract examples byte-for-meaning, not a private dialect. */
class EditionModelsTest {
    private val examples: JsonArray by lazy {
        val candidates = listOf("../../contracts/t005/examples.json", "../../../contracts/t005/examples.json", "contracts/t005/examples.json")
        val f = candidates.map(::File).firstOrNull { it.exists() } ?: fail("contracts/t005/examples.json not found from ${File(".").absolutePath}")
        Json.parseToJsonElement((f as File).readText()).jsonArray
    }

    private fun example(name: String): JsonObject =
        examples.map { it.jsonObject }.first { it["name"]!!.jsonPrimitive.content == name }["value"]!!.jsonObject

    @Test
    fun `position writes round trip every locator kind exactly`() {
        for (name in listOf("position-cfi", "position-pdf", "position-comic")) {
            val wire = example(name)
            val model = LitaraJson.decodeFromString<LEditionPositionWrite>(wire.toString())
            val back = Json.parseToJsonElement(LitaraJson.encodeToString(model))
            assertEquals("$name must serialize back to the contract example", wire, back)
        }
    }

    @Test
    fun `locator kinds decode to their typed form`() {
        val cfi = LitaraJson.decodeFromString<LEditionPositionWrite>(example("position-cfi").toString()).anchor.locator
        assertTrue(cfi is LLocator.FoliateCfi && cfi.cfi.startsWith("epubcfi("))
        assertTrue(LitaraJson.decodeFromString<LEditionPositionWrite>(example("position-pdf").toString()).anchor.locator is LLocator.PdfPage)
        assertTrue(LitaraJson.decodeFromString<LEditionPositionWrite>(example("position-comic").toString()).anchor.locator is LLocator.ComicPage)
    }

    @Test
    fun `a percentage is not a locator and an unknown kind is rejected not guessed`() {
        val bad = """{"fileId":"f","contentVersion":"v","locator":{"kind":"percentage","value":0.5}}"""
        try {
            LitaraJson.decodeFromString<LEditionAnchor>(bad)
            fail("an unknown locator kind must not decode")
        } catch (expected: Exception) {
            // visible rejection is the required behavior
        }
    }

    @Test
    fun `manual completion example round trips`() {
        val wire = example("manual-finish")
        val model = LitaraJson.decodeFromString<LEditionCompletionWrite>(wire.toString())
        assertEquals("manual_finish", model.event)
        assertEquals(wire, Json.parseToJsonElement(LitaraJson.encodeToString(model)))
    }

    // ---- client ---------------------------------------------------------------------------

    private lateinit var server: MockWebServer
    private lateinit var client: LitaraClient

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
        val store = InMemoryCredentialStore().also { it.save(StoredCredentials("a", "r")) }
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient(), store)
    }

    @After
    fun tearDown() = server.shutdown()

    private fun edition(id: String) = """{"id":"$id","titleId":"t","libraryId":"l","revision":"0","label":"EPUB","language":null,
        "file":{"id":"f","contentVersion":"v","format":"epub","mimeType":"application/epub+zip","sizeBytes":10,"availability":"available","contentPath":"/api/v1/files/f/versions/v/content"},
        "readiness":"ready","issues":[],"completion":{"revision":"0","finished":false,"changedAt":null},
        "capabilities":{"read":{"state":"supported","issues":[]},"download":{"state":"supported","issues":[]},"resume":{"state":"supported","issues":[]},
        "textSelection":{"state":"supported","issues":[]},"textHighlight":{"state":"supported","issues":[]},"pageNote":{"state":"incomplete","issues":[{"code":"x","detail":"y"}]},"bookmark":{"state":"unsupported","issues":[]}}}"""

    @Test
    fun `listAllEditions follows the effective page size and total, sends the bearer, and keeps capability states`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"items":[${edition("e1")},${edition("e2")}],"total":3,"page":0,"size":2}"""))
        server.enqueue(MockResponse().setBody("""{"items":[${edition("e3")}],"total":3,"page":1,"size":2}"""))
        val all = client.listAllEditions(pageSize = 2)
        assertEquals(listOf("e1", "e2", "e3"), all.map { it.id })
        val first = server.takeRequest()
        assertEquals("Bearer a", first.getHeader("Authorization"))
        assertTrue(first.path!!.startsWith("/api/v1/editions?page=0&size=2"))
        assertTrue(server.takeRequest().path!!.contains("page=1"))
        assertTrue(all[0].capabilities.read.supported)
        assertEquals(false, all[0].capabilities.pageNote.supported) // incomplete is not working
        assertNull(all[0].language)
    }

    @Test
    fun `position write uses PUT with the idempotency identity and decodes the new revision`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"revision":"1","position":null,"unresolvedConflictCount":0,"conflictsPath":"/api/v1/personal-conflicts"}"""))
        val w = LitaraJson.decodeFromString<LEditionPositionWrite>(example("position-cfi").toString())
        val state = client.writeEditionPosition("e1", w)
        assertEquals("1", state.revision)
        val req = server.takeRequest()
        assertEquals("PUT", req.method)
        assertEquals("/api/v1/editions/e1/position", req.path)
        assertEquals(w.operationId, Json.parseToJsonElement(req.body.readUtf8()).jsonObject["operationId"]!!.jsonPrimitive.content)
    }
}
