package com.litara.feature.reader.pdf

import kotlinx.coroutines.flow.StateFlow

/**
 * What the native PDF screen needs from its state holder. The edition PDF reader implements it, so the
 * preserved renderer, layout and search UI are reused through one narrow seam.
 */
interface PdfHost {
    val ui: StateFlow<PdfUiState>
    fun onPageChanged(pageIndex: Int)
    fun updateSettings(settings: PdfReaderSettings)
    fun search(query: String)
    fun nextMatch()
    fun prevMatch()
    fun clearSearch()
    fun flush()
}
