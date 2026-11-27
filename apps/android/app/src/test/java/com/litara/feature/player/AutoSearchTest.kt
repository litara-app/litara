package com.litara.feature.player

import com.litara.core.db.AudioProgressEntity
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class AutoSearchTest {
    private val catalog = mockk<AutoCatalog>()
    private val progress = mockk<AudioProgressRepository>()
    private val search = AutoSearch(catalog, progress)
    private val labels = AutoBrowseTree.Labels("App", "Continue", "Downloads", "Audiobook", { it })

    init {
        coEvery { progress.recent() } returns emptyList()
        coEvery { catalog.search(any(), any()) } returns emptyList()
    }

    private fun entry(id: Int, title: String) = AutoBrowseTree.BrowseEntry("book/$id", title, "Author", null, true)

    @Test fun `exact titles outrank a more recently played partial title`() = runTest {
        coEvery { catalog.search(any(), any()) } returns listOf(entry(2, "Dune Messiah"), entry(1, "Dune"))
        coEvery { progress.recent() } returns listOf(AudioProgressEntity(2, 1, 1.0, 10.0, 1, false))
        assertEquals(listOf("book/1", "book/2"), search.find("Dune", labels).map { it.mediaId })
    }

    @Test fun `duplicate editions prefer the active book before history`() = runTest {
        coEvery { catalog.search(any(), any()) } returns listOf(entry(1, "Dune"), entry(2, "Dune"))
        coEvery { progress.recent() } returns listOf(AudioProgressEntity(1, 1, 1.0, 10.0, 1, false))
        assertEquals(listOf("book/2", "book/1"), search.find("Dune", labels, currentBookId = 2).map { it.mediaId })
    }

    @Test fun `empty search uses continue listening`() = runTest {
        coEvery { catalog.continueListening(any()) } returns listOf(entry(7, "Current book"))
        assertEquals(listOf("book/7"), search.find(" ", labels).map { it.mediaId })
    }

    @Test fun `a failed search is not reported as zero results`() = runTest {
        coEvery { catalog.search(any(), any()) } throws AutoRequestException(AutoFailure.SIGN_IN)
        try {
            search.find("Missing book", labels)
            org.junit.Assert.fail("Expected the failure")
        } catch (_: AutoRequestException) { }
    }
}
