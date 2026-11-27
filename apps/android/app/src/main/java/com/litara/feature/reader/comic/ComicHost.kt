package com.litara.feature.reader.comic

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

private val NEVER_BOOKMARKED: StateFlow<Boolean> = MutableStateFlow(false)

/**
 * What the comic pager screen needs from its state holder. The edition comic reader implements it, so
 * the preserved pager, zoom and gestures are reused through one narrow seam. [loadPage] returns whatever the image loader can show
 * (a URL string or a local file) for a zero-based page index, fetching it first if needed.
 */
interface ComicHost {
    val ui: StateFlow<ComicUiState>
    val rtl: StateFlow<Boolean>
    fun load()
    fun onPageChanged(page: Int)
    fun setRtl(value: Boolean)
    fun flush()
    suspend fun loadPage(index: Int): Any?

    /** Whether this reader can bookmark pages. */
    val supportsBookmarks: Boolean get() = false

    /** Whether the page being shown carries a bookmark. */
    val bookmarkedPage: StateFlow<Boolean> get() = NEVER_BOOKMARKED

    fun toggleBookmark() {}
}
