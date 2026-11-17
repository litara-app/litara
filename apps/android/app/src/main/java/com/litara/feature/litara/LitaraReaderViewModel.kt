package com.litara.feature.litara

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.litara.R
import com.litara.core.litara.EditionProgressSync
import com.litara.core.litara.EditionReportOutcome
import com.litara.core.litara.LLocator
import com.litara.core.litara.LReaderSnapshot
import com.litara.core.litara.LSelection
import com.litara.core.model.BookAnnotation
import com.litara.core.model.BookBookmark
import com.litara.feature.reader.BookmarkNames
import com.litara.core.storage.LocalRef
import com.litara.feature.reader.InitialProgress
import com.litara.feature.reader.ReaderHost
import com.litara.feature.reader.ReaderSettings
import com.litara.feature.reader.ReaderSettingsStore
import com.litara.feature.reader.ReaderViewModel
import com.litara.feature.reader.SearchHit
import com.litara.feature.reader.TocItem
import com.litara.feature.reader.ViewportRect
import com.litara.ui.UiText
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import kotlin.math.roundToInt

private const val PROGRESS_THROTTLE_MS = 2_000L
private const val IDLE_FLUSH_MS = 1_500L

/** Formats the preserved Foliate engine renders. PDF and comic editions use other native readers (later slices). */
val FOLIATE_FORMATS = setOf("epub", "kepub", "mobi", "azw", "azw3", "fb2")

/**
 * Reads one Litara ebook edition (route argument `editionId`) in the preserved Foliate reader. The file is
 * exactly the snapshot's file/version; position is stored locally for those bytes and only sent to the server
 * where [LitaraRepository.nativeLocatorPolicy] allows it. Highlights, notes and bookmarks are not wired
 * yet and say so instead of silently using BookOrbit endpoints.
 */
