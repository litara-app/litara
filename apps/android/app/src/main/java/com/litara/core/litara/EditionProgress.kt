package com.litara.core.litara

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.io.File
import java.time.Instant
import java.util.UUID

/** The wire `kind` of a locator (T005 locator version 1). */
val LLocator.kindName: String
    get() = when (this) {
        is LLocator.FoliateCfi -> "foliate-cfi"
        is LLocator.PdfPage -> "pdf-page"
        is LLocator.ComicPage -> "comic-page"
    }

/** The wire `kind` of a selection (T005 selection kinds). */
val LSelection.kindName: String
    get() = when (this) {
        is LSelection.FoliateRange -> "foliate-range"
        is LSelection.PdfRectangles -> "pdf-rectangles"
    }

/**
 * Which locators this native client may exchange with the server's canonical position, decided on evidence
 * (contracts/t005/README.md: ancestry or syntax is not compatibility evidence). A locator or selection that is not allowed
 * stays on the device for the exact file version and is never sent, applied or relabeled.
 *
 * - [compatibleProfiles]: engine profiles proven for every locator kind and format. Empty: no blanket claim is made.
 * - [canonicalKinds]: kinds whose value is defined by server data both clients read, not by a renderer. A comic page locator is
 *   `{pageIndex, entryId, manifestVersion}` copied from the server's page manifest, and the web reader builds the same shape
 *   from the same manifest (`apps/web/src/reader/ComicReader.tsx`).
 * - [provenFormats]: kind to the file formats for which the native and web renderers were shown to agree on the same bytes
 *   (see research/t007/evidence/m1-locators): both engines produced byte-identical CFI strings for the same ranges and resolved each
 *   other's positions to the same text across viewport and font changes, in desktop Chromium and in the device WebView.
 *   PDF rectangles are made on Android only by highlight mode, which runs the web's own engine (ADR-0113; see
 *   PdfHighlightPositionsTest and scripts/web/reader-protocol/pdf-rects.mjs).
 */
class LocatorPolicy(
    val compatibleProfiles: Set<String> = emptySet(),
    val canonicalKinds: Set<String> = emptySet(),
    val provenFormats: Map<String, Set<String>> = emptyMap(),
) {
    fun allowsKind(engineProfile: String, kind: String, format: String): Boolean =
        engineProfile in compatibleProfiles || kind in canonicalKinds || provenFormats[kind]?.contains(format) == true

    fun allows(engineProfile: String, locator: LLocator, format: String): Boolean = allowsKind(engineProfile, locator.kindName, format)

    fun allowsSelection(engineProfile: String, selection: LSelection, format: String): Boolean =
        allowsKind(engineProfile, selection.kindName, format)

    companion object {
        val NONE = LocatorPolicy()

        /**
         * What the native readers are allowed to sync today. EPUB and FB2: Foliate CFIs and range selections (the engines
         * agree; KEPUB, MOBI, AZW and AZW3 are NOT included: no fixtures, and the MOBI6 converter differs between the engines).
         * PDF: pages (the system reader reports `x=0, y=0`) and the rectangles of highlight mode, which the shared engine
         * computes as the web does.
         * Comics: the manifest's own page identity, for every comic format.
         */
        val NATIVE = LocatorPolicy(
            canonicalKinds = setOf("comic-page"),
            provenFormats = mapOf(
                "foliate-cfi" to setOf("epub", "fb2"),
                "foliate-range" to setOf("epub", "fb2"),
                "pdf-page" to setOf("pdf"),
                "pdf-rectangles" to setOf("pdf"),
            ),
        )
    }
}

/** What happened to one ebook/comic/PDF position report. */
sealed interface EditionReportOutcome {
    /** Stored on this device only: the locator is not proven compatible, so it is never sent. */
    data class LocalOnly(val engineProfile: String) : EditionReportOutcome

    data object Accepted : EditionReportOutcome

    /** Network/server trouble: kept as the single pending write and retried with the SAME operation id. */
    data object Queued : EditionReportOutcome

    /** Another client advanced first (409 stale_revision). The server kept this write as a durable candidate. */
    data class Conflict(val conflictId: String) : EditionReportOutcome

    /** The bytes or locator profile no longer match (412). The candidate is preserved; nothing is reinterpreted. */
    data class ContentChanged(val code: String, val currentContentVersion: String?) : EditionReportOutcome

    data class AccessEnded(val code: String) : EditionReportOutcome
}

/**
 * A reading location stored on this device for exactly one file version. Never applied to other bytes.
 * [cfi]/[fraction] keep the first (EPUB) format readable; [locator] carries any kind (PDF page, comic page).
 */
@Serializable
data class LocalEditionPosition(
    val fileId: String,
    val contentVersion: String,
    val cfi: String = "",
    val fraction: Double = 0.0,
    val savedAt: String,
    val locator: LLocator? = null,
) {
    /** The stored locator, reading older CFI-only records as Foliate CFIs. */
    val anchor: LLocator? get() = locator ?: cfi.takeIf { it.isNotEmpty() }?.let { LLocator.FoliateCfi(it) }
}

/**
 * Revision-aware position reporting for one edition (T005, ADR-0065). Every location is first stored
 * locally for the exact file/version; it is sent to the server only when [policy] allows that locator for the
 * snapshot's engine profile. The one pending write survives restarts and is retried with its original operation id.
 */
