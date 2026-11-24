package com.litara.feature.reader.pdf

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.litara.R
import com.litara.feature.reader.OpenParams
import com.litara.feature.reader.ReaderController
import com.litara.feature.reader.ReaderEvent
import com.litara.feature.reader.ReaderSettings
import com.litara.feature.reader.ReaderWebView
import com.litara.feature.reader.SharedEvent

/**
 * PDF reading through the shared web engine (PDF.js in the frame, ADR-0093), behind `-Plitara.sharedReader`.
 *
 * Deliberately bare: the Kotlin chrome (toolbar, search, settings, ribbon) is separate work. It shows the page, turns it
 * from the screen edges, reports the page to the same [PdfHost] the native reader uses (so position saving is unchanged),
 * and hides the back/page bar with a tap in the middle. Text search and the native text layer are not available here.
 */
@Composable
fun SharedPdfReaderScreen(ui: PdfReaderViewModel.UiState, vm: PdfHost, onBack: () -> Unit) {
    val controller = remember { ReaderController() }
    val context = LocalContext.current
    var ready by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf<String?>(null) }
    var page by remember { mutableIntStateOf(ui.initialPage) }
    var total by remember { mutableIntStateOf(ui.pageCount) }
    var chrome by remember { mutableStateOf(true) }
    var rendererGone by remember { mutableStateOf(false) }

    LaunchedEffect(controller) {
        controller.sharedListener = { e ->
            when (e) {
                SharedEvent.Ready -> ready = true
                is SharedEvent.Relocate -> e.pageIndex?.let {
                    page = it
                    e.numPages?.let { n -> total = n }
                    vm.onPageChanged(it)
                }
                is SharedEvent.Failure -> failed = "${e.code}: ${e.detail}"
                else -> Unit
            }
        }
        controller.listener = { e ->
            if (e is ReaderEvent.Tap) when {
                e.x < 0.3 -> controller.prev()
                e.x > 0.7 -> controller.next()
                else -> chrome = !chrome
            }
        }
    }
    LaunchedEffect(ready) {
        val ref = ui.ref
        if (ready && ref != null) {
            controller.openShared(OpenParams(ref, "pdf", null, null, ReaderSettings()), context, "pdf", pageIndex = ui.initialPage)
        }
    }

    Box(Modifier.fillMaxSize().background(Color(0xFF20242A))) {
        if (!rendererGone) {
            ReaderWebView(controller = controller, shared = true, modifier = Modifier.fillMaxSize(), onRendererGone = { rendererGone = true })
        }
        if (chrome) {
            Row(
                Modifier.fillMaxWidth().statusBarsPadding().background(Color(0xCC20242A)).padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back), tint = Color.White) }
                Text(
                    failed ?: ui.title.orEmpty().ifEmpty { "PDF" },
                    color = Color.White,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                )
                if (total > 0) Text("${page + 1} / $total", color = Color.White, modifier = Modifier.padding(end = 16.dp))
            }
        }
        if (rendererGone) Text(stringResource(R.string.reader_err_open_book), color = Color.White, modifier = Modifier.align(Alignment.Center).padding(24.dp))
    }
}
