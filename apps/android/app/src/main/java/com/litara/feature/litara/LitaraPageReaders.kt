package com.litara.feature.litara

import com.litara.feature.reader.comic.ComicUiState
import com.litara.feature.reader.pdf.PdfSearchHit
import com.litara.feature.reader.pdf.PdfSearchState
import com.litara.feature.reader.pdf.PdfUiState
import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.litara.R
import com.litara.core.litara.ComicPageStore
import com.litara.core.litara.EditionProgressSync
import com.litara.core.litara.LEdition
import com.litara.core.litara.LLocator
import com.litara.core.litara.LPageManifest
import com.litara.core.settings.AppSettingsStore
import com.litara.core.storage.LocalRef
import com.litara.feature.reader.comic.ComicHost
import com.litara.feature.reader.comic.ComicPaging
import com.litara.feature.reader.pdf.PdfHost
import com.litara.feature.reader.pdf.PdfJump
import com.litara.feature.reader.pdf.PdfMarks
import com.litara.feature.reader.pdf.PdfReaderSettings
import com.litara.feature.reader.pdf.PdfReaderSettingsStore
import com.litara.feature.reader.pdf.PdfRenderCore
import com.litara.ui.UiText
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

private const val PROGRESS_THROTTLE_MS = 2_000L

private const val MAX_NOTE = 4_000

private const val MAX_QUOTE = 16_000

/** The latest position is sent this long after the last change, so a killed app loses at most a moment of reading. */
private const val IDLE_FLUSH_MS = 1_500L

/**
 * Reads one Litara comic edition (CBZ/CBR/CB7) through the preserved pager. Pages are the server's validated,
 * extracted images for the exact file version; positions are the manifest's own page identity
 * (`pageIndex` + `entryId` + `manifestVersion`), the same shape the web reader writes, so they are canonical.
 */
