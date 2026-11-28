package com.litara.core.litara

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.time.LocalDate

class BrowseTest {
    @Test fun aPaperOnlyTitleUsesTheBookCoverAndNamesNoEbookFormat() {
        val row = LitaraJson.decodeFromString(LTitleRow.serializer(),
            """{"id":"t","title":"Paper Walls","formats":["paper"],"physicalCopyCount":2,"editionCount":0,"recordingCount":0}""")
        assertEquals(2L, row.physicalCopyCount)
        assertEquals(emptyList<String>(), row.ebookFormats())
        assertFalse(usesAudioCover(row.editionCount, row.recordingCount))
        assertTrue(usesAudioCover(0, 1))
        assertFalse(usesAudioCover(1, 1))
        // A server without physical books sends no count.
        assertEquals(0L, LitaraJson.decodeFromString(LTitleRow.serializer(), """{"id":"t","title":"x"}""").physicalCopyCount)
    }

    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var client: LitaraClient

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val store = InMemoryCredentialStore().also { it.save(StoredCredentials("a", "r")) }
        client = LitaraClient(server.url("/api/v1").toString(), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)
    }

    @After fun tearDown() = server.shutdown()

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
    private fun RecordedRequest.bodyJson(): JsonObject = Json.parseToJsonElement(body.readUtf8()).jsonObject
    private fun JsonObject.text(name: String) = getValue(name).jsonPrimitive.content

    private fun row(id: String, title: String = id, series: String? = null, index: Double? = null) =
        LTitleRow(id, title, series = listOfNotNull(series), seriesIndex = index)

    // ---- title list ------------------------------------------------------------------------------------------

    @Test fun `only set filters are sent, encoded, with the sort and order`() {
        val q = TitleQuery(q = "war & peace", mediaKind = "audio", status = "reading", author = "  Ada Author ", series = " ", sort = "added", descending = true)
        assertEquals(
            "page=2&size=50&sort=added&order=desc&q=war%20%26%20peace&mediaKind=audio&status=reading&author=Ada%20Author",
            q.toQueryString(2, 50),
        )
        assertEquals(3, q.filterCount)
        assertEquals(TitleQuery(q = "war & peace", sort = "added", descending = true), q.cleared())
    }

    @Test fun `titles of an author use the title search's exact rule and follow every page`() = runBlocking<Unit> {
        fun page(ids: List<String>) = json("""{"items":[${ids.joinToString(",") { """{"id":"$it","title":"$it"}""" }}],"total":3,"page":0,"size":2}""")
        server.enqueue(page(listOf("a", "b")))
        server.enqueue(page(listOf("c")))
        assertEquals(listOf("a", "b", "c"), client.titlesBy("author", "O'Brien \"Pat\"", pageSize = 2).map { it.id })
        val first = server.takeRequest()
        assertEquals("/api/v1/titles/search", first.path)
        val filter = first.bodyJson().getValue("filter").jsonObject
        assertEquals("author", filter.text("field"))
        assertEquals("is", filter.text("operator"))
        assertEquals("O'Brien \"Pat\"", filter.getValue("value").jsonArray.single().jsonPrimitive.content)
        assertEquals("1", server.takeRequest().bodyJson().text("page"))
    }

    @Test fun `a name with spaces and signs is encoded into directory requests`() = runBlocking<Unit> {
        server.enqueue(json("""{"name":"A+B & C","fields":[],"revision":"0"}"""))
        client.directoryDetails("authors", "A+B & C")
        assertEquals("/api/v1/authors/details?name=A%2BB%20%26%20C", server.takeRequest().path)
    }

    @Test fun `saved text and its provider are read, and a cleared value is absent`() {
        val d = LitaraJson.decodeFromString<LDirectoryDetails>(
            """{"name":"x","fields":[{"field":"biography","value":"Wrote books.","provider":"hardcover","providerUrl":"https://h"},
               {"field":"introduction","value":null,"provider":"hardcover"},{"field":"book_count","value":6}]}""",
        )
        assertEquals("Wrote books.", d.text("biography"))
        assertEquals("hardcover", d.providerOf("biography"))
        assertNull(d.text("introduction"))
        assertNull(d.providerOf("introduction"))
        assertEquals("6", d.text("book_count"))
    }

    // ---- authors and series ----------------------------------------------------------------------------------

    @Test fun `an author's books are grouped by series in series order, then the rest by title`() {
        val groups = groupBySeries(listOf(
            row("z", "Zed"), row("b2", series = "beta", index = 2.0), row("a", series = "Alpha", index = 1.0),
            row("b1", series = "Beta", index = 1.0), row("bx", "Extra", series = "Beta"), row("c", "Able"),
        ))
        assertEquals(listOf("Alpha", "beta", null), groups.map { it.series }) // the first spelling seen, as on the web
        assertEquals(listOf("b1", "b2", "bx"), groups[1].titles.map { it.id })
        assertEquals(listOf("c", "z"), groups[2].titles.map { it.id })
    }

    @Test fun `missing numbers are whole numbers between the first and last owned`() {
        assertEquals(listOf(3L, 4L), missingNumbers(listOf(5.0, 2.0, 2.5, null)))
        assertEquals(emptyList<Long>(), missingNumbers(listOf(null)))
        assertEquals(emptyList<Long>(), missingNumbers(listOf(1.0, 2026.0)))
    }

    @Test fun `reading order puts gaps and a provider's missing books in their places`() {
        val rows = listOf(row("three", index = 3.0), row("one", index = 1.0), row("loose"))
        fun show(places: List<SeriesPlace>) = places.map {
            when (it) {
                is SeriesPlace.Book -> it.row.id
                is SeriesPlace.Gap -> "gap${it.number}"
                is SeriesPlace.Missing -> "missing${it.member.number}"
            }
        }
        assertEquals(listOf("one", "gap2", "three", "loose"), show(readingOrder(rows, null)))
        // Matched: the provider's list replaces the gaps, including books after the last one owned (ADR-0103, ADR-0104).
        val matched = LMissingBooks(listOf(LMissingBook(5, "Five"), LMissingBook(2, "Two")), LProviderMatch("s", "hardcover", "https://h"))
        assertEquals(listOf("one", "missing2", "three", "missing5", "loose"), show(readingOrder(rows, matched)))
        assertEquals("#2.5", bookNumber(2.5))
        assertEquals("#3", bookNumber(3.0))
    }

    // ---- stats -----------------------------------------------------------------------------------------------

    @Test fun `activity weeks start on Monday and use combined time in the web's steps`() {
        val weeks = heatWeeks(
            LocalDate.parse("2026-11-18"), LocalDate.parse("2026-11-26"), // a Wednesday to a Thursday
            listOf(LActivityDay("2026-11-18", readingSeconds = 200, listeningSeconds = 200), LActivityDay("2026-11-26", listeningSeconds = 7200)),
        )
        assertEquals(2, weeks.size)
        assertEquals(listOf(null, null), weeks[0].take(2))
        assertEquals(2, weeks[0][2]!!.level) // 400 s is over the 300 s reading day
        assertEquals(0, weeks[0][3]!!.level)
        assertEquals(4, weeks[1][3]!!.level)
        assertNull(weeks[1][4])
        assertEquals(1, heatLevel(299))
        assertEquals(3, heatLevel(1800))
    }

    // ---- paging ----------------------------------------------------------------------------------------------

    @Test fun `pages append without duplicates and stop at the total`() = runBlocking<Unit> {
        val asked = mutableListOf<Int>()
        val list = PagedList<String>({ it }) {}
        list.reset { page -> asked += page; PageResult(if (page == 0) listOf("a", "b") else listOf("b", "c"), 3) }
        assertTrue(list.state.hasMore)
        list.loadMore()
        assertEquals(listOf("a", "b", "c"), list.state.items)
        assertFalse(list.state.hasMore)
        list.loadMore()
        assertEquals(listOf(0, 1), asked)
    }

    @Test fun `an empty page ends the list even if the total promises more`() = runBlocking<Unit> {
        val list = PagedList<String>({ it }) {}
        list.reset { page -> PageResult(if (page == 0) listOf("a") else emptyList(), 9) }
        list.loadMore()
        assertFalse(list.state.hasMore)
    }

    @Test fun `a failed page keeps what was shown and the retry asks for the same page`() = runBlocking<Unit> {
        var fail = true
        val asked = mutableListOf<Int>()
        val list = PagedList<String>({ it }) {}
        list.reset { page ->
            asked += page
            if (page == 1 && fail) throw TransientException(null, "offline")
            PageResult(listOf("p$page"), 2)
        }
        list.loadMore()
        assertEquals(listOf("p0"), list.state.items)
        assertTrue(list.state.error is TransientException)
        fail = false
        list.loadMore()
        assertEquals(listOf("p0", "p1"), list.state.items)
        assertEquals(listOf(0, 1, 1), asked)
    }

    @Test fun `a refresh re-reads the pages shown and never empties the list on the way`() = runBlocking<Unit> {
        var rows = (1..7).map { "r$it" }
        val sizes = mutableListOf<Int>()
        val asked = mutableListOf<Int>()
        val list = PagedList<String>({ it }) { sizes += it.items.size }
        val fetch: suspend (Int) -> PageResult<String> = { page -> asked += page; PageResult(rows.drop(page * 3).take(3), rows.size.toLong()) }
        list.refresh(fetch) // nothing shown yet: the first page
        list.loadMore()
        assertEquals(rows.take(6), list.state.items)
        rows = rows - "r5"
        sizes.clear()
        asked.clear()
        list.refresh(fetch)
        assertEquals(listOf(0, 1), asked)
        assertEquals(listOf("r1", "r2", "r3", "r4", "r6", "r7"), list.state.items)
        assertTrue(sizes.all { it == 6 })
        assertFalse(list.state.hasMore)
    }

    @Test fun `a refresh of a list that shrank stops at its new end`() = runBlocking<Unit> {
        var rows = (1..7).map { "r$it" }
        val asked = mutableListOf<Int>()
        val list = PagedList<String>({ it }) {}
        val fetch: suspend (Int) -> PageResult<String> = { page -> asked += page; PageResult(rows.drop(page * 3).take(3), rows.size.toLong()) }
        list.reset(fetch)
        list.loadMore()
        list.loadMore()
        rows = rows.take(2)
        asked.clear()
        list.refresh(fetch)
        assertEquals(listOf(0), asked)
        assertEquals(rows, list.state.items)
        rows = emptyList()
        list.refresh(fetch)
        assertTrue(list.state.loaded && list.state.items.isEmpty() && !list.state.hasMore)
    }

    @Test fun `a failed refresh keeps the rows and the retry refreshes again`() = runBlocking<Unit> {
        var offline = false
        var rows = listOf("a", "b")
        val list = PagedList<String>({ it }) {}
        val fetch: suspend (Int) -> PageResult<String> = { _ ->
            if (offline) throw TransientException(null, "offline")
            PageResult(rows, rows.size.toLong())
        }
        list.reset(fetch)
        offline = true
        list.refresh(fetch)
        assertEquals(rows, list.state.items)
        assertTrue(list.state.error is TransientException)
        offline = false
        rows = listOf("a")
        list.loadMore() // the footer's retry, although nothing more was left to load
        assertEquals(rows, list.state.items)
        assertNull(list.state.error)
    }

    @Test fun `a late answer for an older search is thrown away`() = runBlocking<Unit> {
        val slow = CompletableDeferred<Unit>()
        val list = PagedList<String>({ it }) {}
        val old = launch { list.reset { slow.await(); PageResult(listOf("old"), 1) } }
        yield()
        list.reset { PageResult(listOf("new"), 1) }
        slow.complete(Unit)
        old.join()
        assertEquals(listOf("new"), list.state.items)
    }

    // ---- shelves and ratings ---------------------------------------------------------------------------------

    private fun shelfJson(id: String = "s1", revision: String = "1") =
        """{"id":"$id","revision":"$revision","data":{"name":"Shelf","kind":"manual","visibility":"private","filter":null},"deleted":false,"canEdit":true}"""

    private var counter = 0
    private fun edits() = PersonalEdits(now = { "2026-11-26T10:00:00Z" }, newId = { "id-${++counter}" })

    @Test fun `trying a new shelf again after a lost answer repeats the same shelf and operation`() = runBlocking<Unit> {
        val edits = edits()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        assertThrows(TransientException::class.java) { runBlocking { edits.createShelf(client, " Shelf ", false) } }
        server.enqueue(json(shelfJson()))
        edits.createShelf(client, "Shelf", false)
        val first = server.takeRequest()
        val second = server.takeRequest()
        assertEquals(first.path, second.path)
        val a = first.bodyJson()
        val b = second.bodyJson()
        assertEquals(a, b)
        assertEquals("0", b.text("baseRevision"))
        assertEquals("null", b.getValue("data").jsonObject.getValue("filter").toString())
        // Answered, so the same name asked for again is a new shelf.
        server.enqueue(json(shelfJson()))
        edits.createShelf(client, "Shelf", false)
        assertNotEquals(first.path, server.takeRequest().path)
    }

    @Test fun `renaming a smart shelf keeps its rules`() = runBlocking<Unit> {
        val shelf = LitaraJson.decodeFromString<LShelf>(
            """{"id":"s1","revision":"4","canEdit":true,"data":{"name":"Old","kind":"smart","visibility":"shared","filter":{"type":"group","join":"AND","rules":[]}}}""",
        )
        assertFalse(shelf.manualAndEditable)
        server.enqueue(json(shelfJson()))
        edits().renameShelf(client, shelf, "New")
        val data = server.takeRequest().bodyJson().getValue("data").jsonObject
        assertEquals("New", data.text("name"))
        assertEquals("shared", data.text("visibility"))
        assertEquals("""{"type":"group","join":"AND","rules":[]}""", data.getValue("filter").toString())
    }

    @Test fun `a stale change is reported as changed elsewhere and is not repeated as the same operation`() = runBlocking<Unit> {
        val edits = edits()
        val shelf = LShelf("s1", "3", LShelfData("Shelf", "manual", "private"), canEdit = true)
        server.enqueue(json("""{"code":"revision_conflict"}""", 409))
        assertThrows(ChangedElsewhereException::class.java) { runBlocking { edits.addToShelf(client, shelf, "t1") } }
        server.enqueue(json(shelfJson()))
        edits.addToShelf(client, shelf, "t1")
        assertNotEquals(server.takeRequest().bodyJson().text("operationId"), server.takeRequest().bodyJson().text("operationId"))
    }

    @Test fun `delete and removal send the revision they were made against`() = runBlocking<Unit> {
        val shelf = LShelf("s1", "7", LShelfData("Shelf", "manual", "private"), canEdit = true)
        repeat(2) { server.enqueue(json(shelfJson())) }
        edits().removeFromShelf(client, shelf, "t1")
        edits().deleteShelf(client, shelf)
        val remove = server.takeRequest()
        assertEquals("DELETE /api/v1/shelves/s1/titles/t1 HTTP/1.1", remove.requestLine)
        assertEquals("7", remove.bodyJson().text("baseRevision"))
        assertEquals("DELETE /api/v1/shelves/s1 HTTP/1.1", server.takeRequest().requestLine)
    }

    @Test fun `rating keeps the review and dates and sends an explicit null to clear`() = runBlocking<Unit> {
        val current = LTitlePersonal("t1", "2", LTitlePersonalData(8, "Good", "2026-01-01", null))
        repeat(2) { server.enqueue(json("""{"titleId":"t1","revision":"3","data":{"ratingHalves":null,"review":"Good","startedAt":"2026-01-01","finishedAt":null}}""")) }
        edits().rate(client, current, 9)
        edits().rate(client, current, null)
        val nine = server.takeRequest().bodyJson().getValue("data").jsonObject
        assertEquals("9", nine.text("ratingHalves"))
        assertEquals("Good", nine.text("review"))
        assertEquals("2026-01-01", nine.text("startedAt"))
        assertEquals("null", server.takeRequest().bodyJson().getValue("data").jsonObject.getValue("ratingHalves").toString())
        assertThrows(IllegalArgumentException::class.java) { runBlocking { edits().rate(client, current, 11) } }
    }

    @Test fun `only the caller's editable manual shelves can be added to, across pages`() = runBlocking<Unit> {
        fun shelf(id: String, kind: String, canEdit: Boolean) =
            """{"id":"$id","revision":"1","canEdit":$canEdit,"data":{"name":"$id","kind":"$kind","visibility":"private","filter":null}}"""
        server.enqueue(json("""{"items":[${shelf("b", "manual", true)},${shelf("s", "smart", true)}],"total":4,"page":0,"size":2}"""))
        server.enqueue(json("""{"items":[${shelf("x", "manual", false)},${shelf("a", "manual", true)}],"total":4,"page":1,"size":2}"""))
        assertEquals(listOf("a", "b"), client.shelvesToAddTo().map { it.id })
        assertEquals("/api/v1/shelves?page=0&size=200&scope=mine", server.takeRequest().path)
    }

    // ---- Wi-Fi only ------------------------------------------------------------------------------------------

    private class Metered : Exception()

    @Test fun `a download that turns metered stops, keeps the partial file and later resumes it`() = runBlocking<Unit> {
        val bytes = ByteArray(3 * 1024 * 1024) { (it % 251).toByte() }
        val file = LFile("f1", "v1", 0, "a.bin", "audio/mpeg", bytes.size.toLong(), null, true, "/api/v1/files/f1")
        val dest = File(tmp.root, "a.bin")
        server.enqueue(MockResponse().setHeader("ETag", "\"v1\"").setBody(Buffer().write(bytes)))
        var checks = 0
        val gate = { if (++checks > 2) throw Metered() }
        assertThrows(Metered::class.java) { runBlocking { RangeDownloader(client, gate).download(file, dest) } }
        val partial = File(dest.path + ".part")
        assertFalse(dest.exists())
        assertTrue(partial.length() in 1 until bytes.size.toLong())
        server.takeRequest()

        val have = partial.length().toInt()
        server.enqueue(MockResponse().setResponseCode(206).setHeader("ETag", "\"v1\"")
            .setHeader("Content-Range", "bytes $have-${bytes.size - 1}/${bytes.size}").setBody(Buffer().write(bytes, have, bytes.size - have)))
        RangeDownloader(client).download(file, dest)
        assertEquals("bytes=$have-", server.takeRequest().getHeader("Range"))
        assertTrue(dest.readBytes().contentEquals(bytes))
    }

    @Test fun `a refused download makes no request`() {
        val file = LFile("f1", "v1", 0, "a.bin", "audio/mpeg", 10, null, true, "/api/v1/files/f1")
        assertThrows(Metered::class.java) { runBlocking { RangeDownloader(client) { throw Metered() }.download(file, File(tmp.root, "a.bin")) } }
        assertEquals(0, server.requestCount)
    }
}
