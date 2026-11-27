package com.litara.feature.player

import com.litara.core.model.AudioProgress
import com.litara.core.model.AudiobookBookmark
import com.litara.core.model.BookCard
import com.litara.core.model.BookDetail
import com.litara.core.model.BookFileRef
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import java.io.File

/** Everything the existing queue builder needs to play one Litara recording. */
data class LitaraPlayback(val book: BookDetail, val files: List<BookFileRef>, val uris: List<String>)

/**
 * The seam between the player/Auto/Cast code (which keys books and files by Int) and a Litara server
 * (UUID identities, content versions, revisions). Recordings and files are exposed to that code as stable
 * local HANDLES in a reserved range (>= [HANDLE_BASE]); the wire contract, downloads and conflicts stay
 * UUID-based. [None] is the signed-out source for classes constructed by hand (tests).
 */
interface LitaraSource {
    /** Identity of the signed-in Litara account (server + user), or empty. Caches must be keyed by it. */
    fun scopeKey(): String

    /** True for a handle that belongs to the active, unlocked Litara account. */
    fun owns(id: Int): Boolean

    /** Playable (ready) recordings as cards, from the server or the account's cached list when offline. */
    suspend fun cards(): List<BookCard>

    /** Started, unfinished recordings by the server's last activity (any device), most recent first. */
    suspend fun started(): List<BookCard>

    /** Recordings with a complete, unlocked offline copy on this device (works without a network). */
    suspend fun downloaded(): List<BookCard>

    suspend fun playback(bookId: Int): LitaraPlayback?

    /** The server's canonical position (never a device-clock winner); null when unreachable or none. */
    suspend fun serverPosition(bookId: Int): AudioProgress?

    /** Sends one position. True when the answer was definitive (accepted or conflict preserved), false to retry later. */
    suspend fun push(bookId: Int, fileId: Int, positionSeconds: Double): Boolean

    /** Playback reached the final file's end: send natural_end for this recording only. */
    suspend fun ended(bookId: Int)

    /** Writes the recording's thumbnail (at most 5 MiB) to [destination]; false if absent. */
    suspend fun artwork(bookId: Int, destination: File): Boolean

    /** The recording is audibly playing, [percent] of the way through (ADR-0109). Called every few seconds. */
    fun listening(bookId: Int, percent: Double) = Unit

    fun listeningPaused() = Unit

    fun listeningEnded() = Unit

    /** Something could not be sent: try again in the background once there is a network. */
    fun retryLater() = Unit

    /** Emits after an offline audiobook copy is added or removed. */
    fun downloadChanges(): Flow<Unit> = emptyFlow()

    /** This account's bookmarks on the recording, in playing order (ADR-0110). */
    suspend fun bookmarks(bookId: Int): List<AudiobookBookmark> = emptyList()

    /** Saves a bookmark at [positionSec] of the whole recording; kept on the device until it can be sent. */
    suspend fun addBookmark(bookId: Int, positionSec: Double, title: String): AudiobookBookmark? = null

    suspend fun renameBookmark(bookId: Int, bookmarkId: String, title: String) = Unit

    suspend fun deleteBookmark(bookId: Int, bookmarkId: String) = Unit

    object None : LitaraSource {
        override fun scopeKey() = ""
        override fun owns(id: Int) = false
        override suspend fun cards(): List<BookCard> = emptyList()
        override suspend fun started(): List<BookCard> = emptyList()
        override suspend fun downloaded(): List<BookCard> = emptyList()
        override suspend fun playback(bookId: Int): LitaraPlayback? = null
        override suspend fun serverPosition(bookId: Int): AudioProgress? = null
        override suspend fun push(bookId: Int, fileId: Int, positionSeconds: Double) = true
        override suspend fun ended(bookId: Int) = Unit
        override suspend fun artwork(bookId: Int, destination: File) = false
    }

    companion object {
        /** The lowest local handle. Saved positions below it are never read. */
        const val HANDLE_BASE = 1_000_000_000
    }
}
