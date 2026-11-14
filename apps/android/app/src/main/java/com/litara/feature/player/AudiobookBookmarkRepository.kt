package com.litara.feature.player

import com.litara.core.model.AudiobookBookmark
import com.litara.core.model.CreateAudiobookBookmark
import com.litara.core.network.ApiService
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** Audiobook bookmarks, kept in sync with the server so they appear on the web and other clients. */
@Singleton
class AudiobookBookmarkRepository @Inject constructor(
    private val api: ApiService,
) {
    /** Litara handles have no server bookmarks in this release (never ask the old API about them). */
    private fun unsupported(bookId: Int) = bookId >= LitaraSource.HANDLE_BASE

    suspend fun list(bookId: Int): List<AudiobookBookmark> =
        if (unsupported(bookId)) emptyList() else api.getAudiobookBookmarks(bookId).sortedBy { it.positionMs }

    suspend fun add(bookId: Int, positionSec: Double, title: String): AudiobookBookmark {
        check(!unsupported(bookId)) { "Bookmarks are not available for Litara recordings yet" }
        return api.createAudiobookBookmark(
            bookId,
            CreateAudiobookBookmark(
                clientId = UUID.randomUUID().toString(),
                positionMs = (positionSec * 1000).toLong().coerceAtLeast(0),
                title = title,
            ),
        )
    }

    suspend fun delete(bookId: Int, bookmarkId: String) = api.deleteAudiobookBookmark(bookId, bookmarkId)
}
