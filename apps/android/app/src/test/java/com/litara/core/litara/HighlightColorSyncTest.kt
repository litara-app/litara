package com.litara.core.litara

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** ADR-0094: a highlight's colour name goes to the server and comes back; hex values stay on the device. */
class HighlightColorSyncTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var client: LitaraClient
    private val profile = "foliate-js@78914aef/profile-1"
    private val range = "epubcfi(/6/4!/4,/1:0,/1:3)"

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val store = InMemoryCredentialStore().also { it.save(StoredCredentials("a", "r")) }
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)
    }

    @After fun tearDown() = server.shutdown()

    private fun sync(dir: String = "a") =
        EditionAnnotationSync(client, "e1", "f1", "v1", profile, "epub", LocatorPolicy.NATIVE, AnnotationStore(tmp.root.resolve(dir).apply { mkdirs() }, "f1", "v1"))

    private fun written(id: String, rev: String) =
        MockResponse().setBody("{\"id\":\"$id\",\"editionId\":\"e1\",\"revision\":\"$rev\",\"deleted\":false,\"updatedAt\":\"2026-11-26T12:00:00Z\",\"data\":null}")

    private fun list(id: String, rev: String, color: String?) = MockResponse().setBody(
        "{\"items\":[{\"id\":\"$id\",\"editionId\":\"e1\",\"revision\":\"$rev\",\"deleted\":false,\"updatedAt\":\"2026-11-26T12:00:00Z\",\"data\":{" +
            "\"kind\":\"highlight\",\"anchor\":{\"fileId\":\"f1\",\"contentVersion\":\"v1\",\"locator\":{\"kind\":\"foliate-cfi\",\"version\":1,\"cfi\":\"$range\"}}," +
            "\"selection\":{\"kind\":\"foliate-range\",\"version\":1,\"cfi\":\"$range\"},\"text\":\"\",\"quote\":\"one\"" +
            (color?.let { ",\"color\":\"$it\"" } ?: "") + "}}],\"total\":1,\"page\":0,\"size\":200}")

    private fun sentData(): JsonObject = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject["data"]!!.jsonObject

    private suspend fun EditionAnnotationSync.highlight(color: String?) =
        create("highlight", LLocator.FoliateCfi(range), LSelection.FoliateRange(range), "one", "", color, null).first

    @Test fun `the picker's shade is sent as its name and no colour leaves the field out`() = runBlocking<Unit> {
        val s = sync()
        server.enqueue(written("x", "1"))
        s.highlight("#4ADE80")
        assertEquals("green", sentData()["color"]!!.jsonPrimitive.content)
        server.enqueue(written("y", "1"))
        s.highlight(null)
        assertFalse("color" in sentData())
    }

    @Test fun `changing the colour sends a new revision, and picking the same one again does not`() = runBlocking<Unit> {
        val s = sync()
        server.enqueue(written("x", "1"))
        val a = s.highlight("#FACC15")
        server.takeRequest()
        server.enqueue(written(a.id, "2"))
        assertEquals(EditionReportOutcome.Accepted, s.edit(a.id, color = "#38BDF8"))
        assertEquals("blue", sentData()["color"]!!.jsonPrimitive.content)
        s.edit(a.id, color = "#38BDF8")
        assertEquals(2, server.requestCount)
    }

    @Test fun `bookmarks and notes without selected text are never given a colour`() = runBlocking<Unit> {
        val s = sync()
        server.enqueue(written("x", "1"))
        s.create("bookmark", LLocator.FoliateCfi(range), null, "", "", "green", null)
        assertFalse("color" in sentData())
        server.enqueue(written("y", "1"))
        s.create("note", LLocator.FoliateCfi(range), null, "", "on the page", "green", null)
        assertFalse("color" in sentData())
    }

    @Test fun `a colour chosen elsewhere replaces the device's, and a reset elsewhere clears it`() = runBlocking<Unit> {
        val s = sync()
        server.enqueue(written("x", "1"))
        val a = s.highlight("#4ADE80")
        server.enqueue(list(a.id, "2", "pink"))
        s.refresh(setOf("foliate-cfi"))
        assertEquals("pink", s.store.get(a.id)!!.color)
        server.enqueue(list(a.id, "3", null))
        s.refresh(setOf("foliate-cfi"))
        assertNull(s.store.get(a.id)!!.color)
    }

    @Test fun `a shade picked by an earlier build survives a refresh and is sent when next saved`() = runBlocking<Unit> {
        val saved = LitaraJson.decodeFromString<LocalAnnotation>(
            """{"id":"old","kind":"highlight","locator":{"kind":"foliate-cfi","version":1,"cfi":"$range"},"selection":{"kind":"foliate-range","version":1,"cfi":"$range"},
               "color":"#F472B6","createdAt":"t","updatedAt":"t","revision":"1","synced":true}""",
        )
        assertEquals("pink", saved.color)
        val s = sync("old")
        s.store.put(saved)
        server.enqueue(list("old", "1", null))
        s.refresh(setOf("foliate-cfi"))
        assertEquals("pink", s.store.get("old")!!.color)
        server.takeRequest()
        server.enqueue(written("old", "2"))
        s.edit("old", text = "a note")
        assertEquals("pink", sentData()["color"]!!.jsonPrimitive.content)
    }

    @Test fun `the automatic yellow of an earlier build is the default look, not a choice`() {
        val old = LitaraJson.decodeFromString<LocalAnnotation>(
            """{"id":"o","kind":"highlight","locator":{"kind":"foliate-cfi","version":1,"cfi":"$range"},"color":"yellow","createdAt":"t","updatedAt":"t"}""",
        )
        assertNull(old.color)
        assertEquals("blue", HighlightColors.nameOf("#60a5fa"))
        assertNull(HighlightColors.nameOf("#123456"))
    }
}
