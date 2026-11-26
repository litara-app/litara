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
    private val litara: LitaraSource = LitaraSource.None,
) {
    /** Litara keeps its own bookmarks (ADR-0110); the old API is never asked about its handles. */
    private fun isLitara(bookId: Int) = bookId >= LitaraSource.HANDLE_BASE

    suspend fun list(bookId: Int): List<AudiobookBookmark> =
        if (isLitara(bookId)) litara.bookmarks(bookId) else api.getAudiobookBookmarks(bookId).sortedBy { it.positionMs }

    suspend fun add(bookId: Int, positionSec: Double, title: String): AudiobookBookmark {
        if (isLitara(bookId)) return checkNotNull(litara.addBookmark(bookId, positionSec, title)) { "This recording is not available" }
        return api.createAudiobookBookmark(
            bookId,
            CreateAudiobookBookmark(
                clientId = UUID.randomUUID().toString(),
                positionMs = (positionSec * 1000).toLong().coerceAtLeast(0),
                title = title,
            ),
        )
    }

    /** Only Litara bookmarks can be renamed. */
    suspend fun rename(bookId: Int, bookmarkId: String, title: String) {
        if (isLitara(bookId)) litara.renameBookmark(bookId, bookmarkId, title)
    }

    suspend fun delete(bookId: Int, bookmarkId: String) {
        if (isLitara(bookId)) litara.deleteBookmark(bookId, bookmarkId) else api.deleteAudiobookBookmark(bookId, bookmarkId)
    }
}
