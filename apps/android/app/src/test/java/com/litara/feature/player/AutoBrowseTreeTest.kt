package com.litara.feature.player

import com.litara.feature.player.AutoBrowseTree.CompletionStatus
import com.litara.feature.player.AutoBrowseTree.CurrentBookInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Android Auto browse tree's IDs and grouping (no Android framework involved). */
class AutoBrowseTreeTest {

    /** Deliberately not the English defaults: if any title were still hard-coded, the tests below would catch it. */
    private val labels = AutoBrowseTree.Labels(
        appName = "App*",
        continueListening = "Continue*",
        downloaded = "Downloaded*",
        audiobook = "Audiobook*",
        chaptersOf = { "Chapters* $it" },
    )

    @Test
    fun `bookMediaId round-trips through parseBookId`() {
        assertEquals(42, AutoBrowseTree.parseBookId(AutoBrowseTree.bookMediaId(42)))
        assertNull(AutoBrowseTree.parseBookId(AutoBrowseTree.DOWNLOADS_ID))
        assertNull(AutoBrowseTree.parseBookId("book/notanumber"))
    }

    @Test
    fun `root has continue, downloads and library shelves`() {
        assertEquals(
            listOf(AutoBrowseTree.CONTINUE_ID, AutoBrowseTree.DOWNLOADS_ID, AutoBrowseTree.LIBRARY_ID),
            AutoBrowseTree.rootChildren(null, labels).map { it.mediaId },
        )
    }

    private val ranges = listOf(ChapterRange(0, "One", 0.0, 60.0), ChapterRange(1, "Two", 60.0, 150.0), ChapterRange(2, "Three", 150.0, 200.0))
    private val current = CurrentBookInfo(bookId = 7, title = "Dune", ranges = ranges, positionSec = 75.0)

    @Test
    fun `rootChildren keeps shelves stable and appends chapters when loaded`() {
        assertEquals(listOf(AutoBrowseTree.CONTINUE_ID, AutoBrowseTree.DOWNLOADS_ID, AutoBrowseTree.LIBRARY_ID), AutoBrowseTree.rootChildren(null, labels).map { it.mediaId })
        val withBook = AutoBrowseTree.rootChildren(current, labels)
        assertEquals(AutoBrowseTree.NOW_PLAYING_CHAPTERS_ID, withBook.last().mediaId)
        assertEquals("Chapters* Dune", withBook.last().title)
        assertEquals(4, withBook.size)
        assertEquals(3, AutoBrowseTree.rootChildren(current.copy(ranges = emptyList()), labels).size)
    }

    @Test
    fun `chapterEntries are playable with durations and completion`() {
        val e = AutoBrowseTree.chapterEntries(current)
        assertEquals(listOf("One", "Two", "Three"), e.map { it.title })
        assertEquals(listOf("1m", "1m", "50s"), e.map { it.subtitle })
        assertTrue(e.all { it.isPlayable })
        assertEquals(listOf(CompletionStatus.FULLY_PLAYED, CompletionStatus.PARTIALLY_PLAYED, CompletionStatus.NOT_PLAYED), e.map { it.completion })
    }

    @Test
    fun `chapter media ids round-trip`() {
        assertEquals(7 to 2, AutoBrowseTree.parseChapterId(AutoBrowseTree.chapterMediaId(7, 2)))
        assertNull(AutoBrowseTree.parseChapterId("book/7"))
        assertNull(AutoBrowseTree.parseChapterId("chapter/x/1"))
        assertNull(AutoBrowseTree.parseBookId(AutoBrowseTree.chapterMediaId(7, 2)))
    }

    @Test
    fun `root shelves use the supplied labels, not built-in text`() {
        val shelves = AutoBrowseTree.rootChildren(null, labels)
        assertEquals(listOf("Continue*", "Downloaded*", ""), shelves.map { it.title })
        assertEquals("App*", AutoBrowseTree.rootMediaItem(labels).mediaMetadata.title.toString())
    }

    @Test fun `large download shelves stay bounded without losing books`() {
        val entries = (1..5000).map { AutoBrowseTree.BrowseEntry("book/$it", "Book $it", null, null, true) }
        fun flatten(start: Int = 0, end: Int = entries.size): List<String> {
            val children = AutoBrowseTree.grouped(AutoBrowseTree.DOWNLOADS_ID, entries, labels, start, end)
            assertTrue(children.size <= 40)
            return children.flatMap { entry ->
                val group = AutoBrowseTree.parseGroup(entry.mediaId)
                if (group == null) listOf(entry.mediaId) else flatten(group.start, group.end)
            }
        }
        assertEquals(entries.map { it.mediaId }, flatten())
    }

    @Test fun `local range folders describe their actual contents`() {
        val entries = (1..41).map { AutoBrowseTree.BrowseEntry("book/$it", "Title $it", null, null, true) }
        assertEquals(listOf("Title 1 – Title 40", "Title 41 – Title 41"),
            AutoBrowseTree.grouped(AutoBrowseTree.DOWNLOADS_ID, entries, labels).map { it.title })
    }

    @Test fun `invalid grouping IDs cannot request arbitrary parents or ranges`() {
        assertNull(AutoBrowseTree.parseGroup("group/secret/0/40"))
        assertNull(AutoBrowseTree.parseGroup("group/downloads/-1/40"))
    }
}
