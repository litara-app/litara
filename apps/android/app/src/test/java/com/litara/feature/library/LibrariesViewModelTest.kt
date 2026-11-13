package com.litara.feature.library

import com.litara.core.model.Library
import com.litara.feature.browse.BrowseRepository
import com.litara.feature.library.filters.FilterPrefsStore
import com.litara.feature.library.filters.StoredFilterPrefs
import com.litara.util.MainDispatcherRule
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class LibrariesViewModelTest {
    @get:Rule
    val mainRule = MainDispatcherRule()

    private val library = Library(id = 7, name = "Main", createdAt = "2024-01-01", updatedAt = "2024-01-01")

    private fun viewModel(repo: BrowseRepository): LibrariesViewModel {
        val prefs = mockk<FilterPrefsStore>()
        coEvery { prefs.load(any()) } returns StoredFilterPrefs()
        return LibrariesViewModel(repo, prefs)
    }

    @Test
    fun `a failed library load is an error, not an endless spinner`() {
        val repo = mockk<BrowseRepository>()
        coEvery { repo.libraries() } throws IOException("offline")
        val vm = viewModel(repo)
        assertEquals(LibrariesViewModel.Status.ERROR, vm.status.value)
    }

    @Test
    fun `no libraries is its own state`() {
        val repo = mockk<BrowseRepository>()
        coEvery { repo.libraries() } returns emptyList()
        assertEquals(LibrariesViewModel.Status.EMPTY, viewModel(repo).status.value)
    }

    @Test
    fun `a successful load selects the first library`() {
        val repo = mockk<BrowseRepository>()
        coEvery { repo.libraries() } returns listOf(library)
        val vm = viewModel(repo)
        assertEquals(LibrariesViewModel.Status.READY, vm.status.value)
        assertEquals(7, vm.selectedId.value)
    }

    @Test
    fun `retry recovers once the network is back`() {
        val repo = mockk<BrowseRepository>()
        coEvery { repo.libraries() } throws IOException("offline")
        val vm = viewModel(repo)
        assertEquals(LibrariesViewModel.Status.ERROR, vm.status.value)

        coEvery { repo.libraries() } returns listOf(library)
        vm.loadLibraries()
        assertEquals(LibrariesViewModel.Status.READY, vm.status.value)
        assertEquals(7, vm.selectedId.value)
    }
}
