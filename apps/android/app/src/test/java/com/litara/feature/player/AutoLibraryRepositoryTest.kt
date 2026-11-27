package com.litara.feature.player

import com.litara.core.model.BookCard
import com.litara.core.model.BookFileRef
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class AutoLibraryRepositoryTest {
    private var account = "server|one"
    private var books = listOf(book(1))
    private var reads = 0
    private var duringRead: () -> Unit = {}
    private val repository = AutoLibraryRepository(object : LitaraSource by LitaraSource.None {
        override fun scopeKey() = account
        override suspend fun cards(): List<BookCard> {
            reads++
            val result = books
            duringRead()
            return result
        }
    })
    private val labels = AutoBrowseTree.Labels("App", "Continue", "Downloads", "Audiobook", { it })

    private fun book(id: Int) = BookCard(id, title = "Book $id", authors = listOf("Author"),
        files = listOf(BookFileRef(id, "mp3", "primary")), addedAt = "")

    private suspend fun titles() = repository.children(AutoLibraryTree.TITLES, labels).map { it.mediaId }

    @Test fun `root modes require no reads`() = runTest {
        assertEquals(3, repository.children(AutoBrowseTree.LIBRARY_ID, labels).size)
        assertEquals(0, reads)
    }

    @Test fun `folders cover every recording once`() = runTest {
        books = (1..45).map(::book) + book(1)
        assertEquals("45 books", repository.children(AutoLibraryTree.AUTHORS, labels).single().subtitle)
    }

    @Test fun `another account never sees the earlier list`() = runTest {
        assertEquals(listOf("book/1"), titles())
        account = "server|two"
        books = listOf(book(2))
        assertEquals(listOf("book/2"), titles())
    }

    @Test fun `an account change during a request discards its response`() = runTest {
        duringRead = { account = "server|two" }
        try { titles(); fail("Must discard the old account's response") }
        catch (_: AutoRequestException) { }
    }
}
