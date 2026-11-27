package com.litara.core.network

import javax.inject.Inject
import javax.inject.Singleton

/** Cover addresses by local handle, for Coil. */
@Singleton
class ImageUrls @Inject constructor() {
    /** Resolves a handle to an app-scoped artwork URI (set by the Litara backend). */
    @Volatile var handleArtwork: ((Int) -> String?)? = null

    /** Empty when the handle has no artwork, which shows the placeholder. */
    fun cover(bookId: Int): String = handleArtwork?.invoke(bookId) ?: ""

    fun thumbnail(bookId: Int): String = cover(bookId)
}
