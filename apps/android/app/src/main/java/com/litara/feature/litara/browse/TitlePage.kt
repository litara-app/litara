package com.litara.feature.litara.browse

import android.app.Application
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.StarHalf
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.litara.R
import com.litara.core.litara.usesAudioCover
import com.litara.core.litara.ChangedElsewhereException
import com.litara.core.litara.LEdition
import com.litara.core.litara.LRecordingLink
import com.litara.core.litara.LShelf
import com.litara.core.litara.LTitlePersonal
import com.litara.core.litara.LTitleSummary
import com.litara.core.litara.PersonalEdits
import com.litara.core.litara.shelvesToAddTo
import com.litara.feature.litara.BookOpen
import com.litara.feature.litara.LitaraRepository
import com.litara.feature.litara.openability
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TitleUi(
    val loading: Boolean = true,
    val busy: Boolean = false,
    val error: String? = null,
    val note: String? = null,
    val title: LTitleSummary? = null,
    val editions: List<LEdition> = emptyList(),
    val recordings: List<LRecordingLink> = emptyList(),
    val personal: LTitlePersonal? = null,
    /** The shelves to choose from while the picker is open; null while it is closed. */
    val picker: List<LShelf>? = null,
)

/** One title: its books and audiobooks, the caller's private rating, and adding it to a shelf. */
@HiltViewModel
class TitleViewModel @Inject constructor(app: Application, repo: LitaraRepository, saved: SavedStateHandle) : BrowseViewModel(app, repo) {
    private val titleId: String = saved.get<String>("titleId").orEmpty()
    private val _ui = MutableStateFlow(TitleUi())
    val ui: StateFlow<TitleUi> = _ui.asStateFlow()
    private val edits = PersonalEdits()

    private fun run(block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(error = message(e)) }
            } finally {
                _ui.update { it.copy(loading = false, busy = false) }
            }
        }
    }

    fun load() {
        _ui.update { it.copy(error = null) }
        run {
            val title = client().title(titleId).title
            _ui.update { it.copy(title = title) }
            val editions = if (title.editionCount > 0) client().listAllEditions(titleId) else emptyList()
            val recordings = if (title.recordingCount > 0) client().titleRecordings(titleId).items else emptyList()
            _ui.update { it.copy(editions = editions, recordings = recordings) }
            _ui.update { it.copy(personal = client().titlePersonal(titleId)) }
        }
    }

    fun rate(halves: Int?) {
        val current = _ui.value.personal ?: return
        if (_ui.value.busy || halves == current.data.ratingHalves) return
        _ui.update { it.copy(busy = true, error = null, note = null) }
        run {
            try {
                val saved = edits.rate(client(), current, halves)
                _ui.update { it.copy(personal = saved) }
            } catch (_: ChangedElsewhereException) {
                val fresh = client().titlePersonal(titleId)
                _ui.update { it.copy(personal = fresh, note = text(R.string.title_rating_changed)) }
            }
        }
    }

    fun openPicker() {
        _ui.update { it.copy(error = null, note = null) }
        run {
            val shelves = client().shelvesToAddTo()
            _ui.update { it.copy(picker = shelves) }
        }
    }

    fun closePicker() = _ui.update { it.copy(picker = null) }

    fun addTo(shelf: LShelf) {
        if (_ui.value.busy) return
        _ui.update { it.copy(busy = true, picker = null) }
        run {
            try {
                edits.addToShelf(client(), shelf, titleId)
                _ui.update { it.copy(note = text(R.string.shelf_added, shelf.data?.name.orEmpty())) }
            } catch (_: ChangedElsewhereException) {
                _ui.update { it.copy(note = text(R.string.shelf_changed)) }
            }
        }
    }
}

private fun halfText(halves: Int) = if (halves % 2 == 0) "${halves / 2}" else "${halves / 2}.5"

