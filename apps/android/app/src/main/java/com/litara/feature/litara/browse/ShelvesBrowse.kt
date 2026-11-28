package com.litara.feature.litara.browse

import android.app.Application
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.litara.core.litara.usesAudioCover
import com.litara.core.litara.ChangedElsewhereException
import com.litara.core.litara.LShelf
import com.litara.core.litara.LTitleSummary
import com.litara.core.litara.PageResult
import com.litara.core.litara.PagedList
import com.litara.core.litara.PagedState
import com.litara.core.litara.PersonalEdits
import com.litara.feature.litara.LitaraRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ShelvesViewModel @Inject constructor(app: Application, repo: LitaraRepository) : BrowseViewModel(app, repo) {
    private val _list = MutableStateFlow(PagedState<LShelf>())
    val list: StateFlow<PagedState<LShelf>> = _list.asStateFlow()
    private val paged = PagedList<LShelf>({ it.id }) { _list.value = it }
    private val edits = PersonalEdits()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /** The shelves already shown stay up while they are read again, so the list keeps its place. */
    fun reload() {
        viewModelScope.launch { paged.refresh { n -> client().shelves(n).let { PageResult(it.items, it.total) } } }
    }

    fun loadMore() { viewModelScope.launch { paged.loadMore() } }

    fun create(name: String, shared: Boolean, onCreated: (String) -> Unit) {
        _error.value = null
        viewModelScope.launch {
            try {
                onCreated(edits.createShelf(client(), name, shared).id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _error.value = message(e)
            }
        }
    }
}

@Composable
private fun shelfLine(s: LShelf): String {
    val data = s.data
    return listOfNotNull(
        pluralStringResource(R.plurals.browse_book_count, s.visibleTitleCount.toInt(), s.visibleTitleCount.toInt()),
        data?.let { stringResource(if (it.kind == "smart") R.string.shelf_smart else R.string.shelf_manual) },
        data?.let { stringResource(if (it.visibility == "shared") R.string.shelf_shared else R.string.shelf_private) },
        stringResource(R.string.shelf_not_yours).takeIf { !s.canEdit },
    ).joinToString(" · ")
}

@Composable
private fun NameDialog(title: String, start: String, confirm: String, askShared: Boolean, onDismiss: () -> Unit, onConfirm: (String, Boolean) -> Unit) {
    var name by remember { mutableStateOf(start) }
    var shared by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                OutlinedTextField(name, { name = it.take(256) }, label = { Text(stringResource(R.string.shelf_name)) }, singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag(BrowseTags.SHELF_NAME))
                if (askShared) Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(shared, { shared = it })
                    Text(stringResource(R.string.shelf_share))
                }
            }
        },
        confirmButton = { TextButton({ onConfirm(name, shared) }, Modifier.testTag(BrowseTags.SHELF_CONFIRM), enabled = name.isNotBlank()) { Text(confirm) } },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.browse_cancel)) } },
    )
}

@Composable
fun ShelvesSection(nav: BrowseNav, vm: ShelvesViewModel = hiltViewModel()) {
    // Reloaded each time the list comes back, so a rename, delete or new member shows.
    LaunchedEffect(Unit) { vm.reload() }
    val list by vm.list.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var creating by rememberSaveable { mutableStateOf(false) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton({ creating = true }, Modifier.testTag(BrowseTags.NEW_SHELF)) { Text(stringResource(R.string.shelf_new)) }
        TextButton({ vm.reload() }) { Text(stringResource(R.string.browse_refresh)) }
    }
    error?.let { ErrorLine(it, null) }
    LazyColumn(Modifier.fillMaxSize()) {
        items(list.items, key = { it.id }) { s ->
            val name = s.data?.name ?: return@items
            EntryRow(name, listOf(shelfLine(s)), { nav.shelf(s.id) }, Modifier.testTag(BrowseTags.shelf(name)))
        }
        pagedFooter(list, vm::message, { EmptyNote(stringResource(R.string.browse_none_yet)) }, vm::loadMore)
    }
    if (creating) NameDialog(stringResource(R.string.shelf_new), "", stringResource(R.string.shelf_create), askShared = true, { creating = false }) { name, shared ->
        creating = false
        vm.create(name, shared, nav.shelf)
    }
}

data class ShelfUi(val shelf: LShelf? = null, val loading: Boolean = true, val busy: Boolean = false, val error: String? = null, val note: String? = null, val deleted: Boolean = false)

@HiltViewModel
class ShelfViewModel @Inject constructor(app: Application, repo: LitaraRepository, saved: SavedStateHandle) : BrowseViewModel(app, repo) {
    private val shelfId: String = saved.get<String>("shelfId").orEmpty()
    private val _ui = MutableStateFlow(ShelfUi())
    val ui: StateFlow<ShelfUi> = _ui.asStateFlow()
    private val _titles = MutableStateFlow(PagedState<LTitleSummary>())
    val titles: StateFlow<PagedState<LTitleSummary>> = _titles.asStateFlow()
    private val paged = PagedList<LTitleSummary>({ it.id }) { _titles.value = it }
    private val edits = PersonalEdits()

