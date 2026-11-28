package com.litara.feature.reader.pdf

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CropFree
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.litara.R
import com.litara.core.litara.HighlightColors
import com.litara.feature.reader.HighlightToolbar
import com.litara.feature.reader.NoteDialog
import com.litara.feature.reader.OpenParams
import com.litara.feature.reader.ReaderController
import com.litara.feature.reader.ReaderSettings
import com.litara.feature.reader.ReaderWebView
import com.litara.feature.reader.SharedEvent

private val BAR = Color(0xFF20242A)

/** What the note dialog will write to: a new selection, or an existing mark. */
private sealed interface NoteTarget {
    data class New(val selection: SharedEvent.PdfPick, val quote: String) : NoteTarget
    data class Existing(val id: String, val text: String) : NoteTarget
}

/**
 * Highlight mode (ADR-0113): one page of the PDF drawn by the web reader's own engine, so a selection or an area box gets
 * the same rectangles as on the web. The system reader stays underneath with its place, search and settings.
 */
@Composable
fun PdfHighlightScreen(ui: PdfUiState, page: Int, vm: PdfHost, onDone: () -> Unit) {
    val context = LocalContext.current
    val controller = remember { ReaderController() }
    var ready by remember { mutableStateOf(false) }
    var loaded by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var area by rememberSaveable { mutableStateOf(false) }
    var selection by remember { mutableStateOf<SharedEvent.Selection?>(null) }
    var tapped by remember { mutableStateOf<String?>(null) }
    var noteTarget by remember { mutableStateOf<NoteTarget?>(null) }

    BackHandler(onBack = onDone)
    DisposableEffect(controller) {
        controller.sharedListener = { event ->
            when (event) {
                SharedEvent.Ready -> ready = true
                is SharedEvent.Loaded -> loaded = true
                is SharedEvent.Selection -> if (event.pdf != null) { selection = event; tapped = null }
                SharedEvent.SelectionCleared -> selection = null
                is SharedEvent.AnnotationClick -> { tapped = event.id; selection = null }
                is SharedEvent.Failure -> failed = true
                else -> Unit
            }
        }
        onDispose { controller.sharedListener = null }
    }
    LaunchedEffect(ready) {
        val ref = ui.ref
        if (ready && ref != null) {
            controller.openShared(OpenParams(ref, "pdf", null, null, ReaderSettings(isDark = false)), context, "pdf", pageIndex = page)
        }
    }
    LaunchedEffect(loaded, area) {
        if (loaded) {
            controller.clearSelection()
            selection = null
            controller.setPdfAreaMode(area)
        }
    }
    LaunchedEffect(loaded, ui.marks) { if (loaded) controller.setPdfAnnotations(PdfMarks.paint(ui.marks)) }

    fun finishSelection() {
        controller.clearSelection()
        selection = null
    }

    // Takes every touch, so none reaches the reader underneath.
    Column(Modifier.fillMaxSize().background(BAR).pointerInput(Unit) { detectTapGestures { } }) {
        Column(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDone) {
                    Icon(Icons.Filled.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(ButtonDefaults.IconSize))
                    Spacer(Modifier.width(ButtonDefaults.IconSpacing))
                    Text(stringResource(R.string.pdf_highlight_done), color = Color.White)
                }
                Text(stringResource(R.string.pdf_highlight_title, page + 1), color = Color.White, textAlign = TextAlign.End,
                    modifier = Modifier.weight(1f).padding(end = 8.dp))
            }
            Row(Modifier.padding(start = 4.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ModeChip(!area, Icons.Filled.TextFields, stringResource(R.string.pdf_highlight_text)) { area = false }
                ModeChip(area, Icons.Filled.CropFree, stringResource(R.string.pdf_highlight_area)) { area = true }
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (!failed) {
                ReaderWebView(controller = controller, shared = true, modifier = Modifier.fillMaxSize(), onRendererGone = { failed = true })
            }
            if (failed) {
                Text(stringResource(R.string.pdf_highlight_failed), color = Color.White, textAlign = TextAlign.Center,
                    modifier = Modifier.align(Alignment.Center).padding(24.dp))
            } else if (!loaded) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            }
            val picked = selection
            val mark = ui.marks.firstOrNull { it.id == tapped }
            val bar = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 16.dp)
            when {
                picked?.pdf != null -> HighlightToolbar(
                    currentColor = null,
                    onColor = { vm.addHighlight(picked.pdf, picked.text, it, null); finishSelection() },
                    onNote = { noteTarget = NoteTarget.New(picked.pdf, picked.text) },
                    onDelete = null,
                    modifier = bar,
                )
                mark != null -> HighlightToolbar(
                    currentColor = HighlightColors.shade(mark.color),
                    onColor = { vm.setMarkColor(mark.id, it); tapped = null },
                    onNote = { noteTarget = NoteTarget.Existing(mark.id, mark.text) },
                    onDelete = { vm.deleteMark(mark.id); tapped = null },
                    modifier = bar,
                )
                loaded && !failed -> Text(
                    stringResource(if (area) R.string.pdf_highlight_hint_area else R.string.pdf_highlight_hint_text),
                    color = Color.White,
                    textAlign = TextAlign.Center,
                    modifier = bar.padding(horizontal = 16.dp).background(Color(0xCC0A0A0A)).padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
        }
    }

    noteTarget?.let { target ->
        NoteDialog(
            initial = (target as? NoteTarget.Existing)?.text.orEmpty(),
            onSave = { text ->
                when (target) {
                    is NoteTarget.New -> if (text.isNotBlank()) { vm.addHighlight(target.selection, target.quote, null, text); finishSelection() }
                    is NoteTarget.Existing -> { vm.editNote(target.id, text); tapped = null }
                }
                noteTarget = null
            },
            onDismiss = { noteTarget = null },
        )
    }
}

@Composable
private fun ModeChip(selected: Boolean, icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        leadingIcon = { Icon(icon, contentDescription = null, modifier = Modifier.size(FilterChipDefaults.IconSize)) },
        colors = FilterChipDefaults.filterChipColors(labelColor = Color.White, iconColor = Color.White),
    )
}
