package com.litara.feature.litara.browse

import android.app.Application
import android.net.Uri
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.litara.R
import com.litara.core.litara.LContinueTarget
import com.litara.core.litara.LDirectoryAuthor
import com.litara.core.litara.LDirectoryDetails
import com.litara.core.litara.LDirectorySeries
import com.litara.core.litara.LMissingBooks
import com.litara.core.litara.LTitleRow
import com.litara.core.litara.PageResult
import com.litara.core.litara.PagedList
import com.litara.core.litara.PagedState
import com.litara.core.litara.SeriesPlace
import com.litara.core.litara.bookNumber
import com.litara.core.litara.groupBySeries
import com.litara.core.litara.missingNumbers
import com.litara.core.litara.readingOrder
import com.litara.feature.litara.LitaraRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

// ---- the author and series directories (ADR-0100, ADR-0101) ------------------------------------------------------

data class DirectoryQuery(val q: String = "", val sort: String, val letter: String? = null)

abstract class DirectoryViewModel<T>(app: Application, repo: LitaraRepository, defaultSort: String, keyOf: (T) -> Any) : BrowseViewModel(app, repo) {
    private val _query = MutableStateFlow(DirectoryQuery(sort = defaultSort))
    val query: StateFlow<DirectoryQuery> = _query.asStateFlow()
    private val _list = MutableStateFlow(PagedState<T>())
    val list: StateFlow<PagedState<T>> = _list.asStateFlow()
    private val paged = PagedList<T>(keyOf) { _list.value = it }
    private var loading: Job? = null

    /** The first letters that have entries; only the author directory reports them. */
    private val _letters = MutableStateFlow(emptyList<String>())
    val letters: StateFlow<List<String>> = _letters.asStateFlow()

    protected abstract suspend fun page(query: DirectoryQuery, page: Int): Pair<PageResult<T>, List<String>>

    fun start() { if (loading == null) reload() }

    fun change(query: DirectoryQuery) {
        if (query == _query.value) return
        val typing = query.q != _query.value.q
        _query.value = query
        reload(if (typing) 350 else 0)
    }

    fun reload(afterMs: Long = 0) {
        loading?.cancel()
        val query = _query.value
        loading = viewModelScope.launch {
            delay(afterMs)
            paged.reset { n -> page(query, n).also { (_, letters) -> _letters.value = letters }.first }
        }
    }

    fun loadMore() { viewModelScope.launch { paged.loadMore() } }
}

@HiltViewModel
class AuthorsViewModel @Inject constructor(app: Application, repo: LitaraRepository) :
    DirectoryViewModel<LDirectoryAuthor>(app, repo, "last", { it.name.lowercase() }) {
    override suspend fun page(query: DirectoryQuery, page: Int) =
        client().authors(query.q, query.sort, query.letter, page).let { PageResult(it.items, it.total) to it.letters }
}

@HiltViewModel
class SeriesListViewModel @Inject constructor(app: Application, repo: LitaraRepository) :
    DirectoryViewModel<LDirectorySeries>(app, repo, "name", { it.name.lowercase() }) {
    override suspend fun page(query: DirectoryQuery, page: Int) =
        client().seriesList(query.q, query.sort, page).let { PageResult(it.items, it.total) to emptyList<String>() }
}

@Composable
fun AuthorsSection(nav: BrowseNav, vm: AuthorsViewModel = hiltViewModel()) {
    LaunchedEffect(Unit) { vm.start() }
    val query by vm.query.collectAsStateWithLifecycle()
    val list by vm.list.collectAsStateWithLifecycle()
    val letters by vm.letters.collectAsStateWithLifecycle()
    val sorts = listOf("last" to stringResource(R.string.browse_sort_last_name), "first" to stringResource(R.string.browse_sort_first_name))
    BrowseSearchField(query.q, { vm.change(query.copy(q = it)) }, stringResource(R.string.browse_search_authors))
    // A letter belongs to the sorted name, so changing the sort clears it.
    Chooser(sorts.first { it.first == query.sort }.second, sorts, { vm.change(query.copy(sort = it, letter = null)) })
    if (letters.isNotEmpty()) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            FilterChip(query.letter == null, { vm.change(query.copy(letter = null)) }, { Text(stringResource(R.string.browse_all_letters)) })
            letters.forEach { l -> FilterChip(query.letter == l, { vm.change(query.copy(letter = l)) }, { Text(l) }) }
        }
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(list.items, key = { it.name.lowercase() }) { a ->
            EntryRow(
                a.name,
                listOf(pluralStringResource(R.plurals.browse_book_count, a.titles.toInt(), a.titles.toInt()) +
                    if (a.seriesCount > 0) " · " + pluralStringResource(R.plurals.browse_series_count, a.seriesCount.toInt(), a.seriesCount.toInt()) else ""),
                { nav.author(a.name) }, Modifier.testTag(BrowseTags.author(a.name)),
                leading = { Portrait(a.name, a.photoVersion?.let { vm.authorPhotoUrl(a.name, it) }, vm.covers, null) },
            )
        }
        pagedFooter(list, vm::message, { EmptyNote(stringResource(if (query.q.isBlank() && query.letter == null) R.string.browse_none_yet else R.string.browse_nothing)) }, vm::loadMore)
    }
}

