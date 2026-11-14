package com.litara.feature.litara

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.litara.R
import com.litara.core.litara.LConflict
import com.litara.core.litara.LRecording
import com.litara.core.litara.LRecordingSummary
import com.litara.core.litara.LitaraHttpException
import com.litara.core.litara.ProgressSync
import com.litara.core.litara.SessionEndedException
import com.litara.core.litara.StaleScopeException
import com.litara.core.litara.TransientException
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** One downloaded recording as shown in the Downloads tab. */
data class DownloadRow(val handle: Int, val id: String, val title: String, val authors: List<String>, val sizeBytes: Long, val locked: Boolean)

/** One library row with the local handle the shared player uses. */
data class LibraryRow(val handle: Int, val summary: LRecordingSummary, val downloaded: Boolean)

data class ShellUi(
    val busy: Boolean = false,
    val error: String? = null,
    val account: String = "",
    val server: String = "",
    val library: List<LibraryRow> = emptyList(),
    val fromCache: Boolean = false,
    val downloads: List<DownloadRow> = emptyList(),
    val detail: SnapshotView? = null,
    val detailHandle: Int = 0,
    val finished: Boolean = false,
    val downloading: Pair<Int, Int>? = null,
    val prompt: ConflictPrompt? = null,
)

/**
 * State for the Litara-native phone shell (Library, Downloads, Account, recording detail). Playback is not
 * owned here: the shell hands the recording's local handle to the shared player, so the mini-player, the
 * notification, Android Auto and Cast all see one playback session.
 */
@HiltViewModel
class LitaraShellViewModel @Inject constructor(
    private val app: Application,
    private val repo: LitaraRepository,
    private val backend: LitaraBackend,
) : AndroidViewModel(app) {
    private val _ui = MutableStateFlow(ShellUi(account = repo.currentIdentity?.user?.username.orEmpty(), server = repo.currentIdentity?.serverUrl.orEmpty()))
    val ui: StateFlow<ShellUi> = _ui.asStateFlow()
    private var sync: ProgressSync? = null

    init { refresh() }

    private fun fail(e: Throwable) {
        android.util.Log.w("LitaraShell", "operation failed", e)
        val msg = when (e) {
            is InsecureServerException -> app.getString(R.string.litara_err_insecure)
            is LitaraHttpException -> e.problem.code.ifEmpty { "HTTP ${e.status}" }
            is SessionEndedException -> { repo.refreshSignedIn(); app.getString(R.string.litara_err_signed_out, e.code) }
            is StaleScopeException -> app.getString(R.string.litara_err_stale)
            is TransientException -> app.getString(R.string.litara_err_offline)
            else -> e.message ?: e.javaClass.simpleName
        }
        _ui.update { it.copy(error = msg, busy = false) }
    }

    private fun run(block: suspend () -> Unit) = viewModelScope.launch {
        _ui.update { it.copy(busy = true, error = null) }
        try { block() } catch (e: Throwable) { if (e is CancellationException) throw e; fail(e) }
        _ui.update { it.copy(busy = false) }
    }

    fun clearError() = _ui.update { it.copy(error = null) }

    fun refresh() = run {
        val list = repo.recordings()
        val downloads = loadDownloads()
        val done = downloads.map { it.id }.toSet()
        val rows = list.items.mapNotNull { s -> backend.handleFor(s.id)?.let { LibraryRow(it, s, s.id in done) } }
        _ui.update { it.copy(library = rows, fromCache = list.fromCache, downloads = downloads) }
    }

    private fun loadDownloads(): List<DownloadRow> = repo.downloadedRecordings().mapNotNull { r ->
        backend.handleFor(r.id)?.let { DownloadRow(it, r.id, r.title, r.authors, r.files.sumOf { f -> f.sizeBytes ?: 0L }, repo.isLocked(r.id)) }
    }

    fun open(row: LibraryRow) = openId(row.summary.id)

    fun openDownload(row: DownloadRow) = openId(row.id)

    private fun openId(id: String) = run {
        val view = repo.snapshot(id)
        val handle = backend.handleFor(id) ?: return@run
        _ui.update { it.copy(detail = view, detailHandle = handle, finished = view.snapshot.completion.finished, prompt = null, downloading = null) }
        val snap = view.downloaded?.takeIf { view.offline } ?: view.snapshot
        if (view.locked || !snap.capabilities.play) return@run
        // Ask about a disagreeing position BEFORE listening starts (ADR-0036); the player itself never picks a winner.
        val s = repo.progress(snap).also { sync = it }
        val state = try { s.load() } catch (e: TransientException) { null }
        if (state != null && state.unresolvedConflicts.isNotEmpty()) {
            val labels = state.unresolvedConflicts.associate { c ->
                c.id to (c.candidate?.let { "${it.deviceName}: ${label(snap, it.fileId, it.offsetMs)}" } ?: c.reason)
            }
            val serverLabel = state.position?.let { label(snap, it.fileId, it.offsetMs) } ?: "start"
            _ui.update { it.copy(prompt = ConflictPrompt(serverLabel, state.unresolvedConflicts, labels)) }
        }
    }

    private fun label(snap: LRecording, fileId: String, offset: Long): String {
        val i = snap.files.indexOfFirst { it.id == fileId }
        return "file ${i + 1} at ${offset / 1000}s"
    }

    fun resolve(conflict: LConflict, choice: String) = run {
        val s = sync ?: return@run
        val state = s.resolve(conflict.id, choice)
        val remaining = state.unresolvedConflicts
        _ui.update { it.copy(prompt = if (remaining.isEmpty()) null else it.prompt?.copy(conflicts = remaining)) }
    }

    fun closeDetail() {
        sync = null
        _ui.update { it.copy(detail = null, prompt = null, downloading = null) }
        refresh()
    }

    fun download() = run {
        val snap = _ui.value.detail?.snapshot ?: return@run
        repo.download(snap) { d, t -> _ui.update { it.copy(downloading = d to t) } }
        val view = repo.snapshot(snap.id)
        _ui.update { it.copy(downloading = null, detail = view, downloads = loadDownloads()) }
    }

    fun deleteDownload(id: String) = run {
        repo.deleteDownload(id)
        val open = _ui.value.detail
        val view = if (open?.snapshot?.id == id) repo.snapshot(id) else open
        _ui.update { it.copy(detail = view, downloads = loadDownloads(), library = it.library.map { r -> if (r.summary.id == id) r.copy(downloaded = false) else r }) }
    }

    fun setFinished(finished: Boolean) = run {
        val snap = _ui.value.detail?.snapshot ?: return@run
        val st = repo.finish(snap, if (finished) "manual_finish" else "manual_unfinish", null)
        _ui.update { it.copy(finished = st.finished) }
    }

    fun signOut() = viewModelScope.launch { repo.signOut() }
}
