package com.litara.feature.litara

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.LocalLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.dropUnlessResumed
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import coil.compose.AsyncImage
import com.litara.R
import com.litara.feature.player.MiniPlayer
import com.litara.feature.player.PlayerScreen
import com.litara.feature.player.PlayerViewModel
import com.litara.ui.LocalImageUrls

/** Test tags for the Litara shell. */
object ShellTags {
    const val TAB_LIBRARY = "shell-tab-library"
    const val TAB_DOWNLOADS = "shell-tab-downloads"
    const val TAB_ACCOUNT = "shell-tab-account"
    const val PLAY = "shell-play"
    const val DOWNLOAD = "shell-download"
    const val DELETE_DOWNLOAD = "shell-delete-download"
    const val SIGN_OUT = "shell-sign-out"
    const val DETAIL_TITLE = "shell-detail-title"
    const val EMPTY_DOWNLOADS = "shell-empty-downloads"
    fun recording(id: String) = "shell-rec-$id"
    fun download(id: String) = "shell-dl-$id"
}

private const val ROUTE_MAIN = "main"
private const val ROUTE_PLAYER = "player"

/**
 * The phone app for a signed-in Litara account: Library, Downloads and Account over recording detail.
 * Reading (ebooks, PDF, comics) is not part of this release's Litara server API and is not offered here.
 */
@Composable
fun LitaraShell(vm: LitaraShellViewModel = hiltViewModel()) {
    val nav = rememberNavController()
    val player: PlayerViewModel = hiltViewModel()
    LaunchedEffect(Unit) { player.restoreLastBook() }
    NavHost(nav, startDestination = ROUTE_MAIN) {
        composable(ROUTE_MAIN) {
            ShellMain(vm, onListen = { handle ->
                player.loadAndPlay(handle)
                nav.navigate(ROUTE_PLAYER)
            }, onOpenPlayer = { nav.navigate(ROUTE_PLAYER) })
        }
        composable(ROUTE_PLAYER) { PlayerScreen(onBack = dropUnlessResumed { nav.popBackStack() }) }
    }
}

@Composable
private fun ShellMain(vm: LitaraShellViewModel, onListen: (Int) -> Unit, onOpenPlayer: () -> Unit) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    BackHandler(enabled = ui.detail != null) { vm.closeDetail() }
    Scaffold(
        bottomBar = {
            Column {
                MiniPlayer(onOpenPlayer = onOpenPlayer)
                NavigationBar {
                    NavigationBarItem(tab == 0, { tab = 0; vm.closeDetail() }, { Icon(Icons.Outlined.LocalLibrary, null) },
                        label = { Text(stringResource(R.string.litara_tab_library)) }, modifier = Modifier.testTag(ShellTags.TAB_LIBRARY))
                    NavigationBarItem(tab == 1, { tab = 1; vm.closeDetail() }, { Icon(Icons.Outlined.Download, null) },
                        label = { Text(stringResource(R.string.litara_tab_downloads)) }, modifier = Modifier.testTag(ShellTags.TAB_DOWNLOADS))
                    NavigationBarItem(tab == 2, { tab = 2; vm.closeDetail() }, { Icon(Icons.Outlined.AccountCircle, null) },
                        label = { Text(stringResource(R.string.litara_tab_account)) }, modifier = Modifier.testTag(ShellTags.TAB_ACCOUNT))
                }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag(LitaraTags.ERROR).clickable { vm.clearError() }) }
            if (ui.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            when {
                ui.detail != null -> ShellDetail(vm, ui, onListen)
                tab == 0 -> ShellLibrary(vm, ui)
                tab == 1 -> ShellDownloads(vm, ui)
                else -> ShellAccount(vm, ui)
            }
        }
    }
    ui.prompt?.let { p -> ShellConflict(vm, p) }
}

@Composable
private fun Cover(handle: Int, title: String, size: Int) {
    val url = LocalImageUrls.current.thumbnail(handle)
    AsyncImage(
        model = url.takeIf { it.isNotEmpty() }, contentDescription = title, contentScale = ContentScale.Crop,
        modifier = Modifier.size(width = size.dp, height = (size * 3 / 2).dp).clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
    )
}