/** Five stars to tap for whole ratings, with half-star steps either side. */
@Composable
private fun Rating(halves: Int?, enabled: Boolean, onRate: (Int?) -> Unit) {
    val spoken = halves?.let { stringResource(R.string.title_rating_value, halfText(it)) } ?: stringResource(R.string.title_unrated)
    Column(Modifier.testTag(BrowseTags.RATING)) {
        Text(stringResource(R.string.title_your_rating) + " · " + spoken, style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.semantics { contentDescription = spoken })
        Row(verticalAlignment = Alignment.CenterVertically) {
            (1..5).forEach { n ->
                val filled = (halves ?: 0) - (n - 1) * 2
                IconButton({ onRate(n * 2) }, Modifier.testTag(BrowseTags.star(n)), enabled = enabled) {
                    Icon(
                        if (filled >= 2) Icons.Filled.Star else if (filled == 1) Icons.AutoMirrored.Filled.StarHalf else Icons.Outlined.StarOutline,
                        contentDescription = stringResource(R.string.title_rate_stars, n),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            val lower = stringResource(R.string.title_rating_lower)
            val raise = stringResource(R.string.title_rating_raise)
            TextButton({ onRate(halves!! - 1) }, Modifier.semantics { contentDescription = lower }, enabled = enabled && halves != null && halves > 1) { Text("− ½") }
            TextButton({ onRate((halves ?: 0) + 1) }, Modifier.semantics { contentDescription = raise }, enabled = enabled && (halves ?: 0) < 10) { Text("+ ½") }
            if (halves != null) TextButton({ onRate(null) }, enabled = enabled) { Text(stringResource(R.string.title_rating_clear)) }
        }
    }
}

@Composable
fun TitleScreen(nav: BrowseNav, onRead: (editionId: String, format: String) -> Unit, onListen: (recordingId: String) -> Unit, vm: TitleViewModel = hiltViewModel()) {
    LaunchedEffect(Unit) { vm.load() }
    val ui by vm.ui.collectAsStateWithLifecycle()
    var more by rememberSaveable { mutableStateOf(false) }
    val t = ui.title
    BrowsePage(t?.title.orEmpty(), nav.back) {
        if (ui.loading || ui.busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        ui.error?.let { e -> item { ErrorLine(e, vm::load) } }
        ui.note?.let { n -> item { Text(n, color = MaterialTheme.colorScheme.primary, modifier = Modifier.testTag(BrowseTags.NOTE).clickable { more = !more }) } }
        if (t == null) return@BrowsePage
        item {
            Row(verticalAlignment = Alignment.Top) {
                BookCover(vm.coverUrl(t.id, audio = usesAudioCover(t.editionCount, t.recordingCount)), vm.covers, stringResource(R.string.browse_cover_of, t.title), width = 112)
                Column(Modifier.padding(start = 8.dp)) {
                    t.authors.forEach { a -> TextButton({ nav.author(a) }) { Text(a) } }
                    t.series.forEach { s -> TextButton({ nav.series(s) }) { Text(s, style = MaterialTheme.typography.bodyMedium) } }
                }
            }
        }
        if (t.physicalCopyCount > 0) item {
            // This app shows that a paper copy exists; where it is and reading it on paper are in the web app (ADR-0116).
            Text(pluralStringResource(R.plurals.title_paper_copies, t.physicalCopyCount.toInt(), t.physicalCopyCount.toInt()), Modifier.testTag(BrowseTags.PAPER))
        }
        ui.personal?.let { p -> item { Rating(p.data.ratingHalves, !ui.busy, vm::rate) } }
        item { OutlinedButton({ vm.openPicker() }, Modifier.testTag(BrowseTags.ADD_TO_SHELF), enabled = !ui.busy) { Text(stringResource(R.string.shelf_add_to)) } }
        if (ui.editions.isNotEmpty()) item { Text(stringResource(R.string.title_editions), style = MaterialTheme.typography.titleMedium) }
        items(ui.editions, key = { "edition-" + it.id }) { e ->
            val open = openability(e)
            EntryRow(
                e.label.ifBlank { e.file.format.uppercase() },
                listOf(listOfNotNull(e.file.format.uppercase(), e.language, stringResource(R.string.title_finished).takeIf { e.completion.finished }).joinToString(" · "),
                    (open as? BookOpen.No)?.let { stringResource(R.string.title_cannot_open, it.reason) }.orEmpty()),
                null,
                trailing = { Button({ onRead(e.id, e.file.format) }, enabled = open is BookOpen.Yes) { Text(stringResource(R.string.title_read)) } },
            )
        }
        if (ui.recordings.isNotEmpty()) item { Text(stringResource(R.string.title_audiobooks), style = MaterialTheme.typography.titleMedium) }
        items(ui.recordings, key = { "recording-" + it.id }) { r ->
            EntryRow(r.label.ifBlank { t.title }, emptyList(), null, trailing = {
                Button({ onListen(r.id) }, Modifier.testTag(BrowseTags.title(r.id))) { Text(stringResource(R.string.title_listen)) }
            })
        }
    }
    ui.picker?.let { shelves ->
        AlertDialog(
            onDismissRequest = vm::closePicker,
            title = { Text(stringResource(R.string.shelf_add_to)) },
            text = {
                if (shelves.isEmpty()) Text(stringResource(R.string.shelf_none_manual))
                else androidx.compose.foundation.lazy.LazyColumn {
                    items(shelves, key = { it.id }) { s ->
                        val name = s.data?.name.orEmpty()
                        Text(name, Modifier.fillMaxWidth().clickable { vm.addTo(s) }.padding(vertical = 12.dp).testTag(BrowseTags.shelfPick(name)))
                    }
                }
            },
            confirmButton = { TextButton(vm::closePicker) { Text(stringResource(R.string.browse_cancel)) } },
        )
    }
}
