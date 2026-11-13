package com.litara.feature.litara

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import com.litara.R
import androidx.lifecycle.viewModelScope
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.litara.core.litara.LChapter
import com.litara.core.litara.LConflict
import com.litara.core.litara.LRecording
import com.litara.core.litara.LRecordingSummary
import com.litara.core.litara.LitaraHttpException
import com.litara.core.litara.ProgressSync
import com.litara.core.litara.ReportOutcome
import com.litara.core.litara.SessionEndedException
import com.litara.core.litara.StaleScopeException
import com.litara.core.litara.TransientException
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The choice offered on resume when this device and the server disagree (ADR-0036: ask, never auto-pick). */
data class ConflictPrompt(val serverLabel: String, val conflicts: List<LConflict>, val labels: Map<String, String>)

data class LitaraUi(
    val signedIn: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    val account: String? = null,
    val recordings: List<LRecordingSummary> = emptyList(),
    val listFromCache: Boolean = false,
    val detail: SnapshotView? = null,
    val downloading: Pair<Int, Int>? = null,
    val downloadedComplete: Boolean = false,
    val playing: Boolean = false,
    val fileIndex: Int = 0,
    val offsetMs: Long = 0,
    val prompt: ConflictPrompt? = null,
    val finished: Boolean = false,
    val statusLine: String = "",
)

