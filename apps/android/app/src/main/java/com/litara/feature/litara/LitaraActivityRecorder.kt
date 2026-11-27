package com.litara.feature.litara

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.hilt.work.HiltWorker
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.litara.core.litara.SessionClock
import com.litara.core.litara.SessionEntry
import com.litara.core.litara.SessionOutbox
import com.litara.core.litara.StaleScopeException
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Records this account's Litara listening and ebook reading (ADR-0092, ADR-0109). Every session is first saved in the
 * account's own queue, then sent; what cannot be sent now stays there. A session belongs to the account that was signed
 * in when it started and is only ever sent by that account.
 */
@Singleton
class LitaraActivityRecorder @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repo: LitaraRepository,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val listening = Track(SessionClock.listening())
    private val reading = Track(SessionClock.reading())

    private class Track(val clock: SessionClock) {
        var outbox: File? = null
        var savedAtMs = 0L
    }

    init {
        // Only reading follows the app's visibility; audio keeps playing in the background.
        Handler(Looper.getMainLooper()).post {
            ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) = onForeground(true)
                override fun onStop(owner: LifecycleOwner) = onForeground(false)
            })
        }
    }

    /** The active account's queue, or null when no account is signed in. */
    private fun outboxDir(): File? = try {
        val t = repo.offline.begin()
        File(repo.offline.read(t) { it }, "sessions")
    } catch (_: StaleScopeException) {
        null
    }

    /** Call every few seconds while a recording is audibly playing. */
    @Synchronized
    fun onPlaying(recordingId: String, fraction: Double?) = activity(listening, recordingId, fraction)

    @Synchronized
    fun onPlaybackPaused() = pause(listening)

    @Synchronized
    fun endListening() = end(listening)

    /** A page turn or another sign that the person is reading [editionId]. */
    @Synchronized
    fun onReading(editionId: String, fraction: Double?) {
        readingEdition = editionId
        readingFraction = fraction
        activity(reading, editionId, fraction)
    }

    @Synchronized
    fun endReading(editionId: String) {
        if (readingEdition != editionId) return
        readingEdition = null
        end(reading)
    }

    private var readingEdition: String? = null
    private var readingFraction: Double? = null

    @Synchronized
    private fun onForeground(foreground: Boolean) {
        val edition = readingEdition
        if (!foreground) pause(reading) else if (edition != null) activity(reading, edition, readingFraction)
        if (foreground) scope.launch { flushPending() }
    }

    private fun activity(track: Track, target: String, fraction: Double?) {
        val dir = outboxDir() ?: return
        if (track.outbox != null && track.outbox != dir) end(track) // another account: close the old one in its own queue
        track.outbox = dir
        val now = System.currentTimeMillis()
        val previous = track.clock.targetId
        track.clock.active(target, fraction, now)?.let { save(dir, it) }
        if (previous != target) track.savedAtMs = now
        if (now - track.savedAtMs >= CHECKPOINT_MS) {
            track.savedAtMs = now
            track.clock.snapshot()?.let { save(dir, it) }
        }
    }

    private fun pause(track: Track) {
        val dir = track.outbox ?: return
        track.clock.pause(System.currentTimeMillis())
        track.clock.snapshot()?.let { save(dir, it) }
    }

    private fun end(track: Track) {
        val dir = track.outbox ?: return
        track.clock.end(System.currentTimeMillis())?.let { save(dir, it) }
        track.outbox = null
    }

    private fun save(dir: File, entry: SessionEntry) {
        scope.launch {
            SessionOutbox(dir).put(entry)
            if (flushPending()) LitaraSyncWorker.schedule(context)
        }
    }

    /** Sends the signed-in account's waiting sessions and bookmark changes. True while something remains. */
    suspend fun flushPending(): Boolean {
        val client = repo.clientOrNull() ?: return false
        val dir = outboxDir() ?: return false
        val sessions = SessionOutbox(dir).flush(client)
        val bookmarks = runCatching { repo.flushBookmarks() }.getOrDefault(true)
        return sessions || bookmarks
    }

    /** Asks for another attempt once the network is back. */
    fun retryLater() = LitaraSyncWorker.schedule(context)

    private companion object {
        const val CHECKPOINT_MS = 30_000L
    }
}

/** Retries waiting Litara sessions and bookmark changes when there is a network, even after the app was closed. */
@HiltWorker
class LitaraSyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val recorder: LitaraActivityRecorder,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = if (recorder.flushPending()) Result.retry() else Result.success()

    companion object {
        private const val NAME = "litara-activity-sync"

        fun schedule(context: Context) {
            val request = OneTimeWorkRequestBuilder<LitaraSyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.KEEP, request)
        }
    }
}
