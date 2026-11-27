package com.litara.core.network

import org.junit.Assert.assertEquals
import org.junit.Test

class ImageUrlsHandleTest {
    private val urls = ImageUrls()

    @Test
    fun `a handle resolves to the app artwork URI`() {
        urls.handleArtwork = { id -> "content://app.artwork/s/$id" }
        assertEquals("content://app.artwork/s/1000000005", urls.thumbnail(1_000_000_005))
    }

    @Test
    fun `a handle with no resolver yields no URL`() {
        assertEquals("", urls.cover(1_000_000_005))
    }

    @Test
    fun `a handle the resolver does not own yields no URL`() {
        urls.handleArtwork = { null }
        assertEquals("", urls.cover(1_000_000_005))
    }
}