@HiltViewModel
class LitaraComicViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repo: LitaraRepository,
    private val settings: AppSettingsStore,
    private val activity: LitaraActivityRecorder,
) : ViewModel(), ComicHost {
    private val editionId: String = savedStateHandle.get<String>("editionId").orEmpty()

    private val _ui = MutableStateFlow(ComicUiState())
    override val ui: StateFlow<ComicUiState> = _ui.asStateFlow()

    override val rtl: StateFlow<Boolean> = settings.comicRtl.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    private var manifest: LPageManifest? = null
    private var store: ComicPageStore? = null
    private var sync: EditionProgressSync? = null
    private var lastSent = 0L
    private var pendingPage: Int? = null
    private var flushJob: Job? = null
    private var annotations: com.litara.core.litara.EditionAnnotationSync? = null
    private val _bookmarked = MutableStateFlow(false)

    override val supportsBookmarks: Boolean get() = true
    override val bookmarkedPage: StateFlow<Boolean> = _bookmarked.asStateFlow()

    init { load() }

    override fun load() {
        _ui.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val snap = repo.readerSnapshot(editionId)
                val e: LEdition = snap.edition
                if (e.file.format !in COMIC_FORMATS || !e.capabilities.read.supported || e.file.contentPath == null) {
                    val why = e.capabilities.read.issues.joinToString { it.code }.ifEmpty { e.file.format.uppercase() }
                    _ui.update { it.copy(loading = false, title = e.label, error = UiText.of(R.string.litara_book_not_readable, why)) }
                    return@launch
                }
                val m = repo.waitForManifest(e, repo.comicManifest(e))
                if (m.state != "ready" || m.pages.isEmpty()) {
                    val why = m.issues.joinToString { it.code }.ifEmpty { m.state }
                    _ui.update { it.copy(loading = false, title = e.label, error = UiText.of(R.string.litara_book_not_readable, why)) }
                    return@launch
                }
                manifest = m
                store = repo.comicPages(e, m)
                annotations = repo.editionAnnotations(snap).also { it.refresh(setOf("comic-page")) }
                val s = repo.editionProgress(snap).also { sync = it }
                // Resume by page identity (entry id), never by a bare index: the page must exist in THIS manifest.
                val saved = (s.serverLocator(setOf("comic-page")) ?: s.local()?.anchor) as? LLocator.ComicPage
                val page = saved?.let { loc -> m.pages.indexOfFirst { it.entryId == loc.entryId }.takeIf { it >= 0 } } ?: 0
                _ui.update { it.copy(loading = false, title = e.label, fileId = 1, pageCount = m.pages.size, initialPage = page, currentPage = page) }
                s.flushPending()
                activity.onReading(editionId, (page + 1).toDouble() / m.pages.size)
                refreshBookmarkState()
            } catch (ex: Exception) {
                _ui.update { it.copy(loading = false, error = UiText.raw(ex.message ?: "Could not open this comic.")) }
            }
        }
    }

    /** The local page file, fetched with the bearer the first time it is needed; null shows the loader's error state. */
    override suspend fun loadPage(index: Int): Any? = try { store?.page(index) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { null }

    override fun onPageChanged(page: Int) {
        val m = manifest ?: return
        if (page == _ui.value.currentPage || page !in m.pages.indices) return
        _ui.update { it.copy(currentPage = page) }
        activity.onReading(editionId, (page + 1).toDouble() / m.pages.size)
        refreshBookmarkState()
        pendingPage = page
        if (System.currentTimeMillis() - lastSent >= PROGRESS_THROTTLE_MS) flush()
        flushJob?.cancel()
        flushJob = viewModelScope.launch { kotlinx.coroutines.delay(IDLE_FLUSH_MS); flush() }
    }

    /** The bookmark of the shown page, matched by the page's entry id (its identity), never by index alone. */
    private fun bookmarkOfCurrentPage(): com.litara.core.litara.LocalAnnotation? {
        val m = manifest ?: return null
        val entry = m.pages.getOrNull(_ui.value.currentPage)?.entryId ?: return null
        return annotations?.store?.visible()?.firstOrNull { it.kind == "bookmark" && (it.locator as? LLocator.ComicPage)?.entryId == entry }
    }

    private fun refreshBookmarkState() { _bookmarked.value = bookmarkOfCurrentPage() != null }

    override fun toggleBookmark() {
        val m = manifest ?: return
        val a = annotations ?: return
        val index = _ui.value.currentPage
        val page = m.pages.getOrNull(index) ?: return
        viewModelScope.launch {
            val existing = bookmarkOfCurrentPage()
            // A conflict or queued delivery is kept on the device/server; the Books tab shows pending conflicts.
            if (existing != null) a.delete(existing.id)
            else a.create("bookmark", LLocator.ComicPage(page.index, page.entryId, m.manifestVersion), null, "", "", null, null)
            refreshBookmarkState()
        }
    }

    override fun setRtl(value: Boolean) { viewModelScope.launch { settings.setComicRtl(value) } }

    override fun flush() {
        val m = manifest ?: return
        val s = sync ?: return
        val page = pendingPage ?: return
        pendingPage = null
        lastSent = System.currentTimeMillis()
        val p = m.pages[page]
        viewModelScope.launch {
            s.report(LLocator.ComicPage(p.index, p.entryId, m.manifestVersion), ComicPaging.percentage(page, m.pages.size) / 100.0)
        }
    }

    override fun onCleared() { flush(); activity.endReading(editionId); super.onCleared() }
}

val COMIC_FORMATS = setOf("cbz", "cbr", "cb7")

/**
 * Reads one Litara PDF edition through the preserved native PDF reader over the exact file version.
 * Positions are page-level and stay on the device: PDF coordinates are renderer-defined and no profile is proven
 * yet (see [com.litara.core.litara.LocatorPolicy]). Search needs Android 15+, as in the preserved reader.
 */