@Composable
fun SeriesSection(nav: BrowseNav, vm: SeriesListViewModel = hiltViewModel()) {
    LaunchedEffect(Unit) { vm.start() }
    val query by vm.query.collectAsStateWithLifecycle()
    val list by vm.list.collectAsStateWithLifecycle()
    val sorts = listOf("name" to stringResource(R.string.browse_sort_name), "titles" to stringResource(R.string.browse_sort_most))
    BrowseSearchField(query.q, { vm.change(query.copy(q = it)) }, stringResource(R.string.browse_search_series))
    Chooser(sorts.first { it.first == query.sort }.second, sorts, { vm.change(query.copy(sort = it)) })
    LazyColumn(Modifier.fillMaxSize()) {
        items(list.items, key = { it.name.lowercase() }) { s ->
            EntryRow(
                s.name,
                listOf(s.authors.joinToString(", "), pluralStringResource(R.plurals.browse_book_count, s.titles.toInt(), s.titles.toInt()) +
                    " · " + stringResource(R.string.browse_finished_count, s.finished.toInt())),
                { nav.series(s.name) }, Modifier.testTag(BrowseTags.series(s.name)),
                leading = { BookCover(vm.coverUrl(s.coverTitleId, audio = false), vm.covers, null) },
            )
        }
        pagedFooter(list, vm::message, { EmptyNote(stringResource(if (query.q.isBlank()) R.string.browse_none_yet else R.string.browse_nothing)) }, vm::loadMore)
    }
}

// ---- one author or one series -------------------------------------------------------------------------------------

data class MemberUi(
    val loading: Boolean = true,
    val error: String? = null,
    val titles: List<LTitleRow> = emptyList(),
    /** Saved introduction, biography, description and photo; null while loading or when they could not be read. */
    val details: LDirectoryDetails? = null,
    val missing: LMissingBooks? = null,
    val next: LContinueTarget? = null,
)

/** The books of one author or series, read the way the web reads them, with the saved details beside them. */
abstract class MemberViewModel(app: Application, repo: LitaraRepository, saved: SavedStateHandle, private val series: Boolean) : BrowseViewModel(app, repo) {
    val name: String = Uri.decode(saved.get<String>("name").orEmpty())
    private val _ui = MutableStateFlow(MemberUi())
    val ui: StateFlow<MemberUi> = _ui.asStateFlow()

    fun load() {
        _ui.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val titles = client().titlesBy(if (series) "series" else "author", name)
                _ui.update { it.copy(loading = false, titles = titles) }
                if (titles.isEmpty()) return@launch
                // The extras must not hide the books when one of them fails.
                coroutineScope {
                    val details = async { optional { client().directoryDetails(if (series) "series" else "authors", name) } }
                    val missing = async { if (series) optional { client().missingBooks(name) } else null }
                    val next = async { optional { client().continueReading(if (series) "series" else "author", name) } }
                    _ui.update { it.copy(details = details.await(), missing = missing.await(), next = next.await()) }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, error = message(e)) }
            }
        }
    }

    private suspend fun <T> optional(block: suspend () -> T): T? = try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) {
        android.util.Log.w("LitaraBrowse", "optional details failed", e)
        null
    }
}

@HiltViewModel
class AuthorViewModel @Inject constructor(app: Application, repo: LitaraRepository, saved: SavedStateHandle) : MemberViewModel(app, repo, saved, series = false)

@HiltViewModel
class SeriesViewModel @Inject constructor(app: Application, repo: LitaraRepository, saved: SavedStateHandle) : MemberViewModel(app, repo, saved, series = true)

