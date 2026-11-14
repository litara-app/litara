package com.litara.core.litara

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Litara T003 wire models (contracts/t003/openapi.json). IDs are opaque strings; nothing here parses
 * them. Revisions are decimal strings. Unknown numbers are null, never zero.
 */
internal val LitaraJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = true // PositionWrite.position etc. must be sent as explicit null
    encodeDefaults = true
}

@Serializable
data class LUser(val id: String, val username: String, val displayName: String, val isAdmin: Boolean, val active: Boolean)

@Serializable
data class LSession(
    val id: String,
    val deviceName: String,
    val client: String,
    val createdAt: String,
    val lastUsedAt: String,
    val idleExpiresAt: String,
    val absoluteExpiresAt: String,
)

@Serializable
data class Discovery(
    val serverId: String,
    val product: String,
    val apiVersions: List<String>,
    val apiBasePath: String,
    val stability: String,
    val capabilities: List<String>,
    val registration: String,
)

@Serializable
data class TokenPair(
    val accessToken: String,
    val tokenType: String,
    val expiresIn: Int,
    val refreshToken: String,
    val session: LSession,
    val user: LUser,
)

@Serializable
data class LAnchor(val fileId: String, val contentVersion: String, val offsetMs: Long)

@Serializable
data class LFile(
    val id: String,
    val contentVersion: String,
    val sequence: Long,
    val filename: String,
    val mimeType: String,
    val sizeBytes: Long?,
    val durationMs: Long?,
    val available: Boolean,
    val contentPath: String,
)

@Serializable
data class LChapter(
    val id: String,
    val label: String,
    val start: LAnchor,
    val recordingStartMs: Long?,
    val source: String,
    val generated: Boolean,
)

@Serializable
data class LCompletion(val revision: String, val finished: Boolean, val changedAt: String?)

@Serializable
data class LCapabilities(val play: Boolean, val download: Boolean, val wholeRecordingSeek: Boolean)

@Serializable
data class LIssue(val code: String, val message: String, val source: String?, val fileId: String?)

@Serializable
data class LArtwork(val thumbnailPath: String?, val coverPath: String?)

/** The self-contained schemaVersion=1 offline snapshot (GET /recordings/{id}). */
@Serializable
data class LRecording(
    val id: String,
    val titleId: String,
    val libraryId: String,
    val title: String,
    val authors: List<String>,
    val narrators: List<String>,
    val readiness: String,
    val durationMs: Long?,
    val artwork: LArtwork,
    val completion: LCompletion,
    val lastActivityAt: String?,
    val schemaVersion: Int,
    val layoutRevision: String,
    val files: List<LFile>,
    val chapters: List<LChapter>,
    val capabilities: LCapabilities,
    val issues: List<LIssue>,
)

@Serializable
data class LRecordingSummary(
    val id: String,
    val titleId: String,
    val title: String,
    val readiness: String,
    val durationMs: Long?,
    val authors: List<String> = emptyList(),
    val narrators: List<String> = emptyList(),
    val artwork: LArtwork? = null,
)

@Serializable
data class LRecordings(val items: List<LRecordingSummary>, val total: Long, val page: Long, val size: Long)

@Serializable
data class LPosition(
    val fileId: String,
    val contentVersion: String,
    val offsetMs: Long,
    val layoutRevision: String,
    val capturedAt: String,
    val receivedAt: String,
    val deviceName: String,
)

@Serializable
data class LConflict(
    val id: String,
    val reason: String,
    val candidate: LPosition?,
    val baseRevision: String,
    val createdAt: String,
    val resolvedAt: String?,
    /** Set (and [candidate] null) for a completion conflict: the preserved event that lost or could not be applied. */
    val completionCandidate: LCompletionWrite? = null,
) {
    val isCompletion: Boolean get() = completionCandidate != null || reason == "completion_changed"
}

@Serializable
data class LPositionState(val revision: String, val position: LPosition?, val unresolvedConflicts: List<LConflict>)

@Serializable
data class LPositionInput(val fileId: String, val contentVersion: String, val offsetMs: Long, val capturedAt: String)

@Serializable
data class LPositionWrite(val operationId: String, val baseRevision: String, val layoutRevision: String, val position: LPositionInput)

@Serializable
data class LResolveConflict(
    val operationId: String,
    val baseRevision: String,
    val layoutRevision: String,
    val choice: String,
    val position: LPositionInput?,
)

@Serializable
data class LCompletionWrite(
    val operationId: String,
    val baseRevision: String,
    val layoutRevision: String,
    val event: String,
    val capturedAt: String,
    val finalPosition: LAnchor?,
)

@Serializable
data class LResolveCompletion(
    val operationId: String,
    val baseRevision: String,
    val layoutRevision: String,
    val choice: String,
    val event: String?,
    val capturedAt: String,
    val finalPosition: LAnchor?,
)

@Serializable
data class LRefresh(val refreshToken: String, val requestId: String)

@Serializable
data class LLogin(val username: String, val password: String, val deviceName: String)

/** RFC 9457 problem body; clients branch on [code]/status, never on [detail]. */
@Serializable
data class Problem(
    val code: String = "",
    val status: Int = 0,
    val detail: String = "",
    val requestId: String = "",
    val conflictId: String? = null,
    val currentLayoutRevision: String? = null,
)
