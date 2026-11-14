package com.litara.core.network

import com.litara.core.auth.SessionManager
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Test

/** A Litara handle must never be turned into a BookOrbit URL; real BookOrbit ids are unchanged. */
class ImageUrlsHandleTest {
    private val session = mockk<SessionManager>().also { every { it.serverUrl } returns "https://old.example" }
    private val urls = ImageUrls(session)

    @Test
    fun `BookOrbit ids keep their URL`() {
        assertEquals("https://old.example/api/v1/books/7/cover", urls.cover(7))
    }

    @Test
    fun `a handle resolves to the app artwork URI`() {
        urls.handleArtwork = { id -> "content://app.artwork/s/$id" }
        assertEquals("content://app.artwork/s/1000000005", urls.thumbnail(1_000_000_005))
    }

    @Test
    fun `a handle with no resolver yields no URL instead of a BookOrbit one`() {
        urls.handleArtwork = null
        assertEquals("", urls.cover(1_000_000_005))
    }

    @Test
    fun `a handle the resolver does not own yields no URL`() {
        urls.handleArtwork = { null }
        assertEquals("", urls.cover(1_000_000_005))
    }
}
