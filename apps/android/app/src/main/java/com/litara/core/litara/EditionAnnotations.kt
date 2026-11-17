package com.litara.core.litara

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.io.File
import java.time.Instant
import java.util.UUID

/** An undelivered write or delete saved BEFORE sending, so a restart or lost response retries the same operation. */
@Serializable
data class PendingAnnotationOp(val operationId: String, val baseRevision: String, val delete: Boolean, val capturedAt: String)

/**
 * One annotation on this device, for exactly one file version. [revision] is the last server revision it is based on
 * ("0" = never created on the server); [synced] means the server holds this exact state. [color] and [chapterTitle] are
 * device-only display data: the wire contract has no field for them.
 */
@Serializable
data class LocalAnnotation(
    val id: String,
    /** highlight, note or bookmark. */
    val kind: String,
    val locator: LLocator,
    val selection: LSelection? = null,
    val quote: String = "",
    val text: String = "",
    val color: String = "yellow",
    val chapterTitle: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val deleted: Boolean = false,
    val revision: String = "0",
    val synced: Boolean = false,
    val pending: PendingAnnotationOp? = null,
    /** Set when the server refused a write and kept it as a conflict; the user decides in the web app. */
    val conflict: String? = null,
)

@Serializable
private data class AnnotationFile(val fileId: String, val contentVersion: String, val items: List<LocalAnnotation> = emptyList())

/**
 * Annotations for one edition's exact file version, stored atomically in the account's edition directory.
 * A different file version reads as empty and its file is left alone: annotations of superseded bytes are
 * recoverable, never painted onto new content and never reinterpreted.
 */
class AnnotationStore(private val dir: File, private val fileId: String, private val contentVersion: String) {
    private val file = File(dir, "annotations-$fileId-$contentVersion.json")

    @Synchronized
    fun all(): List<LocalAnnotation> =
        file.takeIf { it.exists() }
            ?.let { runCatching { LitaraJson.decodeFromString<AnnotationFile>(it.readText()) }.getOrNull() }
            ?.takeIf { it.fileId == fileId && it.contentVersion == contentVersion }?.items.orEmpty()

    fun visible(): List<LocalAnnotation> = all().filter { !it.deleted }

    fun get(id: String): LocalAnnotation? = all().firstOrNull { it.id == id }

    @Synchronized
    fun put(a: LocalAnnotation) {
        val next = all().filter { it.id != a.id } + a
        AtomicFile.write(file, LitaraJson.encodeToString(AnnotationFile(fileId, contentVersion, next)))
    }

    @Synchronized
    fun remove(id: String) {
        AtomicFile.write(file, LitaraJson.encodeToString(AnnotationFile(fileId, contentVersion, all().filter { it.id != id })))
    }
}

/**
 * Private annotations (T005, ADR-0065) with local-first persistence and policy-gated server sync.
 *
 * Every change is saved on the device first. It is sent only when [policy] allows its locator for this edition's engine
 * profile and file format AND, for a text selection, the selection kind too (a selection is renderer-defined even when the page
 * locator is not). Today comic page notes and bookmarks sync, and so do EPUB/FB2 highlights, notes and bookmarks; nothing
 * for formats without evidence does. Writes are revision-aware: create with base "0" and a client UUID, edit/delete with the last known
 * revision, saved with their operation id before sending, never stacked and never retried under another identity.
 */
