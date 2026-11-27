package com.litara.feature.player

import com.litara.core.db.AudioProgressEntity
import com.litara.core.model.BookCard
import com.litara.core.model.BookFileRef
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class AutoCatalogTest {
    private val progress = mockk<AudioProgressRepository>()
    private val labels = AutoBrowseTree.Labels("App", "Continue", "Downloaded", "Audiobook", { it })

    init {
        coEvery { progress.recent() } returns emptyList()
    }

    private fun card(id: Int, format: String = "mp3", title: String = "Book $id", authors: List<String> = emptyList()) =
        BookCard(id, title = title, authors = authors, addedAt = "", files = listOf(BookFileRef(id, format, "primary")))

    private fun point(id: Int, percent: Double, at: Long = 1) = AudioProgressEntity(id, id, 10.0, percent, at, false)

    private fun catalog(
        started: () -> List<BookCard> = { emptyList() }, all: List<BookCard> = emptyList(),
        downloaded: List<BookCard> = emptyList(), account: String = "server|user",
    ) = AutoCatalog(progress, object : LitaraSource by LitaraSource.None {
        override fun scopeKey() = account
        override suspend fun cards() = all
        override suspend fun started() = started()
        override suspend fun downloaded() = downloaded
    })

    private fun List<AutoBrowseTree.BrowseEntry>.ids() = map { it.mediaId }

    @Test fun `continue lists only started recordings`() = runTest {
        val shelf = catalog(started = { listOf(card(2), card(3, "epub")) }, all = listOf(card(1), card(2), card(3, "epub")))
        assertEquals(listOf("book/2"), shelf.continueListening(labels).ids())
    }

    @Test fun `continue keeps a recording known only from this device's history`() = runTest {
        coEvery { progress.recent() } returns listOf(point(3, 20.0))
        assertEquals(listOf("book/3"), catalog(all = listOf(card(1), card(3))).continueListening(labels).ids())
    }

    @Test fun `continue puts this device's most recent first`() = runTest {
        coEvery { progress.recent() } returns listOf(point(1, 20.0, at = 1), point(3, 20.0, at = 9))
        val shelf = catalog(started = { listOf(card(1), card(2), card(3)) }, all = listOf(card(1), card(2), card(3)))
        assertEquals(listOf("book/3", "book/1", "book/2"), shelf.continueListening(labels).ids())
    }

    @Test fun `offline continue keeps what this device has played`() = runTest {
        coEvery { progress.recent() } returns listOf(point(1, 40.0))
        val shelf = catalog(started = { throw java.io.IOException("offline") }, all = listOf(card(1), card(2)))
        assertEquals(listOf("book/1"), shelf.continueListening(labels).ids())
    }

    @Test fun `locally finished books stay out of the shelf`() = runTest {
        coEvery { progress.recent() } returns listOf(point(1, 100.0))
        val shelf = catalog(started = { listOf(card(1), card(2)) }, all = listOf(card(1), card(2)))
        assertEquals(listOf("book/2"), shelf.continueListening(labels).ids())
    }

    @Test fun `the downloaded shelf lists the offline copies`() = runTest {
        assertEquals(listOf("book/4"), catalog(downloaded = listOf(card(4))).downloadedEntries(labels).ids())
    }

    @Test fun `search matches titles, authors and narrators without accents or case`() = runTest {
        val book = card(1, authors = listOf("José Writer")).copy(narrators = listOf("Jane Reader"))
        val auto = catalog(all = listOf(book, card(2, title = "Other")))
        assertEquals(listOf("book/1"), auto.search("  JOSE writer ", labels).ids())
        assertEquals(listOf("book/1"), auto.search("jane reader", labels).ids())
    }

    @Test fun `a search with no match is empty instead of an error`() = runTest {
        assertEquals(emptyList<String>(), catalog(all = listOf(card(1))).search("nothing like it", labels).ids())
    }

    @Test fun `searching while signed out asks for sign in`() = runTest {
        val failure = runCatching { catalog(account = "").search("Dune", labels) }.exceptionOrNull()
        assertEquals(AutoFailure.SIGN_IN, (failure as AutoRequestException).failure)
    }
}
