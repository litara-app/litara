package com.litara.feature.player

import android.util.Log
import com.litara.core.db.AudioProgressDao
import com.litara.core.db.AudioProgressEntity
import com.litara.core.model.AudioProgress
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/** A resume position and when it was captured (epoch millis). */
data class ResumePoint(val progress: AudioProgress, val lastActivityMillis: Long)

/**
 * Offline-first listening position store keyed by the recording's local handle, backed by Room (local write first,
 * dirty flag, then flush through [LitaraSource]).
 */
@Singleton
class AudioProgressRepository @Inject constructor(
    private val dao: AudioProgressDao,
    private val litara: LitaraSource,
) {
    suspend fun report(bookId: Int, currentFileId: Int, positionSeconds: Double, percentage: Double) {
        val entity = AudioProgressEntity(bookId, currentFileId, positionSeconds, percentage, System.currentTimeMillis(), dirty = true)
        dao.upsert(entity)
        if (push(entity)) dao.markSynced(bookId, entity.updatedAt) else litara.retryLater()
    }

    /** Push every dirty position to the server. Returns true if anything is still dirty afterward. */
    suspend fun flushPending(): Boolean {
        for (e in dao.dirtyEntries()) {
            if (push(e)) dao.markSynced(e.bookId, e.updatedAt)
        }
        return dao.dirtyEntries().isNotEmpty()
    }

    /** Playback reached the end of the final file (not a seek there): completes this recording only. */
    suspend fun playbackEnded(bookId: Int) {
        if (litara.owns(bookId)) runCatching { litara.ended(bookId) }
    }

    /** Saved positions, most recently played first (Android Auto "Continue listening" shelf). */
    suspend fun recent(): List<AudioProgressEntity> = dao.recent()

    fun observeRecent() = dao.observeRecent()

    /**
     * Resume position: retries any pending local write first. The server's canonical revision wins, never a device
     * clock; a local write that conflicted was preserved server-side for the phone UI to ask about, and a car or
     * background resume just follows canonical. This device's position is the fallback when there is no answer.
     */
    suspend fun resolveResume(bookId: Int): AudioProgress? = resumePoint(bookId)?.progress

    /** This device's saved position only - no network. Fallback when the server is slow or offline. */
    suspend fun localResumePoint(bookId: Int): ResumePoint? =
        dao.get(bookId)?.let { ResumePoint(it.toAudioProgress(), it.updatedAt) }

    /**
     * [resolveResume]'s pick plus when it was captured (epoch millis; 0 when the server gave no
     * timestamp), so callers can tell which of several books was listened to most recently. Pass
     * [flush] = false when looking up several books after one explicit [flushPending].
     */
    suspend fun resumePoint(bookId: Int, flush: Boolean = true): ResumePoint? {
        if (flush) runCatching { flushPending() }
        val canonical = if (litara.owns(bookId)) runCatching { litara.serverPosition(bookId) }.getOrNull() else null
        return canonical?.let { ResumePoint(it, epochMillis(it.updatedAt.orEmpty()) ?: 0L) } ?: localResumePoint(bookId)
    }

    /**
     * True when [e] no longer needs sending: the server's answer was definitive. False keeps the row dirty, also
     * when its account is locked or signed out.
     */
    private suspend fun push(e: AudioProgressEntity): Boolean = runCatching {
        litara.owns(e.bookId) && litara.push(e.bookId, e.currentFileId, e.positionSeconds)
    }.onFailure { Log.w(TAG, "progress sync failed bookId=${e.bookId}: ${it.message}") }.getOrDefault(false)

    private fun epochMillis(iso: String): Long? = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()

    private fun AudioProgressEntity.toAudioProgress() =
        AudioProgress(currentFileId, positionSeconds, percentage, updatedAt = null)

    private companion object {
        const val TAG = "AudioProgressRepo"
    }
}
