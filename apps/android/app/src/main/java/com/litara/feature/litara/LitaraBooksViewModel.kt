package com.litara.feature.litara

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.litara.core.litara.EditionCompletionOutcome
import com.litara.core.litara.LCompletion
import com.litara.core.litara.LEdition
import com.litara.core.litara.LPersonalConflict
import com.litara.core.litara.LitaraHttpException
import com.litara.core.litara.SessionEndedException
import com.litara.core.litara.TransientException
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** An edition with the display title/authors of the title it belongs to (the edition's own label is only its format). */
data class BookRow(val edition: LEdition, val title: String, val authors: List<String>, val waitingToSync: Boolean = false) {
    val finished: Boolean get() = edition.completion.finished
}

/** One short, user-visible result of the last action (a code the UI maps to text; never server prose). */
enum class BooksNote { FINISH_QUEUED, EARLIER_DELIVERED, CONTENT_CHANGED, ACCESS_ENDED, CONFLICT_SAVED, RESOLVED, RESOLVE_STALE }

data class BooksUi(
    val loading: Boolean = true,
    val books: List<BookRow> = emptyList(),
    val error: String? = null,
    /** Unresolved personal conflicts of the account, any kind; only completion and position are decided here. */
    val conflicts: List<LPersonalConflict> = emptyList(),
    val note: BooksNote? = null,
)

/** Whether this app can open [e] today, and if not why. Capability states from the server are never upgraded. */
sealed interface BookOpen {
    data object Yes : BookOpen
    data class No(val reason: String) : BookOpen
}

fun openability(e: LEdition): BookOpen = when {
    e.file.format !in FOLIATE_FORMATS && e.file.format != "pdf" && e.file.format !in COMIC_FORMATS -> BookOpen.No(e.file.format.uppercase())
    !e.capabilities.read.supported -> BookOpen.No(e.capabilities.read.issues.joinToString { it.code }.ifEmpty { e.capabilities.read.state })
    e.file.contentPath == null -> BookOpen.No(e.file.availability)
    else -> BookOpen.Yes
}

/** The conflict kinds this screen can decide itself; the rest are listed and sent to the web app. */
fun decidableHere(c: LPersonalConflict) = c.resourceKind == "completion" || c.resourceKind == "position"

/** Every ebook and comic edition the signed-in account may see, paged to completion (T005 /editions). */
@HiltViewModel
class LitaraBooksViewModel @Inject constructor(private val repo: LitaraRepository) : ViewModel() {
    private val _ui = MutableStateFlow(BooksUi())
    val ui: StateFlow<BooksUi> = _ui.asStateFlow()

    init { refresh() }

    fun refresh() {
        _ui.update { it.copy(loading = true, error = null) }
        viewModelScope.launch { load() }
    }

    private suspend fun load() {
        try {
            val byTitle = repo.titles().associateBy { it.id }
            val pendingIds = runCatching { repo.editionsWithPendingCompletion() }.getOrDefault(emptyList()).toSet()
            var editions = repo.editions()
            // Deliver anything saved before the last restart, then show the server's resulting state.
            if (pendingIds.isNotEmpty()) {
                var delivered = false
                editions.filter { it.id in pendingIds }.forEach { e ->
                    if (repo.editionCompletion(e).flush() != null) delivered = true
                }
                if (delivered) editions = repo.editions()
            }
            val stillPending = runCatching { repo.editionsWithPendingCompletion() }.getOrDefault(emptyList()).toSet()
            val rows = editions.map { e ->
                val t = byTitle[e.titleId]
                BookRow(e, t?.title?.ifBlank { null } ?: e.label, t?.authors.orEmpty(), waitingToSync = e.id in stillPending)
            }.sortedBy { it.title.lowercase() }
            val conflicts = repo.personalConflicts()
            _ui.update { BooksUi(loading = false, books = rows, conflicts = conflicts, note = it.note) }
        } catch (e: SessionEndedException) {
            repo.refreshSignedIn()
            _ui.update { it.copy(loading = false, error = e.code) }
        } catch (e: TransientException) {
            _ui.update { it.copy(loading = false, error = "offline") }
        } catch (e: LitaraHttpException) {
            _ui.update { it.copy(loading = false, error = e.problem.code.ifEmpty { "HTTP ${e.status}" }) }
        }
    }

    fun consumeNote() = _ui.update { it.copy(note = null) }

    /** Marks the edition finished or not. The save is durable first; see [com.litara.core.litara.EditionCompletionSync]. */
    fun setFinished(row: BookRow, finished: Boolean) {
        viewModelScope.launch {
            val outcome = try {
                repo.editionCompletion(row.edition).submit(finished, row.edition.completion.revision)
            } catch (e: SessionEndedException) {
                EditionCompletionOutcome.AccessEnded(e.code)
            } catch (e: LitaraHttpException) {
                _ui.update { it.copy(error = e.problem.code.ifEmpty { "HTTP ${e.status}" }) }
                return@launch
            }
            when (outcome) {
                is EditionCompletionOutcome.Accepted -> applyCompletion(row.edition.id, outcome.completion, waiting = false, note = null)
                is EditionCompletionOutcome.EarlierDelivered -> applyCompletion(row.edition.id, outcome.completion, waiting = false, note = BooksNote.EARLIER_DELIVERED)
                EditionCompletionOutcome.Queued -> _ui.update { s ->
                    s.copy(books = s.books.map { if (it.edition.id == row.edition.id) it.copy(waitingToSync = true) else it }, note = BooksNote.FINISH_QUEUED)
                }
                is EditionCompletionOutcome.Conflict -> { _ui.update { it.copy(note = BooksNote.CONFLICT_SAVED) }; load() }
                is EditionCompletionOutcome.ContentChanged -> { _ui.update { it.copy(note = BooksNote.CONTENT_CHANGED) }; load() }
                is EditionCompletionOutcome.AccessEnded -> _ui.update { it.copy(note = BooksNote.ACCESS_ENDED) }
            }
        }
    }

    private fun applyCompletion(editionId: String, c: LCompletion, waiting: Boolean, note: BooksNote?) = _ui.update { s ->
        s.copy(note = note, books = s.books.map {
            if (it.edition.id == editionId) it.copy(edition = it.edition.copy(completion = c), waitingToSync = waiting) else it
        })
    }

    /**
     * The user's explicit decision for one conflict. The base revision is the resource's current revision as just
     * fetched; if it moved again the server answers 409 and the list is refreshed so the user decides on current facts.
     */
    fun resolve(c: LPersonalConflict, useCandidate: Boolean) {
        viewModelScope.launch {
            try {
                val fresh = repo.personalConflicts().firstOrNull { it.id == c.id }
                if (fresh == null) { load(); return@launch } // already resolved elsewhere
                val version = _ui.value.books.firstOrNull { it.edition.id == c.editionId }?.edition?.file?.contentVersion
                repo.resolveConflict(fresh, if (useCandidate) "use_candidate" else "keep_server", fresh.currentRevision,
                    version.takeIf { useCandidate })
                _ui.update { it.copy(note = BooksNote.RESOLVED) }
            } catch (e: LitaraHttpException) {
                _ui.update { it.copy(note = if (e.status == 409 || e.status == 412) BooksNote.RESOLVE_STALE else null,
                    error = if (e.status == 409 || e.status == 412) null else e.problem.code.ifEmpty { "HTTP ${e.status}" }) }
            } catch (e: TransientException) {
                _ui.update { it.copy(error = "offline") }
            } catch (e: SessionEndedException) {
                repo.refreshSignedIn()
                _ui.update { it.copy(error = e.code) }
            }
            load()
        }
    }
}
