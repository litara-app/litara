package com.litara.core.network

import com.litara.core.auth.SessionManager
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Builds absolute cover/author-thumbnail image URLs for Coil. Auth is supplied by the [ImageClient]
 * OkHttp client's interceptor, so no per-request headers are needed here.
 */
@Singleton
class ImageUrls @Inject constructor(
    private val session: SessionManager,
) {
    private fun base(): String = "${session.serverUrl.orEmpty()}/api/v1"

    /**
     * Resolves a local Litara handle to an app-scoped artwork URI (set by the Litara backend). Handles are
     * never valid BookOrbit ids, so they must not be turned into a BookOrbit URL.
     */
    @Volatile var handleArtwork: ((Int) -> String?)? = null

    private fun handleCover(id: Int): String? = if (id >= 1_000_000_000) handleArtwork?.invoke(id) ?: "" else null

    fun cover(bookId: Int): String = handleCover(bookId) ?: "${base()}/books/$bookId/cover"

    fun thumbnail(bookId: Int): String = handleCover(bookId) ?: "${base()}/books/$bookId/thumbnail"

    fun authorThumbnail(authorId: Int): String = "${base()}/authors/$authorId/thumbnail"

    /** One page of a comic file, rendered by the server (works for CBZ, CBR and CB7). */
    fun comicPage(fileId: Int, index: Int): String = "${base()}/cbz/files/$fileId/pages/$index"

    fun bookDockCover(fileId: Int): String = "${base()}/book-dock/files/$fileId/cover"
}
