package com.litara.core.model

import kotlinx.serialization.Serializable

/** An audiobook bookmark (`/audiobooks/{bookId}/bookmarks`). [positionMs] is the position in the whole book. */
@Serializable
data class AudiobookBookmark(
    val id: String,
    val bookId: Int,
    val positionMs: Long,
    val chapterId: String? = null,
    val title: String = "",
    val note: String? = null,
    /** False when the audio changed since the bookmark was made: it is shown and never opened (Litara, ADR-0110). */
    val available: Boolean = true,
    /** A change to it was refused and waits for the listener to choose in the web player (Litara). */
    val needsChoice: Boolean = false,
)