class EditionProgressSync(
    private val client: LitaraClient,
    private val editionId: String,
    private val fileId: String,
    private val contentVersion: String,
    private val engineProfile: String,
    private val format: String,
    private val policy: LocatorPolicy,
    private val dir: File,
    private val initialState: LEditionPositionState? = null,
) {
    private val gate = Mutex()
    private val localFile = File(dir, "local-position.json")
    private val pendingFile = File(dir, "pending-position.json")

    private val revisionFile = File(dir, "position-revision-$contentVersion.txt")
    private fun revisionNumber(value: String?) = value?.toLongOrNull()?.takeIf { it >= 0 } ?: 0L

    var revision: String = maxOf(
        revisionNumber(runCatching { revisionFile.readText() }.getOrNull()),
        revisionNumber(initialState?.revision),
    ).toString()
        private set
    var unresolvedConflicts: Long = 0
        private set

    private fun adopt(s: LEditionPositionState) {
        if (revisionNumber(s.revision) >= revisionNumber(revision)) {
            revision = s.revision
            runCatching { AtomicFile.write(revisionFile, revision) }
        }
        unresolvedConflicts = s.unresolvedConflictCount
    }

    /** The device-local location for exactly this file version, or null (a position for other bytes is never returned). */
    fun local(): LocalEditionPosition? =
        localFile.takeIf { it.exists() }
            ?.let { runCatching { LitaraJson.decodeFromString<LocalEditionPosition>(it.readText()) }.getOrNull() }
            ?.takeIf { it.fileId == fileId && it.contentVersion == contentVersion }

    /**
     * The server's saved locator for exactly these bytes, but only if the policy lets this renderer read it.
     * A refused locator is not applied and not overwritten by a read.
     */
    suspend fun serverLocator(readerKinds: Set<String>): LLocator? = gate.withLock {
        // A reader whose locator kinds are all refused by the policy never even asks for the server position.
        if (readerKinds.none { policy.allowsKind(engineProfile, it, format) }) return null
        val state = try {
            client.editionPosition(editionId).also(::adopt)
        } catch (_: TransientException) {
            initialState?.takeIf { local() == null } ?: return null
        }
        val a = state.position?.anchor ?: return null
        if (a.fileId != fileId || a.contentVersion != contentVersion) return null
        a.locator.takeIf { policy.allows(engineProfile, it, format) }
    }

    /** The server's saved CFI for exactly these bytes, when this renderer may read that profile. */
    suspend fun serverCfi(): String? = (serverLocator(setOf("foliate-cfi")) as? LLocator.FoliateCfi)?.cfi

    suspend fun report(cfi: String, fraction: Double): EditionReportOutcome = report(LLocator.FoliateCfi(cfi), fraction)

    suspend fun report(locator: LLocator, fraction: Double?): EditionReportOutcome = gate.withLock {
        val now = Instant.now().toString()
        val cfi = (locator as? LLocator.FoliateCfi)?.cfi.orEmpty()
        AtomicFile.write(localFile, LitaraJson.encodeToString(
            LocalEditionPosition(fileId, contentVersion, cfi, fraction ?: 0.0, now, locator.takeUnless { it is LLocator.FoliateCfi })))
        if (!policy.allows(engineProfile, locator, format)) return@withLock EditionReportOutcome.LocalOnly(engineProfile)
        flushPendingLocked()?.let { if (it !is EditionReportOutcome.Accepted) return@withLock it }
        send(LEditionPositionWrite(UUID.randomUUID().toString(), revision, LEditionAnchor(fileId, contentVersion, locator), now))
    }

    /** Retries the saved write with its original operation id. Null when nothing was pending. */
    suspend fun flushPending(): EditionReportOutcome? = gate.withLock { flushPendingLocked() }

    fun hasPending(): Boolean = pendingFile.exists()

    private suspend fun flushPendingLocked(): EditionReportOutcome? = readPending()?.let { send(it) }

    private suspend fun send(w: LEditionPositionWrite): EditionReportOutcome = try {
        adopt(client.writeEditionPosition(editionId, w))
        pendingFile.delete()
        EditionReportOutcome.Accepted
    } catch (e: LitaraHttpException) {
        when {
            e.status == 409 && e.problem.code == "stale_revision" -> {
                pendingFile.delete() // the server preserved it as a durable candidate
                runCatching { client.editionPosition(editionId).also(::adopt) }
                EditionReportOutcome.Conflict(e.problem.conflictId.orEmpty())
            }
            e.status == 412 -> { pendingFile.delete(); EditionReportOutcome.ContentChanged(e.problem.code, e.problem.currentContentVersion) }
            e.status == 401 || e.status == 403 -> queue(w).let { EditionReportOutcome.AccessEnded(e.problem.code) }
            e.status in 500..599 || e.status == 429 -> queue(w)
            else -> throw e
        }
    } catch (_: TransientException) {
        queue(w)
    } catch (e: SessionEndedException) {
        queue(w)
        EditionReportOutcome.AccessEnded(e.code)
    }

    private fun queue(w: LEditionPositionWrite): EditionReportOutcome {
        AtomicFile.write(pendingFile, LitaraJson.encodeToString(w))
        return EditionReportOutcome.Queued
    }

    private fun readPending(): LEditionPositionWrite? =
        pendingFile.takeIf { it.exists() }?.let { runCatching { LitaraJson.decodeFromString<LEditionPositionWrite>(it.readText()) }.getOrNull() }
}
