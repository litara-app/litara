package com.litara.feature.reader.pdf

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.NoteAdd
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BorderColor
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.litara.R

/** The PDF's notes and bookmarks, with highlights made on the web listed by page. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PdfNotesSheet(
    marks: List<PdfMark>,
    currentPage: Int,
    webMarksLoaded: Boolean,
    onOpen: (Int) -> Unit,
    onAdd: (page: Int, text: String) -> Unit,
    onEdit: (id: String, text: String) -> Unit,
    onDelete: (id: String) -> Unit,
    onDismiss: () -> Unit,
) {
    // The page is fixed when the dialog opens, so a note stays on the page the person was looking at.
    var addingPage by rememberSaveable { mutableStateOf<Int?>(null) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.pdf_notes_title), style = MaterialTheme.typography.titleMedium)
            Button(onClick = { addingPage = currentPage }) {
                Icon(Icons.AutoMirrored.Filled.NoteAdd, contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
                Spacer(Modifier.width(ButtonDefaults.IconSpacing))
                Text(stringResource(R.string.pdf_note_add, currentPage + 1))
            }
            Text(stringResource(R.string.pdf_notes_highlight_hint), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (!webMarksLoaded) {
                Text(stringResource(R.string.pdf_notes_web_unavailable), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (marks.isEmpty()) {
                Text(stringResource(R.string.pdf_notes_empty), modifier = Modifier.padding(vertical = 16.dp))
            }
        }
        LazyColumn(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
            items(marks, key = { it.id }) { mark ->
                MarkRow(mark, onOpen = { onOpen(mark.page) }, onEdit = { editing = mark.id }, onDelete = { onDelete(mark.id) })
                HorizontalDivider()
            }
        }
    }
    addingPage?.let { page ->
        NoteDialog(
            title = stringResource(R.string.pdf_note_add, page + 1),
            initial = "",
            onSave = { onAdd(page, it); addingPage = null },
            onDismiss = { addingPage = null },
        )
    }
    marks.firstOrNull { it.id == editing }?.let { mark ->
        NoteDialog(
            title = stringResource(R.string.pdf_note_edit, mark.page + 1),
            initial = mark.text,
            onSave = { onEdit(mark.id, it); editing = null },
            onDismiss = { editing = null },
        )
    }
}

private fun iconFor(kind: PdfMark.Kind): ImageVector = when (kind) {
    PdfMark.Kind.HIGHLIGHT -> Icons.Filled.BorderColor
    PdfMark.Kind.NOTE -> Icons.AutoMirrored.Filled.Notes
    PdfMark.Kind.BOOKMARK -> Icons.Filled.Bookmark
}

@Composable
private fun MarkRow(mark: PdfMark, onOpen: () -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) {
    val kind = stringResource(
        when (mark.kind) {
            PdfMark.Kind.HIGHLIGHT -> R.string.pdf_mark_highlight
            PdfMark.Kind.NOTE -> R.string.pdf_mark_note
            PdfMark.Kind.BOOKMARK -> R.string.pdf_mark_bookmark
        },
    )
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(start = 16.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(iconFor(mark.kind), contentDescription = null)
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.pdf_mark_heading, kind, mark.page + 1), style = MaterialTheme.typography.labelLarge)
            if (mark.quote.isNotBlank()) {
                Text("“${mark.quote}”", style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
            if (mark.text.isNotBlank()) Text(mark.text, maxLines = 6, overflow = TextOverflow.Ellipsis)
            val status = when {
                mark.conflict -> R.string.pdf_mark_conflict
                mark.waiting -> R.string.pdf_mark_waiting
                mark.readOnly -> R.string.pdf_mark_from_web
                else -> null
            }
            status?.let {
                Text(stringResource(it), style = MaterialTheme.typography.bodySmall,
                    color = if (mark.conflict) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (!mark.readOnly) {
            if (mark.kind == PdfMark.Kind.NOTE) {
                IconButton(onClick = onEdit) { Icon(Icons.Filled.Edit, contentDescription = stringResource(R.string.pdf_note_edit, mark.page + 1)) }
            }
            IconButton(onClick = onDelete) { Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.pdf_mark_delete, kind, mark.page + 1)) }
        }
    }
}

@Composable
private fun NoteDialog(title: String, initial: String, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(text, { text = it.take(4_000) }, label = { Text(stringResource(R.string.pdf_mark_note)) }, minLines = 3)
        },
        confirmButton = {
            TextButton(onClick = { onSave(text) }, enabled = text.isNotBlank()) {
                Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
                Spacer(Modifier.width(ButtonDefaults.IconSpacing))
                Text(stringResource(R.string.pdf_note_save))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Icon(Icons.Filled.Close, contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
                Spacer(Modifier.width(ButtonDefaults.IconSpacing))
                Text(stringResource(R.string.cancel))
            }
        },
    )
}
