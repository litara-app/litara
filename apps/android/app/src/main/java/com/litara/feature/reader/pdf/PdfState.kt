package com.litara.feature.reader.pdf

import android.graphics.RectF
import android.os.Build
import com.litara.core.storage.LocalRef
import com.litara.ui.UiText

/** A single search match: which page it is on, and its bounds in page-point space. */
data class PdfSearchHit(val page: Int, val rect: RectF)

data class PdfSearchState(
    val query: String = "",
    val running: Boolean = false,
    val hits: List<PdfSearchHit> = emptyList(),
    val activeIndex: Int = -1,
) {
    val active: PdfSearchHit? get() = hits.getOrNull(activeIndex)
}

data class PdfUiState(
    val loading: Boolean = true,
    val error: UiText? = null,
    val title: String? = null,
    val core: PdfRenderCore? = null,
    /** The opened file, for the shared web engine (ADR-0093). */
    val ref: LocalRef? = null,
    val pageCount: Int = 0,
    val initialPage: Int = 0,
    val currentPage: Int = 0, // 0-based
    val settings: PdfReaderSettings = PdfReaderSettings(),
    val hasTextLayer: Boolean = Build.VERSION.SDK_INT >= 35,
    val search: PdfSearchState? = null,
)
