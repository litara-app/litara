package com.litara.feature.reader

import kotlinx.coroutines.flow.StateFlow

/**
 * What the shared EPUB/Foliate reader screen needs from its state holder. The BookOrbit-backed
 * [ReaderViewModel] and the Litara edition reader both implement it, so the preserved reader UI is
 * reused through one narrow seam instead of being rewritten (apps/android/ADAPTATION.md).
 */
interface ReaderHost {
    val ui: StateFlow<ReaderViewModel.UiState>
    fun onLoaded(toc: List<TocItem>, title: String?)
    fun onRendererGone()
    fun onRelocate(cfi: String?, fraction: Double?, chapterTitle: String?)
    fun startSearch(query: String)
    fun clearSearch()
    fun onSearchResults(label: String, hits: List<SearchHit>)
    fun onSearchProgress(progress: Double)
    fun onSearchDone(total: Int, capped: Boolean)
    fun loadBookmarks()
    fun addBookmark()
    fun deleteBookmark(id: Int)
    fun onSelection(text: String, cfi: String?, rect: ViewportRect?)
    fun onSelectionCleared()
    fun onAnnotationTap(cfi: String, rect: ViewportRect?)
    fun dismissToolbar()
    fun consumeMessage()
    fun highlight(color: String)
    fun saveNote(note: String)
    fun deleteAnnotation(id: Int)
    fun onError(message: String)
    fun updateSettings(settings: ReaderSettings)
    fun dismissPagingHint()
    fun flush()
}