@HiltViewModel
class LitaraViewModel @Inject constructor(
    private val app: Application,
    private val repo: LitaraRepository,
) : AndroidViewModel(app) {
    private val _ui = MutableStateFlow(LitaraUi(signedIn = repo.signedIn, account = repo.currentIdentity?.user?.username))
    val ui: StateFlow<LitaraUi> = _ui.asStateFlow()

    private var player: ExoPlayer? = null
    private var sync: ProgressSync? = null
    private var current: LRecording? = null
    private var reportJob: Job? = null
    private var seekLandedAtEnd = false

    val exoPlayer: ExoPlayer? get() = player

    private fun fail(e: Throwable) {
        android.util.Log.w("LitaraVM", "operation failed", e)
        val msg = when (e) {
            is InsecureServerException -> app.getString(R.string.litara_err_insecure)
            is LitaraHttpException -> e.problem.code.ifEmpty { "HTTP ${e.status}" }
            is SessionEndedException -> { _ui.update { it.copy(signedIn = false) }; app.getString(R.string.litara_err_signed_out, e.code) }
            is StaleScopeException -> app.getString(R.string.litara_err_stale)
            is TransientException -> app.getString(R.string.litara_err_offline)
            else -> e.message ?: e.javaClass.simpleName
        }
        _ui.update { it.copy(error = msg, busy = false) }
    }

    private fun launch(block: suspend () -> Unit) = viewModelScope.launch {
        _ui.update { it.copy(busy = true, error = null) }
        try { block() } catch (e: Throwable) { if (e is kotlinx.coroutines.CancellationException) throw e; fail(e) }
        _ui.update { it.copy(busy = false) }
    }

    fun signIn(url: String, insecure: Boolean, user: String, password: String) = launch {
        val id = repo.signIn(url, insecure, user, password, "Android ${android.os.Build.MODEL}")
        _ui.update { it.copy(signedIn = true, account = id.user.username) }
        loadRecordings()
    }

    fun signOut() = viewModelScope.launch {
        stopPlayback()
        repo.signOut()
        _ui.value = LitaraUi()
    }

    fun refresh() = launch { loadRecordings() }

    private suspend fun loadRecordings() {
        val list = repo.recordings()
        _ui.update { it.copy(recordings = list.items, listFromCache = list.fromCache) }
    }

    fun open(summary: LRecordingSummary) = launch {
        stopPlayback()
        val view = repo.snapshot(summary.id)
        current = view.snapshot
        _ui.update { it.copy(detail = view, finished = view.snapshot.completion.finished, prompt = null, fileIndex = 0, offsetMs = 0,
            downloadedComplete = view.downloaded != null && !view.updateAvailable) }
        if (view.locked || !view.snapshot.capabilities.play) return@launch
        val snap = view.downloaded?.takeIf { view.offline } ?: view.snapshot
        current = snap
        prepare(snap)
        resumePosition(snap)
    }

    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun prepare(snap: LRecording) {
        val factory = DefaultDataSource.Factory(app, repo.mediaDataSourceFactory())
        val p = ExoPlayer.Builder(app).setMediaSourceFactory(DefaultMediaSourceFactory(factory)).build()
        val items = snap.files.map { f ->
            val local = repo.localFile(snap.id, f)
            MediaItem.Builder().setMediaId(f.id)
                .setUri(if (local != null) Uri.fromFile(local) else Uri.parse(repo.streamUrl(f))).build()
        }
        p.setMediaItems(items)
        p.prepare()
        p.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                _ui.update { it.copy(playing = isPlaying) }
                if (isPlaying) startReporting() else reportNow()
            }

            override fun onPlaybackStateChanged(state: Int) {
                // Natural end = playback actually reached the final file's end; a seek that LANDS at the end never finishes.
                if (state == Player.STATE_ENDED && p.currentMediaItemIndex == snap.files.lastIndex && !seekLandedAtEnd) onNaturalEnd(snap)
            }

            override fun onPositionDiscontinuity(old: Player.PositionInfo, new: Player.PositionInfo, reason: Int) {
                seekLandedAtEnd = reason == Player.DISCONTINUITY_REASON_SEEK && new.mediaItemIndex == snap.files.lastIndex &&
                    new.positionMs >= (snap.files.last().durationMs ?: Long.MAX_VALUE) - 1000
                _ui.update { it.copy(fileIndex = new.mediaItemIndex, offsetMs = new.positionMs) }
                if (reason == Player.DISCONTINUITY_REASON_SEEK) reportNow()
            }
        })
        player = p
        sync = repo.progress(snap)
    }

    private suspend fun resumePosition(snap: LRecording) {
        val s = sync ?: return
        val state = try { s.load() } catch (e: TransientException) { null }
        val p = state?.position
        if (state != null && state.unresolvedConflicts.isNotEmpty()) {
            val labels = state.unresolvedConflicts.associate { c ->
                c.id to (c.candidate?.let { "${it.deviceName}: ${label(snap, it.fileId, it.offsetMs)}" } ?: c.reason)
            }
            _ui.update { it.copy(prompt = ConflictPrompt(p?.let { x -> label(snap, x.fileId, x.offsetMs) } ?: "start", state.unresolvedConflicts, labels)) }
        }
        if (p != null) s.indexOf(p.fileId)?.let { player?.seekTo(it, p.offsetMs) }
    }

    private fun label(snap: LRecording, fileId: String, offset: Long): String {
        val i = snap.files.indexOfFirst { it.id == fileId }
        return "file ${i + 1} at ${offset / 1000}s"
    }

    /** The user's answer to the resume prompt; each is a new revision-aware operation. */
    fun resolve(conflict: LConflict, choice: String) = launch {
        val s = sync ?: return@launch
        val state = s.resolve(conflict.id, choice)
        val remaining = state.unresolvedConflicts
        _ui.update { it.copy(prompt = if (remaining.isEmpty()) null else it.prompt?.copy(conflicts = remaining)) }
        state.position?.let { p -> s.indexOf(p.fileId)?.let { player?.seekTo(it, p.offsetMs) } }
    }

    fun toggle() {
        val p = player ?: return
        if (p.isPlaying) p.pause() else {
            if (p.playbackState == Player.STATE_ENDED) p.seekTo(0, 0)
            p.play()
        }
    }

    fun seekToChapter(c: LChapter) {
        val snap = current ?: return
        val i = snap.files.indexOfFirst { it.id == c.start.fileId }
        if (i >= 0) player?.seekTo(i, c.start.offsetMs)
    }

    private fun startReporting() {
        reportJob?.cancel()
        reportJob = viewModelScope.launch {
            while (isActive) {
                delay(10_000)
                reportNow()
                player?.let { p -> _ui.update { it.copy(fileIndex = p.currentMediaItemIndex, offsetMs = p.currentPosition) } }
            }
        }
    }

    fun reportNow() {
        val p = player ?: return
        val s = sync ?: return
        val index = p.currentMediaItemIndex
        val offset = p.currentPosition
        viewModelScope.launch {
            val outcome = try { s.report(index, offset) } catch (e: Throwable) { if (e is kotlinx.coroutines.CancellationException) throw e; fail(e); return@launch }
            _ui.update { it.copy(fileIndex = index, offsetMs = offset, statusLine = describe(outcome)) }
            when (outcome) {
                is ReportOutcome.Conflict -> current?.let { resumePromptFromSync(it) }
                is ReportOutcome.AccessEnded -> { player?.pause(); _ui.update { it.copy(error = app.getString(R.string.litara_err_access, outcome.code)) } }
                else -> {}
            }
        }
    }

    private fun resumePromptFromSync(snap: LRecording) {
        val s = sync ?: return
        if (s.conflicts.isEmpty()) return
        val labels = s.conflicts.associate { c -> c.id to (c.candidate?.let { "${it.deviceName}: ${label(snap, it.fileId, it.offsetMs)}" } ?: c.reason) }
        _ui.update { it.copy(prompt = ConflictPrompt(s.position?.let { x -> label(snap, x.fileId, x.offsetMs) } ?: "start", s.conflicts, labels)) }
    }

    private fun describe(o: ReportOutcome) = app.getString(when (o) {
        ReportOutcome.Accepted -> R.string.litara_status_saved
        ReportOutcome.Queued -> R.string.litara_status_queued
        is ReportOutcome.Conflict -> R.string.litara_status_conflict
        is ReportOutcome.SnapshotChanged -> R.string.litara_status_update
        is ReportOutcome.AccessEnded -> R.string.litara_status_access
    }, (o as? ReportOutcome.SnapshotChanged)?.code.orEmpty())

    private fun onNaturalEnd(snap: LRecording) {
        viewModelScope.launch {
            try {
                reportNowSuspend(snap.files.lastIndex, snap.files.last().durationMs ?: 0)
                val st = repo.finish(snap, "natural_end", snap.files.last())
                _ui.update { it.copy(finished = st.finished, statusLine = app.getString(R.string.litara_status_finished)) }
            } catch (e: Throwable) { if (e is kotlinx.coroutines.CancellationException) throw e; fail(e) }
        }
    }

    private suspend fun reportNowSuspend(index: Int, offset: Long) { sync?.report(index, offset) }

    fun setFinished(finished: Boolean) = launch {
        val snap = current ?: return@launch
        val st = repo.finish(snap, if (finished) "manual_finish" else "manual_unfinish", null)
        _ui.update { it.copy(finished = st.finished) }
    }

    fun download() = launch {
        val snap = _ui.value.detail?.snapshot ?: return@launch
        repo.download(snap) { d, t -> _ui.update { it.copy(downloading = d to t) } }
        _ui.update { it.copy(downloading = null, downloadedComplete = true, detail = it.detail?.copy(downloaded = snap)) }
    }

    fun stopPlayback() {
        reportJob?.cancel()
        reportNow()
        player?.release()
        player = null
        sync = null
    }

    fun closeDetail() = _ui.update { it.copy(detail = null, prompt = null, playing = false, downloading = null) }

    fun clearError() = _ui.update { it.copy(error = null) }

    override fun onCleared() {
        reportJob?.cancel()
        player?.release()
        super.onCleared()
    }
}
