package com.litara.feature.reader

import com.litara.core.model.BookAnnotation
import com.litara.core.model.BookBookmark
import com.litara.core.storage.LocalRef
import com.litara.ui.UiText

data class ResolvedOpen(
    val ref: LocalRef,
    val format: String,
    val fileId: Int,
    val initial: InitialProgress,
)

/** Where to open a book: an exact location when the renderer can resolve it, else how far through it is. */
data class InitialProgress(val cfi: String?, val fraction: Double?)

/** Text the user has selected in the page, not yet saved as a highlight. */
data class PendingSelection(val text: String, val cfi: String)

/** What the floating highlight toolbar is acting on: a new selection, or an existing highlight. */
data class ToolbarTarget(
    val rect: ViewportRect?,
    val selection: PendingSelection? = null,
    val annotationId: Int? = null,
)

data class ReaderUiState(
    val loadingFile: Boolean = true,
    val error: UiText? = null,
    val title: String? = null,
    val resolved: ResolvedOpen? = null,
    val settings: ReaderSettings = ReaderSettings(),
    val toc: List<TocItem> = emptyList(),
    val chapterTitle: String? = null,
    val percentage: Int = 0,
    val loaded: Boolean = false,
    val showPagingHint: Boolean = false,
    val annotations: List<BookAnnotation> = emptyList(),
    val bookmarks: List<BookBookmark> = emptyList(),
    val search: ReaderSearchState? = null,
    val toolbar: ToolbarTarget? = null,
    /** One-shot message for the screen to toast, then clear via [ReaderHost.consumeMessage]. */
    val message: UiText? = null,
)

/** In-book search: the query, matches grouped by chapter as they stream in, and progress. */
data class ReaderSearchState(
    val query: String = "",
    val running: Boolean = false,
    val progress: Double = 0.0,
    val groups: List<ReaderSearchGroup> = emptyList(),
    val total: Int = 0,
    val capped: Boolean = false,
    val done: Boolean = false,
)

data class ReaderSearchGroup(val label: String, val hits: List<SearchHit>)
