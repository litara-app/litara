package com.litara.core.litara

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

/**
 * Litara T005 ebook/comic wire models (contracts/t005/openapi.json). IDs are opaque strings and
 * revisions are decimal strings. An edition is the exact-file reading identity: it is never a
 * recording, and nothing here fabricates one.
 */
@Serializable
data class LEditionIssue(val code: String, val detail: String)

/** state is one of `supported`, `incomplete`, `unsupported`; anything but `supported` must not be presented as working. */
@Serializable
data class LEditionCapability(val state: String, val issues: List<LEditionIssue> = emptyList()) {
    val supported: Boolean get() = state == "supported"
}

@Serializable
data class LEditionFile(
    val id: String,
    val contentVersion: String,
    /** epub, kepub, mobi, azw, azw3, fb2, pdf, cbz, cbr or cb7. */
    val format: String,
    val mimeType: String,
    val sizeBytes: Long?,
    /** available, missing, unavailable or unverified. */
    val availability: String,
    /** Server-relative content path for exactly this file version, or null when it is not readable. */
    val contentPath: String?,
)

@Serializable
data class LEditionCapabilities(
    val read: LEditionCapability,
    val download: LEditionCapability,
    val resume: LEditionCapability,
    val textSelection: LEditionCapability,
    val textHighlight: LEditionCapability,
    val pageNote: LEditionCapability,
    val bookmark: LEditionCapability,
)

@Serializable
data class LEdition(
    val id: String,
    val titleId: String,
    val libraryId: String,
    val revision: String,
    val label: String,
    val language: String?,
    val file: LEditionFile,
    /** ready, incomplete or unsupported. */
    val readiness: String,
    val issues: List<LEditionIssue> = emptyList(),
    val completion: LCompletion,
    val capabilities: LEditionCapabilities,
)

@Serializable
data class LEditions(val items: List<LEdition>, val total: Long, val page: Long, val size: Long)

@Serializable
data class LTitleSummary(
    val id: String,
    val title: String,
    val authors: List<String> = emptyList(),
    val series: List<String> = emptyList(),
    val languages: List<String> = emptyList(),
    val editionCount: Long,
    val recordingCount: Long,
    val lastActivityAt: String?,
)

@Serializable
data class LTitles(val items: List<LTitleSummary>, val total: Long, val page: Long, val size: Long)

/**
 * A typed reading locator (T005 locator version 1). Only the engine profile named by the reader
 * snapshot may interpret a [LLocator.FoliateCfi]; a locator that cannot be resolved must be rejected
 * visibly, never replaced by a percentage.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("kind")
sealed interface LLocator {
    @Serializable
    @SerialName("foliate-cfi")
    data class FoliateCfi(val cfi: String, val version: Int = 1) : LLocator

    @Serializable
    @SerialName("pdf-page")
    data class PdfPage(val pageIndex: Int, val x: Double, val y: Double, val version: Int = 1) : LLocator

    @Serializable
    @SerialName("comic-page")
    data class ComicPage(val pageIndex: Int, val entryId: String, val manifestVersion: String, val version: Int = 1) : LLocator
}

@Serializable
data class LEditionAnchor(val fileId: String, val contentVersion: String, val locator: LLocator)

@Serializable
data class LEditionPosition(
    val anchor: LEditionAnchor,
    val capturedAt: String,
    val receivedAt: String,
    val deviceName: String,
)

@Serializable
data class LEditionPositionState(
    val revision: String,
    val position: LEditionPosition?,
    val unresolvedConflictCount: Long,
    val conflictsPath: String,
)

/** The idempotent write: [operationId] is generated once per intended change and reused on every retry. */
@Serializable
data class LEditionPositionWrite(
    val operationId: String,
    val baseRevision: String,
    val anchor: LEditionAnchor,
    val capturedAt: String,
)

@Serializable
data class LEditionCompletionWrite(
    val operationId: String,
    val baseRevision: String,
    val fileId: String,
    val contentVersion: String,
    /** manual_finish or manual_unfinish. */
    val event: String,
    val capturedAt: String,
)

/** GET /editions/{id}/reader: the capability-aware open descriptor. [engine] is foliate, pdfjs, image-pages or none. */
@Serializable
data class LReaderSnapshot(
    val schemaVersion: Int,
    val edition: LEdition,
    val position: LEditionPositionState,
    val engine: String,
    val engineProfile: String,
    val pageManifestPath: String?,
)
