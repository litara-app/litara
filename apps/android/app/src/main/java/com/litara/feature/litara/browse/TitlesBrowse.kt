package com.litara.feature.litara.browse

import android.app.Application
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.litara.R
import com.litara.core.litara.LTitleRow
import com.litara.core.litara.LitaraJson
import com.litara.core.litara.PageResult
import com.litara.core.litara.PagedList
import com.litara.core.litara.PagedState
import com.litara.core.litara.TitleQuery
import com.litara.core.litara.bookNumber
import com.litara.feature.litara.LitaraRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import javax.inject.Inject

private const val KEY_QUERY = "title-query"

/** The server's title list with its own search, filters and sorting, read a page at a time. */
@HiltViewModel
class TitlesViewModel @Inject constructor(app: Application, repo: LitaraRepository, private val saved: SavedStateHandle) : BrowseViewModel(app, repo) {
    private val _query = MutableStateFlow(saved.get<String>(KEY_QUERY)?.let { runCatching { LitaraJson.decodeFromString<TitleQuery>(it) }.getOrNull() } ?: TitleQuery())
    val query: StateFlow<TitleQuery> = _query.asStateFlow()
    private val _list = MutableStateFlow(PagedState<LTitleRow>())
    val list: StateFlow<PagedState<LTitleRow>> = _list.asStateFlow()
    private val paged = PagedList<LTitleRow>({ it.id }) { _list.value = it }
    private var loading: Job? = null

    init { reload() }

    /** Typing waits a moment before it asks the server; everything else asks at once. */
    fun change(query: TitleQuery) {
        if (query == _query.value) return
        val typing = query.copy(q = _query.value.q) == _query.value
        _query.value = query
        saved[KEY_QUERY] = LitaraJson.encodeToString(query)
        reload(if (typing) 350 else 0)
    }

    fun reload(afterMs: Long = 0) {
        loading?.cancel()
        val query = _query.value
        loading = viewModelScope.launch {
            delay(afterMs)
            paged.reset { page -> client().titleRows(query, page).let { PageResult(it.items, it.total) } }
        }
    }

    fun loadMore() { viewModelScope.launch { paged.loadMore() } }
}

private val SORT_LABELS = mapOf(
    "title" to R.string.browse_sort_title, "author" to R.string.browse_sort_author, "series" to R.string.browse_sort_series,
    "added" to R.string.browse_sort_added, "published" to R.string.browse_sort_published, "rating" to R.string.browse_sort_rating,
    "status" to R.string.browse_sort_status, "publisher" to R.string.browse_sort_publisher, "language" to R.string.browse_sort_language,
    "pages" to R.string.browse_sort_pages, "series_index" to R.string.browse_sort_series_index, "editions" to R.string.browse_sort_editions,
)

@Composable
fun statusLabel(status: String): String? = when (status) {
    "reading" -> stringResource(R.string.browse_status_reading)
    "finished" -> stringResource(R.string.browse_status_finished)
    else -> null
}

/** "★ 4.5" for a rating in half stars. */
fun stars(halves: Int?): String? = halves?.let { "★ " + if (it % 2 == 0) "${it / 2}" else "${it / 2}.5" }

/** One title in any of the browsing lists. */
@Composable
fun TitleRowItem(vm: BrowseViewModel, row: LTitleRow, onClick: () -> Unit, showNumber: Boolean = false) {
    val name = if (showNumber && row.seriesIndex != null) "${bookNumber(row.seriesIndex)} ${row.title}" else row.title
    val series = row.series.firstOrNull()?.let { s -> s + (row.seriesIndex?.let { " ${bookNumber(it)}" } ?: "") }
    val kinds = (row.formats.filter { it != "audio" }.map { it.uppercase() } +
        listOfNotNull(stringResource(R.string.browse_one_audiobook).takeIf { row.recordingCount > 0 })).joinToString(", ")
    EntryRow(
        title = name,
        lines = listOf(
            row.authors.joinToString(", "),
            if (showNumber) "" else series.orEmpty(),
            listOfNotNull(kinds.ifBlank { null }, statusLabel(row.status), stars(row.ratingHalves)).joinToString(" · "),
        ),
        onClick = onClick,
        modifier = Modifier.testTag(BrowseTags.title(row.id)),
        leading = { BookCover(vm.coverUrl(row.id, audio = row.editionCount == 0L), vm.covers, null) },
    )
}