    fun load() { viewModelScope.launch { refresh() } }

    private suspend fun refresh() {
        try {
            val shelf = client().shelf(shelfId)
            _ui.update { it.copy(shelf = shelf, loading = false, error = null, deleted = shelf.deleted || shelf.data == null) }
            // Every title, a page at a time, however long the shelf is.
            // Rows already shown stay up meanwhile, so coming back from a title keeps the place.
            if (!shelf.deleted) paged.refresh { n -> client().shelfTitles(shelfId, n).let { PageResult(it.items, it.total) } }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(loading = false, error = message(e)) }
        }
    }

    fun loadMore() { viewModelScope.launch { paged.loadMore() } }

    /** Runs one change, then re-reads the shelf whether or not it was applied, so the next try starts from the truth. */
    private fun change(done: () -> Unit = {}, block: suspend (LShelf) -> Unit) {
        val shelf = _ui.value.shelf ?: return
        if (_ui.value.busy) return
        _ui.update { it.copy(busy = true, error = null, note = null) }
        viewModelScope.launch {
            try {
                block(shelf)
                done()
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (_: ChangedElsewhereException) {
                refresh()
                _ui.update { it.copy(note = text(R.string.shelf_changed)) }
            } catch (e: Exception) {
                _ui.update { it.copy(error = message(e)) }
            } finally {
                _ui.update { it.copy(busy = false) }
            }
        }
    }

    fun rename(name: String) = change { edits.renameShelf(client(), it, name) }
    fun delete(onDeleted: () -> Unit) = change(onDeleted) { edits.deleteShelf(client(), it) }
    fun remove(titleId: String) = change { edits.removeFromShelf(client(), it, titleId) }
}

@Composable
fun ShelfScreen(nav: BrowseNav, vm: ShelfViewModel = hiltViewModel()) {
    LaunchedEffect(Unit) { vm.load() }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val titles by vm.titles.collectAsStateWithLifecycle()
    var renaming by rememberSaveable { mutableStateOf(false) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    val shelf = ui.shelf
    val data = shelf?.data
    val manualEdit = shelf?.manualAndEditable == true
    BrowsePage(data?.name.orEmpty(), nav.back) {
        if (ui.loading || ui.busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        ui.error?.let { e -> item { ErrorLine(e, vm::load) } }
        ui.note?.let { n -> item { Text(n, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag(BrowseTags.NOTE)) } }
        if (ui.deleted) item { EmptyNote(stringResource(R.string.shelf_deleted)) }
        if (shelf != null && data != null && !shelf.deleted) {
            item {
                Column {
                    Text(shelfLine(shelf), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (data.kind == "smart") Text(stringResource(R.string.shelf_smart_note), style = MaterialTheme.typography.bodySmall)
                    if (shelf.canEdit) Row {
                        TextButton({ renaming = true }, enabled = !ui.busy) { Text(stringResource(R.string.shelf_rename)) }
                        TextButton({ deleting = true }, Modifier.testTag(BrowseTags.SHELF_DELETE), enabled = !ui.busy) { Text(stringResource(R.string.shelf_delete)) }
                    }
                }
            }
            items(titles.items, key = { it.id }) { t ->
                EntryRow(
                    t.title, listOf(t.authors.joinToString(", "), if (t.physicalCopyCount > 0) stringResource(R.string.browse_on_paper) else ""),
                    { nav.title(t.id) }, Modifier.testTag(BrowseTags.title(t.id)),
                    leading = { BookCover(vm.coverUrl(t.id, audio = usesAudioCover(t.editionCount, t.recordingCount)), vm.covers, null) },
                    trailing = {
                        if (manualEdit) TextButton({ vm.remove(t.id) }, Modifier.testTag(BrowseTags.removeFromShelf(t.id)), enabled = !ui.busy) {
                            Text(stringResource(R.string.shelf_remove_title))
                        }
                    },
                )
            }
            pagedFooter(titles, vm::message, { EmptyNote(stringResource(R.string.browse_none_yet)) }, vm::loadMore)
        }
    }
    if (renaming && data != null) NameDialog(stringResource(R.string.shelf_rename), data.name, stringResource(R.string.shelf_save), askShared = false, { renaming = false }) { name, _ ->
        renaming = false
        vm.rename(name)
    }
    if (deleting && data != null) AlertDialog(
        onDismissRequest = { deleting = false },
        title = { Text(stringResource(R.string.shelf_delete_title)) },
        text = { Text(stringResource(R.string.shelf_delete_body, data.name)) },
        confirmButton = { TextButton({ deleting = false; vm.delete(nav.back) }, Modifier.testTag(BrowseTags.SHELF_CONFIRM)) { Text(stringResource(R.string.shelf_delete)) } },
        dismissButton = { TextButton({ deleting = false }) { Text(stringResource(R.string.browse_cancel)) } },
    )
}
