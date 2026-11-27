package com.litara.core.model

import kotlinx.serialization.Serializable

/**
 * A highlight/note on a book, as returned by `GET /books/{id}/annotations`. Shared with the web
 * client, KOReader and Kobo (three-way synced), so [origin] may be something other than "android".
 * [cfi] is null for PDF annotations, which carry a page rectangle instead (not modelled here yet).
 */
@Serializable
data class BookAnnotation(
    val id: Int,
    val bookId: Int,
    val cfi: String? = null,
    val text: String = "",
    val color: String = "yellow",
    val style: String = "highlight",
    val note: String? = null,
    val chapterTitle: String? = null,
    val origin: String = "web",
    val positionStatus: String? = null,
)

/** An ebook bookmark (`/books/{id}/bookmarks`). Audiobook bookmarks come back from the same call with a null [cfi]. */
@Serializable
data class BookBookmark(
    val id: Int,
    val bookId: Int,
    val cfi: String? = null,
    val title: String = "",
    val note: String? = null,
)
