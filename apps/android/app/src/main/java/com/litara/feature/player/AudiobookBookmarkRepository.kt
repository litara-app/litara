package com.litara.feature.player

import com.litara.core.model.AudiobookBookmark
import javax.inject.Inject
import javax.inject.Singleton

/** Audiobook bookmarks, kept in sync with the server (ADR-0110) so they appear on the web and other clients. */
@Singleton
class AudiobookBookmarkRepository @Inject constructor(
    private val litara: LitaraSource,
) {
    suspend fun list(bookId: Int): List<AudiobookBookmark> = litara.bookmarks(bookId)

    suspend fun add(bookId: Int, positionSec: Double, title: String): AudiobookBookmark =
        checkNotNull(litara.addBookmark(bookId, positionSec, title)) { "This recording is not available" }

    suspend fun rename(bookId: Int, bookmarkId: String, title: String) = litara.renameBookmark(bookId, bookmarkId, title)

    suspend fun delete(bookId: Int, bookmarkId: String) = litara.deleteBookmark(bookId, bookmarkId)
}