@HiltViewModel
class LitaraReaderViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repo: LitaraRepository,
    private val settingsStore: ReaderSettingsStore,
) : ViewModel(), ReaderHost {
    private val editionId: String = savedStateHandle.get<String>("editionId").orEmpty()

    private val _ui = MutableStateFlow(ReaderViewModel.UiState())
    override val ui: StateFlow<ReaderViewModel.UiState> = _ui.asStateFlow()

    private var sync: EditionProgressSync? = null
    private var annotations: com.litara.core.litara.EditionAnnotationSync? = null
    private val idOf = HashMap<Int, String>()
    private var lastSent = 0L
    private var pending: Pair<String, Double>? = null
    private var currentCfi: String? = null
    private var localOnlyNoted = false
    private var flushJob: kotlinx.coroutines.Job? = null

    init { load() }

    private fun load() {
        viewModelScope.launch {
            val settings = settingsStore.load()
            _ui.update { it.copy(settings = settings, showPagingHint = settings.flow == "paginated" && !settingsStore.hasSeenPagingHint()) }
            try {
                val snap = repo.readerSnapshot(editionId)
                _ui.update { it.copy(title = snap.edition.label) }
                val blocked = openBlocker(snap)
                if (blocked != null) {
                    _ui.update { it.copy(loadingFile = false, error = blocked) }
                    return@launch
                }
                val file = repo.editionFile(snap)
                val s = repo.editionProgress(snap).also { sync = it }
                annotations = repo.editionAnnotations(snap).also { it.refresh(setOf("foliate-cfi")) }
                refreshAnnotationUi()
                val start: Pair<String, Double?>? = s.serverCfi()?.let { it to null } ?: s.local()?.let { it.cfi to it.fraction }
                _ui.update {
                    it.copy(
                        loadingFile = false,
                        resolved = ReaderViewModel.ResolvedOpen(
                            LocalRef.PlainFile(file), snap.edition.file.format, 0, InitialProgress(start?.first, start?.second),
                        ),
                    )
                }
                s.flushPending()
            } catch (e: Exception) {
                _ui.update { it.copy(loadingFile = false, error = UiText.raw(e.message ?: "Could not open this book.")) }
            }
        }
    }

    private fun openBlocker(snap: LReaderSnapshot): UiText? {
        val ed = snap.edition
        if (snap.engine != "foliate" || ed.file.format !in FOLIATE_FORMATS) {
            return UiText.of(R.string.litara_book_unsupported, ed.file.format.uppercase())
        }
        if (!ed.capabilities.read.supported) {
            val why = ed.capabilities.read.issues.joinToString { it.code }.ifEmpty { ed.capabilities.read.state }
            return UiText.of(R.string.litara_book_not_readable, why)
        }
        return null
    }

    override fun onLoaded(toc: List<TocItem>, title: String?) {
        _ui.update { it.copy(loaded = true, toc = toc, chapterTitle = it.chapterTitle ?: title) }
    }

    override fun onRendererGone() {
        _ui.update { s ->
            s.copy(
                loaded = false, toolbar = null, search = null,
                resolved = s.resolved?.let { r ->
                    r.copy(initial = InitialProgress(currentCfi ?: r.initial.cfi, if (s.loaded) s.percentage / 100.0 else r.initial.fraction))
                },
            )
        }
    }

    override fun onRelocate(cfi: String?, fraction: Double?, chapterTitle: String?) {
        _ui.update {
            it.copy(
                chapterTitle = chapterTitle ?: it.chapterTitle,
                percentage = fraction?.let { f -> (f * 100).roundToInt() } ?: it.percentage,
            )
        }
        if (cfi != null) currentCfi = cfi
        if (cfi != null && fraction != null) {
            pending = cfi to fraction
            if (System.currentTimeMillis() - lastSent >= PROGRESS_THROTTLE_MS) flush()
            flushJob?.cancel()
            flushJob = viewModelScope.launch { kotlinx.coroutines.delay(IDLE_FLUSH_MS); flush() }
        }
    }

    override fun flush() {
        val s = sync ?: return
        val p = pending ?: return
        pending = null
        lastSent = System.currentTimeMillis()
        viewModelScope.launch { handle(s.report(p.first, p.second)) }
    }

    private fun handle(o: EditionReportOutcome) {
        val msg: UiText? = when (o) {
            is EditionReportOutcome.LocalOnly -> if (localOnlyNoted) null else UiText.of(R.string.litara_reader_local_only).also { localOnlyNoted = true }
            is EditionReportOutcome.Conflict -> UiText.of(R.string.litara_reader_conflict)
            is EditionReportOutcome.ContentChanged -> UiText.of(R.string.litara_reader_content_changed)
            is EditionReportOutcome.AccessEnded -> UiText.of(R.string.litara_reader_access_ended)
            EditionReportOutcome.Accepted, EditionReportOutcome.Queued -> null
        }
        if (msg != null) _ui.update { it.copy(message = msg) }
    }

    // ---- in-book search (state only; the page does the work) ----

    override fun startSearch(query: String) {
        val q = query.trim()
        _ui.update { it.copy(search = if (q.isEmpty()) null else ReaderViewModel.SearchState(query = q, running = true)) }
    }

    override fun clearSearch() = _ui.update { it.copy(search = null) }

    override fun onSearchResults(label: String, hits: List<SearchHit>) = _ui.update { s ->
        val cur = s.search ?: return@update s
        s.copy(search = cur.copy(groups = cur.groups + ReaderViewModel.SearchGroup(label, hits), total = cur.total + hits.size))
    }

    override fun onSearchProgress(progress: Double) = _ui.update { s -> s.search?.let { s.copy(search = it.copy(progress = progress)) } ?: s }

    override fun onSearchDone(total: Int, capped: Boolean) = _ui.update { s ->
        s.search?.let { s.copy(search = it.copy(running = false, done = true, total = total, capped = capped, progress = 1.0)) } ?: s
    }

    // ---- highlights, notes and bookmarks: device-local for Foliate CFIs (see LocatorPolicy / handoff F1) ----

    private fun intId(id: String): Int = id.hashCode().also { idOf[it] = id }

    private fun refreshAnnotationUi() {
        val items = annotations?.store?.visible().orEmpty()
        val marks = items.filter { it.kind != "bookmark" }.map { a ->
            BookAnnotation(
                id = intId(a.id), bookId = 0,
                cfi = (a.selection as? LSelection.FoliateRange)?.cfi ?: (a.locator as? LLocator.FoliateCfi)?.cfi,
                text = a.quote, color = a.color, style = "highlight", note = a.text.ifEmpty { null },
                chapterTitle = a.chapterTitle, origin = "app",
            )
        }
        val bms = items.filter { it.kind == "bookmark" }.map { BookBookmark(intId(it.id), 0, (it.locator as? LLocator.FoliateCfi)?.cfi, it.text, null) }
        _ui.update { it.copy(annotations = marks, bookmarks = bms, toolbar = null) }
    }

    override fun loadBookmarks() = refreshAnnotationUi()

    override fun addBookmark() {
        val cfi = currentCfi ?: return
        val st = _ui.value
        val title = BookmarkNames.default(st.chapterTitle, st.percentage)
        viewModelScope.launch {
            annotations?.create("bookmark", LLocator.FoliateCfi(cfi), null, "", title, "yellow", st.chapterTitle)
            refreshAnnotationUi()
        }
    }

    override fun deleteBookmark(id: Int) = remove(id)

    override fun onSelection(text: String, cfi: String?, rect: ViewportRect?) {
        if (cfi == null) return
        _ui.update { it.copy(toolbar = ReaderViewModel.ToolbarTarget(rect, selection = ReaderViewModel.PendingSelection(text, cfi))) }
    }

    override fun onSelectionCleared() {
        // A selection going away dismisses the new-highlight toolbar, but not one opened on an existing highlight.
        _ui.update { s -> if (s.toolbar?.annotationId == null) s.copy(toolbar = null) else s }
    }

    override fun onAnnotationTap(cfi: String, rect: ViewportRect?) {
        val ann = _ui.value.annotations.firstOrNull { it.cfi == cfi } ?: return
        _ui.update { it.copy(toolbar = ReaderViewModel.ToolbarTarget(rect, annotationId = ann.id)) }
    }

    override fun dismissToolbar() = _ui.update { it.copy(toolbar = null) }

    override fun highlight(color: String) = save(color, null)
    override fun saveNote(note: String) = save(null, note)

    private fun save(color: String?, note: String?) {
        val target = _ui.value.toolbar ?: return
        val a = annotations ?: return
        viewModelScope.launch {
            val sel = target.selection
            when {
                target.annotationId != null -> idOf[target.annotationId]?.let { a.edit(it, text = note, color = color) }
                sel != null -> a.create("highlight", LLocator.FoliateCfi(sel.cfi), LSelection.FoliateRange(sel.cfi), sel.text,
                    note.orEmpty(), color ?: "yellow", _ui.value.chapterTitle)
            }
            refreshAnnotationUi()
        }
    }

    override fun deleteAnnotation(id: Int) = remove(id)

    private fun remove(id: Int) {
        val aid = idOf[id] ?: return
        viewModelScope.launch { annotations?.delete(aid); refreshAnnotationUi() }
    }

    override fun consumeMessage() = _ui.update { it.copy(message = null) }
    override fun onError(message: String) = _ui.update { it.copy(error = UiText.raw(message)) }

    override fun updateSettings(settings: ReaderSettings) {
        _ui.update { it.copy(settings = settings) }
        viewModelScope.launch { settingsStore.save(settings) }
    }

    override fun dismissPagingHint() {
        _ui.update { it.copy(showPagingHint = false) }
        viewModelScope.launch { settingsStore.markPagingHintSeen() }
    }

    override fun onCleared() {
        flush()
        super.onCleared()
    }
}