@Composable
fun TitlesSection(nav: BrowseNav, vm: TitlesViewModel = hiltViewModel()) {
    val query by vm.query.collectAsStateWithLifecycle()
    val list by vm.list.collectAsStateWithLifecycle()
    var filtering by rememberSaveable { mutableStateOf(false) }
    val scroll = rememberLazyListState()
    BrowseSearchField(query.q, { vm.change(query.copy(q = it)) }, stringResource(R.string.browse_search_titles))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton({ filtering = true }, Modifier.testTag(BrowseTags.FILTERS)) {
            Text(if (query.filterCount == 0) stringResource(R.string.browse_filters) else stringResource(R.string.browse_filters_count, query.filterCount))
        }
        Chooser(stringResource(R.string.browse_sort, stringResource(SORT_LABELS.getValue(query.sort))),
            TitleQuery.SORTS.map { it to stringResource(SORT_LABELS.getValue(it)) }, { vm.change(query.copy(sort = it)) }, Modifier.testTag(BrowseTags.SORT))
        TextButton({ vm.change(query.copy(descending = !query.descending)) }) {
            Text(stringResource(if (query.descending) R.string.browse_descending else R.string.browse_ascending))
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(if (list.loaded) pluralStringResource(R.plurals.browse_title_count, list.total.toInt(), list.total.toInt()) else "",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f).testTag(BrowseTags.COUNT))
        TextButton({ vm.reload() }) { Text(stringResource(R.string.browse_refresh)) }
    }
    LazyColumn(Modifier.fillMaxSize(), state = scroll) {
        items(list.items, key = { it.id }) { row -> TitleRowItem(vm, row, { nav.title(row.id) }) }
        pagedFooter(list, vm::message, { EmptyNote(stringResource(R.string.browse_nothing)) }, vm::loadMore)
    }
    if (filtering) FilterDialog(query, onDismiss = { filtering = false }, onApply = { vm.change(it); filtering = false })
}

@Composable
private fun Choice(label: String, value: String?, options: List<Pair<String?, String>>, onValue: (String?) -> Unit) {
    val all = listOf<Pair<String?, String>>(null to stringResource(R.string.browse_any)) + options
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Chooser(all.firstOrNull { it.first == value }?.second ?: value.orEmpty(), all, onValue)
    }
}

@Composable
private fun TextFilter(label: String, value: String, modifier: Modifier = Modifier, onValue: (String) -> Unit) =
    OutlinedTextField(value, onValue, label = { Text(label) }, singleLine = true, modifier = modifier.fillMaxWidth())

@Composable
private fun FilterDialog(start: TitleQuery, onDismiss: () -> Unit, onApply: (TitleQuery) -> Unit) {
    var q by remember { mutableStateOf(start) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.browse_filters)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.browse_filters_note), style = MaterialTheme.typography.bodySmall)
                Choice(stringResource(R.string.browse_filter_kind), q.mediaKind,
                    listOf("ebook" to stringResource(R.string.browse_kind_ebook), "audio" to stringResource(R.string.browse_kind_audio))) { q = q.copy(mediaKind = it) }
                Choice(stringResource(R.string.browse_filter_status), q.status, listOf(
                    "unread" to stringResource(R.string.browse_status_unread), "reading" to stringResource(R.string.browse_status_reading),
                    "finished" to stringResource(R.string.browse_status_finished))) { q = q.copy(status = it) }
                Choice(stringResource(R.string.browse_filter_rated), q.rated,
                    listOf("rated" to stringResource(R.string.browse_rated), "unrated" to stringResource(R.string.browse_unrated))) { q = q.copy(rated = it) }
                Choice(stringResource(R.string.browse_filter_format), q.format.ifBlank { null },
                    listOf("epub", "kepub", "pdf", "mobi", "azw3", "fb2", "cbz", "cbr", "cb7", "audio").map { it to it.uppercase() }) { q = q.copy(format = it.orEmpty()) }
                TextFilter(stringResource(R.string.browse_filter_author), q.author, Modifier.testTag(BrowseTags.FILTER_AUTHOR)) { q = q.copy(author = it) }
                TextFilter(stringResource(R.string.browse_filter_series), q.series) { q = q.copy(series = it) }
                TextFilter(stringResource(R.string.browse_filter_publisher), q.publisher) { q = q.copy(publisher = it) }
                TextFilter(stringResource(R.string.browse_filter_language), q.language) { q = q.copy(language = it) }
                TextButton({ q = q.cleared() }) { Text(stringResource(R.string.browse_filters_clear)) }
            }
        },
        confirmButton = { TextButton({ onApply(q) }, Modifier.testTag(BrowseTags.FILTER_APPLY)) { Text(stringResource(R.string.browse_filters_apply)) } },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.browse_cancel)) } },
    )
}