@Composable
private fun ShellLibrary(vm: LitaraShellViewModel, ui: ShellUi) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(R.string.litara_tab_library) + (if (ui.fromCache) stringResource(R.string.litara_offline_list) else ""),
            style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        TextButton({ vm.refresh() }) { Text(stringResource(R.string.litara_refresh)) }
    }
    if (ui.library.isEmpty() && !ui.busy) {
        Text(stringResource(R.string.litara_no_recordings), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    LazyColumn {
        items(ui.library, key = { it.summary.id }) { row ->
            val r = row.summary
            Row(Modifier.fillMaxWidth().clickable { vm.open(row) }.padding(vertical = 8.dp).testTag(ShellTags.recording(r.id)),
                verticalAlignment = Alignment.CenterVertically) {
                Cover(row.handle, r.title, 40)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(r.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(r.authors.joinToString(", "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(listOfNotNull(r.durationMs?.let { stringResource(R.string.litara_duration_min, (it / 60000).toInt()) },
                        r.readiness.takeIf { it != "ready" }, stringResource(R.string.litara_downloaded).takeIf { row.downloaded }).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            HorizontalDivider()
        }
    }
}

@Composable
private fun ShellDownloads(vm: LitaraShellViewModel, ui: ShellUi) {
    Text(stringResource(R.string.litara_tab_downloads), style = MaterialTheme.typography.titleLarge)
    if (ui.downloads.isEmpty()) {
        Box(Modifier.fillMaxSize().testTag(ShellTags.EMPTY_DOWNLOADS), contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.litara_no_downloads), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    LazyColumn {
        items(ui.downloads, key = { it.id }) { d ->
            Row(Modifier.fillMaxWidth().clickable { vm.openDownload(d) }.padding(vertical = 8.dp).testTag(ShellTags.download(d.id)),
                verticalAlignment = Alignment.CenterVertically) {
                Cover(d.handle, d.title, 40)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(d.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(listOf(d.authors.joinToString(", "), stringResource(R.string.litara_size_mb, (d.sizeBytes / 1_048_576).toInt())).filter { it.isNotBlank() }.joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (d.locked) Text(stringResource(R.string.litara_locked), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }
                IconButton({ vm.deleteDownload(d.id) }, Modifier.testTag(ShellTags.DELETE_DOWNLOAD)) {
                    Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.litara_delete_download), tint = MaterialTheme.colorScheme.error)
                }
            }
            HorizontalDivider()
        }
    }
}

@Composable
private fun ShellAccount(vm: LitaraShellViewModel, ui: ShellUi) {
    Text(stringResource(R.string.litara_tab_account), style = MaterialTheme.typography.titleLarge)
    Text(stringResource(R.string.litara_signed_in_as, ui.account))
    Text(stringResource(R.string.litara_account_server, ui.server), style = MaterialTheme.typography.bodySmall)
    Text(stringResource(R.string.litara_account_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(stringResource(R.string.litara_audio_only), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedButton({ vm.signOut() }, Modifier.testTag(ShellTags.SIGN_OUT)) { Text(stringResource(R.string.litara_sign_out)) }
}

@Composable
private fun ShellDetail(vm: LitaraShellViewModel, ui: ShellUi, onListen: (Int) -> Unit) {
    val view = ui.detail!!
    val snap = view.snapshot
    TextButton({ vm.closeDetail() }) { Text(stringResource(R.string.litara_back)) }
    Row(verticalAlignment = Alignment.Top) {
        Cover(ui.detailHandle, snap.title, 96)
        Column(Modifier.padding(start = 12.dp)) {
            Text(snap.title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.testTag(ShellTags.DETAIL_TITLE))
            Text(stringResource(R.string.litara_narrated_by, snap.authors.joinToString(), snap.narrators.joinToString()), style = MaterialTheme.typography.bodyMedium)
            if (ui.finished) Text(stringResource(R.string.litara_finished), color = MaterialTheme.colorScheme.primary, modifier = Modifier.testTag(LitaraTags.FINISHED))
        }
    }
    if (view.offline) Text(stringResource(R.string.litara_offline_copy))
    if (view.locked) Text(stringResource(R.string.litara_locked), color = MaterialTheme.colorScheme.error)
    if (snap.readiness != "ready") Text(stringResource(R.string.litara_incomplete, snap.issues.joinToString { it.code }), color = MaterialTheme.colorScheme.error)
    if (view.updateAvailable) Text(stringResource(R.string.litara_update_available))
    ui.downloading?.let { (d, t) -> Text(stringResource(R.string.litara_downloading, d + 1, t)) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button({ onListen(ui.detailHandle) }, enabled = snap.capabilities.play && !view.locked && ui.prompt == null, modifier = Modifier.testTag(ShellTags.PLAY)) {
            Text(stringResource(R.string.litara_play))
        }
        Button({ vm.download() }, enabled = snap.capabilities.download && ui.downloading == null && !view.offline && !view.locked && (view.downloaded == null || view.updateAvailable),
            modifier = Modifier.testTag(ShellTags.DOWNLOAD)) {
            Text(stringResource(if (view.downloaded == null) R.string.litara_download else if (view.updateAvailable) R.string.litara_download_update else R.string.litara_downloaded))
        }
        OutlinedButton({ vm.setFinished(!ui.finished) }) { Text(stringResource(if (ui.finished) R.string.litara_mark_unfinished else R.string.litara_mark_finished)) }
    }
    if (view.downloaded != null && !view.locked) {
        TextButton({ vm.deleteDownload(snap.id) }, Modifier.testTag(ShellTags.DELETE_DOWNLOAD)) { Text(stringResource(R.string.litara_delete_download)) }
    }
    HorizontalDivider()
    Text(stringResource(R.string.litara_chapters), style = MaterialTheme.typography.titleMedium)
    LazyColumn {
        items(snap.chapters, key = { it.id }) { c ->
            Text(c.label + (if (c.generated) stringResource(R.string.litara_file_marker) else "") + " · ${(c.recordingStartMs ?: 0) / 1000}s",
                Modifier.fillMaxWidth().padding(vertical = 6.dp).testTag(LitaraTags.chapter(c.label)))
        }
    }
}

@Composable
private fun ShellConflict(vm: LitaraShellViewModel, prompt: ConflictPrompt) {
    val conflict = prompt.conflicts.first()
    AlertDialog(
        onDismissRequest = {},
        title = { Text(stringResource(R.string.litara_which_position)) },
        text = { Text(stringResource(R.string.litara_conflict_body, prompt.serverLabel, prompt.labels[conflict.id].orEmpty())) },
        confirmButton = { TextButton({ vm.resolve(conflict, "use_candidate") }) { Text(stringResource(R.string.litara_use_other)) } },
        dismissButton = { TextButton({ vm.resolve(conflict, "keep_server") }) { Text(stringResource(R.string.litara_keep_server)) } },
    )
}
