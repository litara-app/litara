package com.litara.feature.reader.comic

import kotlinx.coroutines.flow.StateFlow

/**
 * What the shared comic pager screen needs from its state holder. The BookOrbit-backed
 * [ComicReaderViewModel] and the Litara edition comic reader both implement it, so the preserved pager,
 * zoom and gestures are reused through one narrow seam. [loadPage] returns whatever the image loader can show
 * (a URL string or a local file) for a zero-based page index, fetching it first if needed.
 */
interface ComicHost {
    val ui: StateFlow<ComicReaderViewModel.UiState>
    val rtl: StateFlow<Boolean>
    fun load()
    fun onPageChanged(page: Int)
    fun setRtl(value: Boolean)
    fun flush()
    suspend fun loadPage(index: Int): Any?
}
