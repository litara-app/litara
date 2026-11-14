package com.litara.feature.litara

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.litara.R
import com.litara.core.litara.LConflict
import com.litara.core.litara.LFile

object ConflictTags {
    const val KEEP_SERVER = "conflict_keep_server"
    const val USE_OTHER = "conflict_use_other"
    const val CHOOSE = "conflict_choose"
    const val EXPLICIT_CONFIRM = "conflict_explicit_confirm"
    const val EXPLICIT_SECONDS = "conflict_explicit_seconds"
    const val COMPLETION_KEEP = "completion_keep_server"
    const val COMPLETION_USE = "completion_use_other"
    const val COMPLETION_FINISHED = "completion_set_finished"
    const val COMPLETION_UNFINISHED = "completion_set_unfinished"
    fun file(index: Int) = "conflict_file_$index"
}

/**
 * Shows the first unresolved conflict. Position conflicts offer keep-server, use-the-other and "choose a position";
 * completion conflicts offer keep-server, apply-the-kept-event and an explicit finished/not-finished (ADR-0036).
 * Nothing is chosen automatically and the dialog cannot be dismissed without an answer.
 */
@Composable
fun ConflictPromptHost(
    prompt: ConflictPrompt,
    onPosition: (LConflict, String) -> Unit,
    onExplicitPosition: (LConflict, fileIndex: Int, offsetMs: Long) -> Unit,
    onCompletion: (LConflict, choice: String, event: String?) -> Unit,
) {
    val conflict = prompt.conflicts.firstOrNull { !it.isCompletion } ?: prompt.conflicts.firstOrNull() ?: return
    if (conflict.isCompletion) CompletionConflictDialog(prompt, conflict, onCompletion)
    else PositionConflictDialog(prompt, conflict, onPosition, onExplicitPosition)
}

@Composable
private fun PositionConflictDialog(
    prompt: ConflictPrompt,
    conflict: LConflict,
    onPosition: (LConflict, String) -> Unit,
    onExplicit: (LConflict, Int, Long) -> Unit,
) {
    var choosing by remember(conflict.id) { mutableStateOf(false) }
    if (choosing) {
        ExplicitPositionDialog(prompt.files, onBack = { choosing = false }) { i, ms -> onExplicit(conflict, i, ms) }
        return
    }
    AlertDialog(
        onDismissRequest = {},
        title = { Text(stringResource(R.string.litara_which_position)) },
        text = { Text(stringResource(R.string.litara_conflict_body, prompt.serverLabel, prompt.labels[conflict.id].orEmpty())) },
        confirmButton = {
            Row {
                TextButton({ choosing = true }, Modifier.testTag(ConflictTags.CHOOSE), enabled = prompt.files.isNotEmpty()) { Text(stringResource(R.string.litara_choose_position)) }
                TextButton({ onPosition(conflict, "use_candidate") }, Modifier.testTag(ConflictTags.USE_OTHER)) { Text(stringResource(R.string.litara_use_other)) }
            }
        },
        dismissButton = { TextButton({ onPosition(conflict, "keep_server") }, Modifier.testTag(ConflictTags.KEEP_SERVER)) { Text(stringResource(R.string.litara_keep_server)) } },
    )
}

/** The user picks a file and a time inside it; the position is validated against the file's length before sending. */
@Composable
private fun ExplicitPositionDialog(files: List<LFile>, onBack: () -> Unit, onConfirm: (Int, Long) -> Unit) {
    var index by remember { mutableIntStateOf(0) }
    var seconds by remember { mutableStateOf("0") }
    val ms = seconds.toLongOrNull()?.takeIf { it >= 0 }?.times(1000)
    val max = files.getOrNull(index)?.durationMs
    val valid = ms != null && (max == null || ms <= max)
    AlertDialog(
        onDismissRequest = {},
        title = { Text(stringResource(R.string.litara_choose_position)) },
        text = {
            Column {
                files.forEachIndexed { i, f ->
                    Row(Modifier.fillMaxWidth().clickable { index = i }.testTag(ConflictTags.file(i))) {
                        RadioButton(index == i, { index = i })
                        Text(stringResource(R.string.litara_file_row, i + 1, f.filename, (f.durationMs ?: 0) / 1000), Modifier.padding(top = 12.dp))
                    }
                }
                OutlinedTextField(
                    seconds, { seconds = it.filter(Char::isDigit).take(9) }, singleLine = true,
                    label = { Text(stringResource(R.string.litara_position_seconds)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    isError = !valid, modifier = Modifier.fillMaxWidth().testTag(ConflictTags.EXPLICIT_SECONDS),
                )
                if (!valid) Text(stringResource(R.string.litara_position_out_of_range, (max ?: 0) / 1000), color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = { TextButton({ ms?.let { onConfirm(index, it) } }, Modifier.testTag(ConflictTags.EXPLICIT_CONFIRM), enabled = valid) { Text(stringResource(R.string.litara_use_this_position)) } },
        dismissButton = { TextButton(onBack) { Text(stringResource(R.string.litara_go_back)) } },
    )
}

@Composable
private fun CompletionConflictDialog(prompt: ConflictPrompt, conflict: LConflict, onResolve: (LConflict, String, String?) -> Unit) {
    val ev = conflict.completionCandidate?.event
    val other = when (ev) {
        "natural_end" -> stringResource(R.string.litara_completion_natural_end)
        "manual_finish" -> stringResource(R.string.litara_completion_finished)
        "manual_unfinish" -> stringResource(R.string.litara_completion_unfinished)
        else -> conflict.reason
    }
    val server = stringResource(if (prompt.serverFinished) R.string.litara_completion_finished else R.string.litara_completion_unfinished)
    AlertDialog(
        onDismissRequest = {},
        title = { Text(stringResource(R.string.litara_completion_conflict_title)) },
        text = {
            Column {
                Text(stringResource(R.string.litara_completion_conflict_body, server, other))
                TextButton({ onResolve(conflict, "use_explicit", "manual_finish") }, Modifier.testTag(ConflictTags.COMPLETION_FINISHED)) { Text(stringResource(R.string.litara_mark_finished)) }
                TextButton({ onResolve(conflict, "use_explicit", "manual_unfinish") }, Modifier.testTag(ConflictTags.COMPLETION_UNFINISHED)) { Text(stringResource(R.string.litara_mark_unfinished)) }
            }
        },
        confirmButton = { TextButton({ onResolve(conflict, "use_candidate", null) }, Modifier.testTag(ConflictTags.COMPLETION_USE), enabled = ev != null) { Text(stringResource(R.string.litara_use_other)) } },
        dismissButton = { TextButton({ onResolve(conflict, "keep_server", null) }, Modifier.testTag(ConflictTags.COMPLETION_KEEP)) { Text(stringResource(R.string.litara_keep_server_state)) } },
    )
}
