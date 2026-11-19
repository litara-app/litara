package com.litara.feature.litara

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.litara.R
import com.litara.core.litara.LConflict

object ConflictTags {
    const val KEEP_SERVER = "conflict_keep_server"
    const val USE_OTHER = "conflict_use_other"
    const val COMPLETION_KEEP = "completion_keep_server"
    const val COMPLETION_USE = "completion_use_other"
    const val COMPLETION_FINISHED = "completion_set_finished"
    const val COMPLETION_UNFINISHED = "completion_set_unfinished"
}

/**
 * Shows the first unresolved conflict. Position conflicts offer the saved server position or the other device’s position;
 * completion conflicts offer keep-server, apply-the-kept-event and an explicit finished/not-finished (ADR-0036).
 * Nothing is chosen automatically and the dialog cannot be dismissed without an answer.
 */
@Composable
fun ConflictPromptHost(
    prompt: ConflictPrompt,
    onPosition: (LConflict, String) -> Unit,
    onCompletion: (LConflict, choice: String, event: String?) -> Unit,
) {
    val conflict = prompt.conflicts.firstOrNull { !it.isCompletion && it.id in prompt.usable && it.id !in prompt.nearby }
        ?: prompt.conflicts.firstOrNull { !it.isCompletion } ?: prompt.conflicts.firstOrNull() ?: return
    if (conflict.isCompletion) CompletionConflictDialog(prompt, conflict, onCompletion)
    else PositionConflictDialog(prompt, conflict, onPosition)
}

@Composable
private fun PositionConflictDialog(
    prompt: ConflictPrompt,
    conflict: LConflict,
    onPosition: (LConflict, String) -> Unit,
) {
    AlertDialog(
        onDismissRequest = {},
        title = { Text(stringResource(R.string.litara_which_position)) },
        text = {
            Column {
                Text(stringResource(R.string.litara_conflict_body, prompt.serverLabel, prompt.labels[conflict.id].orEmpty()))
                if (conflict.id in prompt.nearby) Text(stringResource(R.string.litara_conflict_nearby))
                if (conflict.id !in prompt.usable) Text(stringResource(R.string.litara_conflict_unavailable))
            }
        },
        confirmButton = {
            if (conflict.id in prompt.usable && conflict.id !in prompt.identical) {
                TextButton({ onPosition(conflict, "use_candidate") }, Modifier.testTag(ConflictTags.USE_OTHER)) {
                    Text(stringResource(R.string.litara_use_candidate_position))
                }
            }
        },
        dismissButton = {
            TextButton({ onPosition(conflict, "keep_server") }, Modifier.testTag(ConflictTags.KEEP_SERVER)) {
                Text(stringResource(R.string.litara_keep_saved_position))
            }
        },
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
