package com.litara.core.litara

import kotlinx.serialization.EncodeDefault
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
    val physicalCopyCount: Long = 0,
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

/**
 * A durable server-kept candidate for a personal write that could not be applied (stale revision, changed
 * content, ...). [candidate] stays raw JSON: its shape depends on [resourceKind] and this client only
 * interprets kinds it implements; others are shown as needing the web app.
 */
@Serializable
data class LPersonalConflict(
    val id: String,
    /** position, completion, annotation, shelf, membership or shelf-order. */
    val resourceKind: String,
    val resourceId: String,
    val editionId: String?,
    /** stale_revision, content_changed, locator_incompatible, deleted or access_changed. */
    val reason: String,
    val baseRevision: String,
    val currentRevision: String,
    val candidate: kotlinx.serialization.json.JsonElement,
    val createdAt: String,
    val resolvedAt: String?,
)

@Serializable
data class LPersonalConflicts(val items: List<LPersonalConflict>, val total: Long, val page: Long, val size: Long)

/** [choice] is keep_server or use_candidate; [baseRevision] is the CURRENT resource revision, not the candidate's. */
@Serializable
data class LResolve(val operationId: String, val baseRevision: String, val choice: String, val contentVersion: String?)

@Serializable
data class LResolved(val conflictId: String, val resourceKind: String, val resourceId: String, val revision: String, val resolvedAt: String)

/** One page of a comic archive as the server extracted it. [entryId] is the stable identity used in locators. */
@Serializable
data class LPage(
    val index: Int,
    val entryId: String,
    val mimeType: String,
    val width: Int,
    val height: Int,
    /** Server-relative path of this exact page image. */
    val contentPath: String,
)

/** GET/POST .../files/{fileId}/versions/{contentVersion}/pages. [state] is processing, ready, incomplete or unsupported. */
@Serializable
data class LPageManifest(
    val fileId: String,
    val contentVersion: String,
    val manifestVersion: String,
    val state: String,
    val pages: List<LPage> = emptyList(),
    val issues: List<LEditionIssue> = emptyList(),
)

/** Body of the user-triggered extraction request; [baseRevision] is the edition revision the caller saw. */
@Serializable
data class LExtraction(val operationId: String, val baseRevision: String, val contentVersion: String)

@Serializable
data class LRectangle(val x: Double, val y: Double, val width: Double, val height: Double)

/** The selected text range of a highlight (T005 selection); absent for page notes and bookmarks. */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("kind")
sealed interface LSelection {
    @Serializable
    @SerialName("foliate-range")
    data class FoliateRange(val cfi: String, val version: Int = 1) : LSelection

    @Serializable
    @SerialName("pdf-rectangles")
    data class PdfRectangles(val pageIndex: Int, val rectangles: List<LRectangle>, val version: Int = 1) : LSelection
}

/**
 * [kind] is highlight, note or bookmark. [text] is the user's private text; [quote] is the selected book text (untrusted
 * display data). [color] is a colour name (ADR-0094); the field is left out, not sent as null, for the default look.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class LAnnotationData(
    val kind: String,
    val anchor: LEditionAnchor,
    val selection: LSelection?,
    val text: String,
    val quote: String,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val color: String? = null,
)

/** Create (base revision "0" with a never-used client UUID) or change one annotation; revision-checked and idempotent by [operationId]. */
@Serializable
data class LAnnotationWrite(val operationId: String, val baseRevision: String, val data: LAnnotationData, val capturedAt: String)

@Serializable
data class LAnnotationDelete(val operationId: String, val baseRevision: String, val capturedAt: String)

/** A deleted annotation stays as a tombstone ([deleted] true, [data] null) so a stale edit can never recreate it. */
@Serializable
data class LAnnotation(
    val id: String,
    val editionId: String,
    val revision: String,
    val deleted: Boolean,
    val data: LAnnotationData?,
    val updatedAt: String,
)

@Serializable
data class LAnnotations(val items: List<LAnnotation>, val total: Long, val page: Long, val size: Long)
