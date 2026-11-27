package com.litara.feature.player

import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import com.litara.core.model.BookDetail
import com.litara.core.model.BookFileRef
import javax.inject.Inject
import javax.inject.Singleton

/** Resolves a recording to a Media3 queue. Its identity, order, bytes (offline or streamed) and chapters come from [LitaraSource]. */
@Singleton
class PlayerRepository @Inject constructor(
    private val artwork: AutoArtwork,
    private val litara: LitaraSource,
) {
    data class PlayerData(
        val book: BookDetail,
        val files: List<BookFileRef>,
        val mediaItems: List<MediaItem>,
    )

    /** Builds one queue entry. Extras carry what BookAggregatingPlayer needs to present a whole-book timeline. */
    @OptIn(UnstableApi::class)
    private fun buildItem(
        book: BookDetail, bookId: Int, file: BookFileRef, uri: String, performer: String,
        chapterStarts: DoubleArray, chapterTitles: Array<String>,
    ): MediaItem {
        val extras = Bundle().apply {
            putDouble(BookAggregatingPlayer.EXTRA_DURATION_SEC, file.durationSeconds ?: 0.0)
            if (chapterStarts.size >= 2) {
                putDoubleArray(BookAggregatingPlayer.EXTRA_CHAPTER_STARTS_SEC, chapterStarts)
                putStringArray(BookAggregatingPlayer.EXTRA_CHAPTER_TITLES, chapterTitles)
            }
        }
        val metadata = MediaMetadata.Builder()
            .setTitle(book.title ?: "Audiobook")
            .setArtist(performer)
            .setExtras(extras)
            .setArtworkUri(artwork.uri(bookId))
            .build()
        return MediaItem.Builder()
            .setMediaId(file.id.toString())
            .setUri(uri)
            .setMimeType(audioMimeType(file.format, file.filename))
            .setMediaMetadata(metadata)
            .build()
    }

    /** Null when the recording does not belong to the signed-in account or cannot be played. */
    @OptIn(UnstableApi::class)
    suspend fun resolve(bookId: Int): PlayerData? {
        if (!litara.owns(bookId)) return null
        val pb = litara.playback(bookId) ?: return null
        if (pb.files.isEmpty() || pb.files.size != pb.uris.size) return null
        val performer = PlaybackQueue.performerLabel(pb.book)
        val chapters = PlaybackQueue.resolveChapters(pb.book, PlaybackQueue.totalDurationSec(pb.files))
        val starts = chapters.map { it.startSec }.toDoubleArray()
        val titles = chapters.map { it.title }.toTypedArray()
        val items = pb.files.mapIndexed { i, file -> buildItem(pb.book, bookId, file, pb.uris[i], performer, starts, titles) }
        return PlayerData(pb.book, pb.files, items)
    }
}
