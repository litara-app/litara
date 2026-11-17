package com.litara.feature.reader.pdf

import kotlinx.coroutines.flow.StateFlow

/**
 * What the shared native PDF screen needs from its state holder. The BookOrbit-backed [PdfReaderViewModel] and
 * the Litara edition PDF reader both implement it, so the preserved renderer, layout and search UI are reused
 * through one narrow seam.
 */
interface PdfHost {
    val ui: StateFlow<PdfReaderViewModel.UiState>
    fun onPageChanged(pageIndex: Int)
    fun updateSettings(settings: PdfReaderSettings)
    fun search(query: String)
    fun nextMatch()
    fun prevMatch()
    fun clearSearch()
    fun flush()
}