class EditionAnnotationSync(
    private val client: LitaraClient,
    private val editionId: String,
    private val fileId: String,
    private val contentVersion: String,
    private val engineProfile: String,
    private val format: String,
    private val policy: LocatorPolicy,
    val store: AnnotationStore,
) {
    private val gate = Mutex()

    fun canSync(a: LocalAnnotation): Boolean =
        policy.allows(engineProfile, a.locator, format) && (a.selection == null || policy.allowsSelection(engineProfile, a.selection, format))

    private fun now() = Instant.now().toString()

    private fun anchor(l: LLocator) = LEditionAnchor(fileId, contentVersion, l)

    /** Saves a new annotation on the device and, if allowed, delivers it. */
    suspend fun create(kind: String, locator: LLocator, selection: LSelection?, quote: String, text: String, color: String, chapter: String?): Pair<LocalAnnotation, EditionReportOutcome> = gate.withLock {
        val n = now()
        var a = LocalAnnotation(UUID.randomUUID().toString(), kind, locator, selection, quote, text, color, chapter, n, n)
        if (canSync(a)) a = a.copy(pending = PendingAnnotationOp(UUID.randomUUID().toString(), "0", false, n))
        store.put(a)
        val outcome = deliverLocked(a.id)
        store.get(a.id)!! to outcome
    }

    /** Changes the private text and/or the device-only colour of [id]. */
    suspend fun edit(id: String, text: String? = null, color: String? = null): EditionReportOutcome = gate.withLock {
        val cur = store.get(id) ?: return@withLock EditionReportOutcome.Accepted
        var a = cur.copy(text = text ?: cur.text, color = color ?: cur.color, updatedAt = now())
        val serverChanges = text != null && text != cur.text
        if (serverChanges && canSync(a)) a = a.copy(synced = false, pending = a.pending ?: PendingAnnotationOp(UUID.randomUUID().toString(), a.revision, false, now()))
        store.put(a)
        if (a.pending != null) deliverLocked(id) else EditionReportOutcome.LocalOnly(engineProfile)
    }

    /** Deletes [id]: removed outright if the server never saw it, otherwise a revision-checked delete keeps the tombstone. */
    suspend fun delete(id: String): EditionReportOutcome = gate.withLock {
        val cur = store.get(id) ?: return@withLock EditionReportOutcome.Accepted
        if (cur.revision == "0" && cur.pending == null) { store.remove(id); return@withLock EditionReportOutcome.Accepted }
        if (!canSync(cur)) { store.remove(id); return@withLock EditionReportOutcome.LocalOnly(engineProfile) }
        // A never-delivered create is delivered first so the delete has a real revision to be checked against.
        if (cur.pending != null) deliverLocked(id)
        val fresh = store.get(id) ?: return@withLock EditionReportOutcome.Accepted
        if (fresh.revision == "0") { store.remove(id); return@withLock EditionReportOutcome.Accepted }
        store.put(fresh.copy(deleted = true, synced = false, updatedAt = now(),
            pending = PendingAnnotationOp(UUID.randomUUID().toString(), fresh.revision, true, now())))
        deliverLocked(id)
    }

    /** Delivers saved operations, then (when the policy allows any of this reader's kinds) merges the server's annotations. */
    suspend fun refresh(readerKinds: Set<String>): EditionReportOutcome? = gate.withLock {
        var last: EditionReportOutcome? = null
        // Annotations made while this kind was device-only become sendable once the policy allows them: queue each as a create.
        store.all().filter { it.pending == null && !it.synced && !it.deleted && it.revision == "0" && it.conflict == null && canSync(it) }
            .forEach { store.put(it.copy(pending = PendingAnnotationOp(UUID.randomUUID().toString(), "0", false, now()))) }
        store.all().filter { it.pending != null }.forEach { last = deliverLocked(it.id) }
        if (readerKinds.none { policy.allowsKind(engineProfile, it, format) }) return@withLock last
        val server = try { client.listAllAnnotations(editionId) } catch (_: TransientException) { return@withLock EditionReportOutcome.Queued }
        catch (e: SessionEndedException) { return@withLock EditionReportOutcome.AccessEnded(e.code) }
        for (s in server) {
            val d = s.data
            if (d != null && (d.anchor.fileId != fileId || d.anchor.contentVersion != contentVersion)) continue // other bytes: detached
            val cur = store.get(s.id)
            if (cur != null && (cur.pending != null || (!cur.synced && cur.revision != s.revision))) continue // local changes win until sent
            if (d == null) { // tombstone
                if (cur != null) store.put(cur.copy(deleted = true, revision = s.revision, synced = true, pending = null))
                continue
            }
            if (!policy.allows(engineProfile, d.anchor.locator, format) || (d.selection != null && !policy.allowsSelection(engineProfile, d.selection, format))) continue
            store.put(LocalAnnotation(s.id, d.kind, d.anchor.locator, d.selection, d.quote, d.text, cur?.color ?: "yellow", cur?.chapterTitle,
                cur?.createdAt ?: s.updatedAt, s.updatedAt, false, s.revision, true, null, null))
        }
        last
    }

    private suspend fun deliverLocked(id: String): EditionReportOutcome {
        val a = store.get(id) ?: return EditionReportOutcome.Accepted
        val p = a.pending ?: return EditionReportOutcome.LocalOnly(engineProfile)
        return try {
            val r = if (p.delete) client.deleteAnnotation(editionId, id, LAnnotationDelete(p.operationId, p.baseRevision, p.capturedAt))
            else client.putAnnotation(editionId, id, LAnnotationWrite(p.operationId, p.baseRevision,
                LAnnotationData(a.kind, anchor(a.locator), a.selection, a.text, a.quote), p.capturedAt))
            store.put(a.copy(revision = r.revision, synced = true, pending = null, conflict = null, deleted = r.deleted || a.deleted))
            EditionReportOutcome.Accepted
        } catch (e: LitaraHttpException) {
            when {
                e.status == 409 || e.status == 412 -> { // the server kept the attempt as a durable conflict; no blind retry
                    store.put(a.copy(pending = null, synced = false, conflict = e.problem.code))
                    if (e.status == 409) EditionReportOutcome.Conflict(e.problem.conflictId.orEmpty())
                    else EditionReportOutcome.ContentChanged(e.problem.code, e.problem.currentContentVersion)
                }
                e.status == 401 || e.status == 403 -> EditionReportOutcome.AccessEnded(e.problem.code)
                e.status in 500..599 || e.status == 429 -> EditionReportOutcome.Queued
                else -> throw e
            }
        } catch (_: TransientException) {
            EditionReportOutcome.Queued
        } catch (e: SessionEndedException) {
            EditionReportOutcome.AccessEnded(e.code)
        }
    }
}
