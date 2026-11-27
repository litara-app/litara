package com.litara.feature.reader.comic

import com.litara.ui.UiText

data class ComicUiState(
    val loading: Boolean = true,
    val error: UiText? = null,
    val title: String? = null,
    val fileId: Int = 0,
    val pageCount: Int = 0,
    val initialPage: Int = 0,
    val currentPage: Int = 0,
)