/** Names the provider a saved value or a missing-books list came from, linking to the record (ADR-0106). */
@Composable
private fun Credit(text: String, url: String?) {
    val links = LocalUriHandler.current
    TextButton({ url?.let { runCatching { links.openUri(it) } } }, enabled = url?.startsWith("https://") == true) {
        Text(text, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun providerName(provider: String) = when (provider) {
    "hardcover" -> "Hardcover"
    "open_library" -> "Open Library"
    else -> provider
}

@Composable
private fun SavedText(details: LDirectoryDetails?, field: String) {
    val text = details?.text(field) ?: return
    Column {
        Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 4.dp))
        val provider = details.providerOf(field) ?: return@Column
        Credit(stringResource(R.string.browse_credit, providerName(provider)), details.fields.first { it.field == field }.providerUrl)
    }
}

@Composable
private fun ContinueButton(next: LContinueTarget?, nav: BrowseNav) {
    if (next == null) return
    val id = next.titleId
    if (id == null) {
        EmptyNote(stringResource(R.string.browse_all_finished))
        return
    }
    Button({ nav.title(id) }, Modifier.fillMaxWidth()) {
        Text(stringResource(if (next.state == "reading") R.string.browse_continue else R.string.browse_start, next.title.orEmpty()))
    }
}

@Composable
fun AuthorScreen(nav: BrowseNav, vm: AuthorViewModel = hiltViewModel()) {
    LaunchedEffect(Unit) { vm.load() }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val shown = ui.titles.flatMap { it.authors }.firstOrNull { it.equals(vm.name, ignoreCase = true) } ?: vm.name
    BrowsePage(shown, nav.back) {
        if (ui.loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        ui.error?.let { e -> item { ErrorLine(e, vm::load) } }
        val photo = ui.details?.photo
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                photo?.version?.let { v ->
                    Portrait(shown, vm.authorPhotoUrl(vm.name, v), vm.covers, stringResource(R.string.browse_photo_of, shown), size = 120)
                    photo.provider?.let { p -> Credit(stringResource(R.string.browse_credit, providerName(p)), photo.providerUrl) }
                }
                SavedText(ui.details, "introduction")
                ContinueButton(ui.next, nav)
                SavedText(ui.details, "biography")
            }
        }
        if (!ui.loading && ui.error == null && ui.titles.isEmpty()) item { EmptyNote(stringResource(R.string.browse_gone)) }
        groupBySeries(ui.titles).forEach { group ->
            item(key = "group-" + group.series?.lowercase()) {
                val series = group.series
                if (series == null) {
                    Text(stringResource(R.string.browse_no_series), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
                } else {
                    TextButton({ nav.series(series) }) { Text(series, style = MaterialTheme.typography.titleMedium) }
                }
            }
            items(group.titles, key = { it.id }) { t -> TitleRowItem(vm, t, { nav.title(t.id) }, showNumber = group.series != null) }
        }
    }
}

/** Past this many gaps the page names them in one sentence instead of giving each a row. */
private const val MAX_GAP_ROWS = 12

@Composable
fun SeriesScreen(nav: BrowseNav, vm: SeriesViewModel = hiltViewModel()) {
    LaunchedEffect(Unit) { vm.load() }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val shown = ui.titles.firstOrNull()?.series?.firstOrNull() ?: vm.name
    val authors = ui.titles.flatMap { it.authors }.distinctBy { it.lowercase() }
    val links = LocalUriHandler.current
    BrowsePage(shown, nav.back) {
        if (ui.loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        ui.error?.let { e -> item { ErrorLine(e, vm::load) } }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.horizontalScroll(rememberScrollState())) { authors.forEach { a -> TextButton({ nav.author(a) }) { Text(a) } } }
                SavedText(ui.details, "description")
                ContinueButton(ui.next, nav)
                ui.missing?.match?.let { m -> Credit(stringResource(R.string.browse_credit_missing, providerName(m.provider)), m.url) }
            }
        }
        if (!ui.loading && ui.error == null && ui.titles.isEmpty()) item { EmptyNote(stringResource(R.string.browse_gone)) }
        val gaps = if (ui.missing?.match == null) missingNumbers(ui.titles.map { it.seriesIndex }) else emptyList()
        if (gaps.size > MAX_GAP_ROWS) item { EmptyNote(stringResource(R.string.browse_gaps_many, gaps.joinToString { "#$it" })) }
        items(
            readingOrder(ui.titles, ui.missing).filter { it !is SeriesPlace.Gap || gaps.size <= MAX_GAP_ROWS },
            key = {
                when (it) {
                    is SeriesPlace.Book -> it.row.id
                    is SeriesPlace.Gap -> "gap-${it.number}"
                    is SeriesPlace.Missing -> "missing-${it.member.number}"
                }
            },
        ) { place ->
            when (place) {
                is SeriesPlace.Book -> TitleRowItem(vm, place.row, { nav.title(place.row.id) }, showNumber = true)
                is SeriesPlace.Gap -> EmptyNote(stringResource(R.string.browse_gap, "#${place.number}"))
                is SeriesPlace.Missing -> {
                    val m = place.member
                    EntryRow(
                        bookNumber(m.number.toDouble()) + " " + m.title,
                        listOf(m.authors.joinToString(", "), stringResource(R.string.browse_missing_member)),
                        if (m.url.startsWith("https://")) ({ runCatching { links.openUri(m.url) }; Unit }) else null,
                        leading = { BookCover(m.coverVersion?.let { vm.missingCoverUrl(vm.name, m.number, it) }, vm.covers, null) },
                    )
                }
            }
        }
    }
}
