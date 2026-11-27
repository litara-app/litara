package com.litara.feature.litara

import com.litara.core.litara.LConflict
import com.litara.core.litara.LRecording

/** The choice offered on resume when this device and the server disagree (ADR-0036: ask, never auto-pick). */
data class ConflictPrompt(
    val serverLabel: String,
    val conflicts: List<LConflict>,
    val labels: Map<String, String>,
    val nearby: Set<String>,
    val identical: Set<String>,
    val usable: Set<String>,
    val serverFinished: Boolean = false,
)

private fun fileLabel(snap: LRecording, position: com.litara.core.litara.LPosition): String {
    val file = snap.files.firstOrNull { it.id == position.fileId }
    val seconds = position.offsetMs / 1000
    val time = "%d:%02d:%02d.%03d".format(seconds / 3600, seconds / 60 % 60, seconds % 60, position.offsetMs % 1000)
    return "${position.deviceName} · ${file?.filename ?: "Unavailable file"} · $time"
}

/** Rank close saves below more distinct alternatives, while retaining every conflict. */
fun conflictPrompt(snap: LRecording, position: com.litara.core.litara.LPosition?, conflicts: List<LConflict>, finished: Boolean): ConflictPrompt {
    val differences = conflicts.mapNotNull { conflict ->
        val candidate = conflict.candidate ?: return@mapNotNull null
        if (position == null || candidate.fileId != position.fileId || candidate.contentVersion != position.contentVersion) {
            return@mapNotNull null
        }
        conflict.id to kotlin.math.abs(candidate.offsetMs - position.offsetMs)
    }.toMap()
    return ConflictPrompt(
        serverLabel = position?.let { fileLabel(snap, it) } ?: "Beginning of the recording",
        conflicts = conflicts,
        labels = conflicts.associate { c -> c.id to (c.candidate?.let { fileLabel(snap, it) } ?: c.reason) },
        nearby = differences.filterValues { it < 1000 }.keys,
        identical = differences.filterValues { it == 0L }.keys,
        usable = conflicts.filter { c ->
            val candidate = c.candidate ?: return@filter false
            snap.files.any { file ->
                file.available && file.id == candidate.fileId && file.contentVersion == candidate.contentVersion &&
                    candidate.offsetMs >= 0 && file.durationMs?.let { candidate.offsetMs <= it } == true
            }
        }.map { it.id }.toSet(),
        serverFinished = finished,
    )
}
