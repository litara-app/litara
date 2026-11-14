package com.litara.feature.litara

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.litara.R
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/** Test tags used by the instrumentation flow. */
object LitaraTags {
    const val URL = "litara-url"
    const val INSECURE = "litara-insecure"
    const val USER = "litara-user"
    const val PASSWORD = "litara-password"
    const val SIGN_IN = "litara-sign-in"
    const val DOWNLOAD = "litara-download"
    const val PLAY = "litara-play"
    const val STATUS = "litara-status"
    const val POSITION = "litara-position"
    const val FINISHED = "litara-finished"
    const val ERROR = "litara-error"
    fun recording(id: String) = "litara-rec-$id"
    fun chapter(label: String) = "litara-chapter-$label"
}

@Composable
fun LitaraScreen(vm: LitaraViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.litara_title), style = MaterialTheme.typography.titleLarge)
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag(LitaraTags.ERROR).clickable { vm.clearError() }) }
        if (ui.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        when {
            !ui.signedIn -> SignIn(vm)
            ui.detail == null -> Library(vm, ui)
            else -> Detail(vm, ui)
        }
    }
    ui.prompt?.let { prompt -> ConflictPromptHost(prompt, vm::resolve, vm::resolveExplicit, vm::resolveCompletion) }
}

/** The in-app sign-in step for a Litara server; success flips the app gate to the Litara shell. */
@Composable
fun LitaraSignInRoute(onBack: () -> Unit, vm: LitaraViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.litara_title), style = MaterialTheme.typography.titleLarge)
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag(LitaraTags.ERROR).clickable { vm.clearError() }) }
        if (ui.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        SignIn(vm)
        TextButton(onBack) { Text(stringResource(R.string.back)) }
    }
}

@Composable
private fun SignIn(vm: LitaraViewModel) {
    var url by rememberSaveable { mutableStateOf("") }
    var insecure by rememberSaveable { mutableStateOf(false) }
    var user by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    OutlinedTextField(url, { url = it }, label = { Text(stringResource(R.string.litara_url_label)) }, singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag(LitaraTags.URL))
    Row {
        Checkbox(insecure, { insecure = it }, modifier = Modifier.testTag(LitaraTags.INSECURE))
        Text(stringResource(R.string.litara_insecure), modifier = Modifier.padding(top = 12.dp))
    }
    OutlinedTextField(user, { user = it }, label = { Text(stringResource(R.string.litara_username)) }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag(LitaraTags.USER))
    OutlinedTextField(password, { password = it }, label = { Text(stringResource(R.string.litara_password)) }, singleLine = true,
        visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().testTag(LitaraTags.PASSWORD))
    Button({ vm.signIn(url, insecure, user, password) }, Modifier.testTag(LitaraTags.SIGN_IN)) { Text(stringResource(R.string.litara_sign_in)) }
}

@Composable
private fun Library(vm: LitaraViewModel, ui: LitaraUi) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.litara_signed_in_as, ui.account.orEmpty()) + (if (ui.listFromCache) stringResource(R.string.litara_offline_list) else ""), Modifier.padding(top = 12.dp))
        TextButton({ vm.refresh() }) { Text(stringResource(R.string.litara_refresh)) }
        TextButton({ vm.signOut() }) { Text(stringResource(R.string.litara_sign_out)) }
    }
    LazyColumn {
        items(ui.recordings, key = { it.id }) { r ->
            Column(Modifier.fillMaxWidth().clickable { vm.open(r) }.padding(vertical = 10.dp).testTag(LitaraTags.recording(r.id))) {
                Text(r.title, style = MaterialTheme.typography.titleMedium)
                Text("${r.readiness}${r.durationMs?.let { " · ${it / 60000} min" } ?: ""}", style = MaterialTheme.typography.bodySmall)
            }
            HorizontalDivider()
        }
    }
}

@Composable
private fun Detail(vm: LitaraViewModel, ui: LitaraUi) {
    val view = ui.detail!!
    val snap = view.snapshot
    TextButton({ vm.stopPlayback(); vm.refresh(); vm.closeDetail() }) { Text(stringResource(R.string.litara_back)) }
    Text(snap.title, style = MaterialTheme.typography.titleLarge)
    Text(stringResource(R.string.litara_narrated_by, snap.authors.joinToString(), snap.narrators.joinToString()))
    if (view.offline) Text(stringResource(R.string.litara_offline_copy))
    if (view.locked) Text(stringResource(R.string.litara_locked), color = MaterialTheme.colorScheme.error)
    if (snap.readiness != "ready") Text(stringResource(R.string.litara_incomplete, snap.issues.joinToString { it.code }), color = MaterialTheme.colorScheme.error)
    if (view.updateAvailable) Text(stringResource(R.string.litara_update_available))
    ui.downloading?.let { (d, t) -> Text(stringResource(R.string.litara_downloading, d + 1, t)) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button({ vm.download() }, enabled = snap.capabilities.download && ui.downloading == null && !view.offline && !view.locked,
            modifier = Modifier.testTag(LitaraTags.DOWNLOAD)) {
            Text(stringResource(if (view.downloaded == null) R.string.litara_download else if (view.updateAvailable) R.string.litara_download_update else R.string.litara_downloaded))
        }
        Button({ vm.toggle() }, enabled = snap.capabilities.play && !view.locked, modifier = Modifier.testTag(LitaraTags.PLAY)) {
            Text(stringResource(if (ui.playing) R.string.litara_pause else R.string.litara_play))
        }
    }
    Text("file ${ui.fileIndex + 1} @ ${ui.offsetMs / 1000}s", Modifier.testTag(LitaraTags.POSITION))
    Text(ui.statusLine, Modifier.testTag(LitaraTags.STATUS))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (ui.finished) Text(stringResource(R.string.litara_finished), Modifier.testTag(LitaraTags.FINISHED).padding(top = 12.dp))
        OutlinedButton({ vm.setFinished(!ui.finished) }) { Text(stringResource(if (ui.finished) R.string.litara_mark_unfinished else R.string.litara_mark_finished)) }
    }
    HorizontalDivider()
    LazyColumn {
        items(snap.chapters, key = { it.id }) { c ->
            Text(c.label + (if (c.generated) stringResource(R.string.litara_file_marker) else "") + " · ${(c.recordingStartMs ?: 0) / 1000}s",
                Modifier.fillMaxWidth().clickable { vm.seekToChapter(c) }.padding(vertical = 8.dp).testTag(LitaraTags.chapter(c.label)))
        }
    }
}

