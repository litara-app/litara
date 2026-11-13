package com.litara.feature.player

import com.litara.core.model.AudioProgress
import com.litara.core.model.BookCard
import com.litara.core.model.BookDetail
import com.litara.core.model.BookFileRef
import java.io.File

/** Everything the existing queue builder needs to play one Litara recording. */
data class LitaraPlayback(val book: BookDetail, val files: List<BookFileRef>, val uris: List<String>)

/**
 * The seam between the imported player/Auto/Cast code (which keys books and files by Int) and a Litara
 * server (UUID identities, content versions, revisions). Litara recordings and files are exposed to the
 * old code as stable local HANDLES in a reserved range (>= [HANDLE_BASE]); the wire contract, downloads
 * and conflicts stay UUID-based. Defaults to [None] so classes constructed by hand (tests) are unchanged.
 */
interface LitaraSource {
    /** Identity of the signed-in Litara account (server + user), or empty. Caches must be keyed by it. */
    fun scopeKey(): String

    /** True for a handle that belongs to the active, unlocked Litara account. */
    fun owns(id: Int): Boolean

    /** Playable (ready) recordings as cards, from the server or the account's cached list when offline. */
    suspend fun cards(): List<BookCard>

    suspend fun playback(bookId: Int): LitaraPlayback?

    /** The server's canonical position (never a device-clock winner); null when unreachable or none. */
    suspend fun serverPosition(bookId: Int): AudioProgress?

    /** Sends one position. True when the answer was definitive (accepted or conflict preserved), false to retry later. */
    suspend fun push(bookId: Int, fileId: Int, positionSeconds: Double): Boolean

    /** Playback reached the final file's end: send natural_end for this recording only. */
    suspend fun ended(bookId: Int)

    /** Writes the recording's thumbnail (at most 5 MiB) to [destination]; false if absent. */
    suspend fun artwork(bookId: Int, destination: File): Boolean

    object None : LitaraSource {
        override fun scopeKey() = ""
        override fun owns(id: Int) = false
        override suspend fun cards(): List<BookCard> = emptyList()
        override suspend fun playback(bookId: Int): LitaraPlayback? = null
        override suspend fun serverPosition(bookId: Int): AudioProgress? = null
        override suspend fun push(bookId: Int, fileId: Int, positionSeconds: Double) = true
        override suspend fun ended(bookId: Int) = Unit
        override suspend fun artwork(bookId: Int, destination: File) = false
    }

    companion object {
        /** BookOrbit ids never reach this range, so a handle identifies its backend without a lookup. */
        const val HANDLE_BASE = 1_000_000_000
    }
}