@HiltViewModel
class LitaraPdfViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repo: LitaraRepository,
    private val settingsStore: PdfReaderSettingsStore,
    @ApplicationContext private val context: Context,
    private val activity: LitaraActivityRecorder,
) : ViewModel(), PdfHost {
    private val editionId: String = savedStateHandle.get<String>("editionId").orEmpty()

    private val _ui = MutableStateFlow(PdfUiState())
    override val ui: StateFlow<PdfUiState> = _ui.asStateFlow()

    private var sync: EditionProgressSync? = null
    private var lastSent = 0L
    private var pendingPage: Int? = null
    private var searchJob: Job? = null
    private var flushJob: Job? = null
    private var annotations: com.litara.core.litara.EditionAnnotationSync? = null
    private var jumps = 0

    init { load() }

    private fun publishMarks() {
        val a = annotations ?: return
        _ui.update { it.copy(marks = PdfMarks.from(a.store.visible())) }
    }

    /** Sends waiting changes and merges the server's. Reading never waits for this, and it never closes the book. */
    private fun syncMarks() {
        val a = annotations ?: return
        viewModelScope.launch {
            try {
                a.refresh(setOf("pdf-page", "pdf-rectangles"))
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (_: Exception) { /* What this device has stays shown; the next opening asks again. */ }
            publishMarks()
        }
    }

    private fun changeMarks(change: suspend (com.litara.core.litara.EditionAnnotationSync) -> Unit) {
        val a = annotations ?: return
        viewModelScope.launch {
            // The change is saved on the device before it is sent, so a failed send still shows it.
            try { change(a) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { }
            publishMarks()
        }
    }

    override fun toggleBookmark() {
        val page = _ui.value.currentPage
        changeMarks { a ->
            val existing = PdfMarks.bookmarkOn(PdfMarks.from(a.store.visible()), page)
            if (existing != null) a.delete(existing.id)
            else a.create("bookmark", LLocator.PdfPage(page, 0.0, 0.0), null, "", "", null, null)
        }
    }

    override fun addNote(pageIndex: Int, text: String) {
        val note = text.trim().take(MAX_NOTE)
        if (note.isNotEmpty()) changeMarks { it.create("note", LLocator.PdfPage(pageIndex, 0.0, 0.0), null, "", note, null, null) }
    }

    override fun editNote(id: String, text: String) {
        val note = text.trim().take(MAX_NOTE)
        if (note.isNotEmpty()) changeMarks { it.edit(id, text = note) }
    }

    override fun deleteMark(id: String) = changeMarks { it.delete(id) }

    override fun addHighlight(selection: com.litara.feature.reader.SharedEvent.PdfPick, quote: String, color: String?, note: String?) {
        if (!_ui.value.highlightAvailable) return
        val first = selection.rectangles.first()
        val text = note?.trim()?.take(MAX_NOTE).orEmpty()
        changeMarks {
            // The same shape the web writes: the page place is the first rectangle's corner.
            it.create(if (text.isEmpty()) "highlight" else "note", LLocator.PdfPage(selection.pageIndex, first.x, first.y),
                com.litara.core.litara.LSelection.PdfRectangles(selection.pageIndex, selection.rectangles),
                quote.take(MAX_QUOTE), text, color, null)
        }
    }

    override fun setMarkColor(id: String, color: String) = changeMarks { it.edit(id, color = color) }

    /** The engine profile the bundled reader copy was made for (ADR-0093); blank if it cannot be read. */
    private fun bundledPdfProfile(): String = runCatching {
        context.assets.open("reader-shared/ENGINE_PROFILE").bufferedReader().useLines { lines ->
            lines.firstOrNull { it.startsWith("pdfjs=") }?.removePrefix("pdfjs=")?.trim().orEmpty()
        }
    }.getOrDefault("")

    override fun jumpTo(pageIndex: Int) {
        val total = _ui.value.pageCount
        if (total <= 0) return
        val page = pageIndex.coerceIn(0, total - 1)
        _ui.update { it.copy(jump = PdfJump(page, ++jumps)) }
        onPageChanged(page)
    }

    override fun jumpHandled(seq: Int) = _ui.update { if (it.jump?.seq == seq) it.copy(jump = null) else it }

    private fun load() {
        viewModelScope.launch {
            _ui.update { it.copy(settings = settingsStore.load()) }
            try {
                val snap = repo.readerSnapshot(editionId)
                val e = snap.edition
                _ui.update { it.copy(title = e.label) }
                if (snap.engine != "pdfjs" || e.file.format != "pdf" || !e.capabilities.read.supported) {
                    val why = e.capabilities.read.issues.joinToString { it.code }.ifEmpty { e.file.format.uppercase() }
                    _ui.update { it.copy(loading = false, error = UiText.of(R.string.litara_book_not_readable, why)) }
                    return@launch
                }
                val file = repo.editionFile(snap)
                val core = PdfRenderCore.open(context, LocalRef.PlainFile(file))
                annotations = repo.editionAnnotations(snap)
                _ui.update { it.copy(highlightAvailable = snap.engineProfile == bundledPdfProfile()) }
                publishMarks()
                syncMarks()
                val s = repo.editionProgress(snap).also { sync = it }
                // Page granularity: only the page index of a server locator is used (its x/y are never applied or overwritten
                // while the reader stays on that page). A device-only newer position wins when it has not been sent yet.
                val saved = ((if (s.hasPending()) null else s.serverLocator(setOf("pdf-page"))) ?: s.local()?.anchor) as? LLocator.PdfPage
                val page = (saved?.pageIndex ?: 0).coerceIn(0, (core.pageCount - 1).coerceAtLeast(0))
                _ui.update { it.copy(loading = false, core = core, ref = LocalRef.PlainFile(file), pageCount = core.pageCount, initialPage = page, currentPage = page) }
                s.flushPending()
            } catch (ex: Exception) {
                _ui.update { it.copy(loading = false, error = UiText.raw(ex.message ?: "Could not open this PDF.")) }
            }
        }
    }

    override fun onPageChanged(pageIndex: Int) {
        val total = _ui.value.pageCount
        if (total <= 0) return
        val clamped = pageIndex.coerceIn(0, total - 1)
        if (clamped == _ui.value.currentPage) return
        _ui.update { it.copy(currentPage = clamped) }
        activity.onReading(editionId, (clamped + 1).toDouble() / total)
        pendingPage = clamped
        if (System.currentTimeMillis() - lastSent >= PROGRESS_THROTTLE_MS) flush()
        flushJob?.cancel()
        flushJob = viewModelScope.launch { kotlinx.coroutines.delay(IDLE_FLUSH_MS); flush() }
    }

    override fun flush() {
        val s = sync ?: return
        val page = pendingPage ?: return
        val total = _ui.value.pageCount
        pendingPage = null
        lastSent = System.currentTimeMillis()
        viewModelScope.launch {
            // Page granularity only: x=0, y=0 is the top of the page; sub-page coordinates are not claimed. The policy keeps
            // this on the device (the Account tab says positions are not synced for PDF yet).
            s.report(LLocator.PdfPage(page, 0.0, 0.0), (page + 1).toDouble() / total)
        }
    }

    override fun updateSettings(settings: PdfReaderSettings) {
        _ui.update { it.copy(settings = settings) }
        viewModelScope.launch { settingsStore.save(settings) }
    }

    override fun search(query: String) {
        val core = _ui.value.core ?: return
        searchJob?.cancel()
        if (query.isBlank()) { _ui.update { it.copy(search = null) }; return }
        _ui.update { it.copy(search = PdfSearchState(query = query, running = true)) }
        searchJob = viewModelScope.launch {
            val hits = withContext(Dispatchers.IO) {
                buildList<PdfSearchHit> {
                    for (p in 0 until core.pageCount) core.searchPage(p, query).forEach { m -> m.rects.forEach { add(PdfSearchHit(p, it)) } }
                }
            }
            _ui.update { it.copy(search = PdfSearchState(query, false, hits, if (hits.isEmpty()) -1 else 0)) }
        }
    }

    override fun nextMatch() = step(1)
    override fun prevMatch() = step(-1)

    private fun step(delta: Int) {
        val s = _ui.value.search ?: return
        if (s.hits.isEmpty()) return
        _ui.update { it.copy(search = s.copy(activeIndex = (s.activeIndex + delta + s.hits.size) % s.hits.size)) }
    }

    override fun clearSearch() { searchJob?.cancel(); _ui.update { it.copy(search = null) } }

    override fun onCleared() {
        flush()
        activity.endReading(editionId)
        _ui.value.core?.close()
        super.onCleared()
    }
}
