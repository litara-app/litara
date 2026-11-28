package com.litara.feature.reader.pdf

import kotlinx.coroutines.flow.StateFlow

/**
 * What the native PDF screen needs from its state holder. The edition PDF reader implements it, so the
 * preserved renderer, layout and search UI are reused through one narrow seam.
 */
interface PdfHost {
    val ui: StateFlow<PdfUiState>
    fun onPageChanged(pageIndex: Int)

    /** Goes to a page the person asked for (page number, link, search hit or note), scrolling there. */
    fun jumpTo(pageIndex: Int)
    fun jumpHandled(seq: Int)

    /** Adds or removes the bookmark of the shown page. */
    fun toggleBookmark()
    fun addNote(pageIndex: Int, text: String)
    fun editNote(id: String, text: String)
    fun deleteMark(id: String)
    fun updateSettings(settings: PdfReaderSettings)
    fun search(query: String)
    fun nextMatch()
    fun prevMatch()
    fun clearSearch()
    fun flush()
}
