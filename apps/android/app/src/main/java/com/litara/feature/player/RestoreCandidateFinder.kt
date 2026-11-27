package com.litara.feature.player

import com.litara.core.model.AudioProgress
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Picks which audiobook to reopen on launch ([PlayerManager.restoreLastBook]): this device's most
 * recent unfinished books plus the first few the server reports as started, ranked by when each was
 * last listened to anywhere. Every network lookup is time-boxed
 * and falls back to local data, so a slow or absent network only narrows the choice.
 */
@Singleton
class RestoreCandidateFinder @Inject constructor(
    private val audioProgress: AudioProgressRepository,
    private val litara: LitaraSource,
) {
    /** Unfinished books to try, most recently played first, each with its resume position. */
    suspend fun find(): List<Pair<Int, AudioProgress>> = coroutineScope {
        runCatching { withTimeoutOrNull(LOOKUP_TIMEOUT_MS) { audioProgress.flushPending() } }

        val startedIds = async {
            withTimeoutOrNull(LOOKUP_TIMEOUT_MS) { runCatching { litara.started() }.getOrNull() }
                .orEmpty().take(SERVER_CANDIDATES).map { it.id }
        }
        val localIds = audioProgress.recent()
            .filter { it.percentage < ResumeCandidates.FINISHED_PERCENT }.take(SERVER_CANDIDATES).map { it.bookId }
        val local = localIds.map { id -> async { id to point(id) } }
        val server = startedIds.await().distinct().filter { it !in localIds }.map { id -> async { id to point(id) } }

        val points = (local + server).awaitAll()
        val byId = points.toMap()
        val ranked = ResumeCandidates.rank(
            points.mapNotNull { (id, p) -> p?.let { ResumeCandidate(id, it.progress.percentage, it.lastActivityMillis) } },
        )
        ranked.mapNotNull { id -> byId[id]?.let { id to it.progress } }
    }

    private suspend fun point(bookId: Int): ResumePoint? =
        withTimeoutOrNull(LOOKUP_TIMEOUT_MS) { audioProgress.resumePoint(bookId, flush = false) }
            ?: audioProgress.localResumePoint(bookId)

    companion object {
        /** Upper bound for each launch-restore network lookup. */
        const val LOOKUP_TIMEOUT_MS = 4_000L
        /** How many of the server's started recordings to compare. */
        const val SERVER_CANDIDATES = 3
    }
}
