package com.litara.core.litara

import java.time.Instant
import java.util.UUID

/** Another device or the web changed this first, so nothing was applied here (ADR-0066). */
class ChangedElsewhereException : Exception("changed elsewhere")

private inline fun <T> orChangedElsewhere(block: () -> T): T = try {
    block()
} catch (e: LitaraHttpException) {
    if (e.status == 409 || e.status == 412) throw ChangedElsewhereException()
    throw e
}

/**
 * Online shelf and rating changes. Every change names the revision it was made against. The identity of a change is
 * remembered until the server answers, so trying again after a lost connection repeats the same operation instead of
 * making a second one (and a new shelf is not created twice).
 */
class PersonalEdits(private val now: () -> String = { Instant.now().toString() }, private val newId: () -> String = { UUID.randomUUID().toString() }) {
    private data class Ids(val operationId: String, val capturedAt: String, val resourceId: String)

    private val waiting = HashMap<String, Ids>()

    private suspend fun <T> once(key: String, send: suspend (Ids) -> T): T {
        val ids = synchronized(waiting) { waiting.getOrPut(key) { Ids(newId(), now(), newId()) } }
        return try {
            orChangedElsewhere { send(ids) }.also { forget(key) }
        } catch (e: TransientException) {
            throw e // the outcome is unknown: keep the identity for the retry
        } catch (e: Exception) {
            forget(key)
            throw e
        }
    }

    private fun forget(key: String) = synchronized(waiting) { waiting.remove(key) }

    suspend fun createShelf(client: LitaraClient, name: String, shared: Boolean): LShelf {
        val data = LShelfData(name.trim(), "manual", if (shared) "shared" else "private", null)
        return once("create|${data.name}|${data.visibility}") { client.putShelf(it.resourceId, LShelfWrite(it.operationId, "0", data, it.capturedAt)) }
    }

    /** Keeps the shelf's kind, visibility and rules as they are. */
    suspend fun renameShelf(client: LitaraClient, shelf: LShelf, name: String): LShelf {
        val data = requireNotNull(shelf.data).copy(name = name.trim())
        return once("rename|${shelf.id}|${shelf.revision}|${data.name}") {
            client.putShelf(shelf.id, LShelfWrite(it.operationId, shelf.revision, data, it.capturedAt))
        }
    }

    suspend fun deleteShelf(client: LitaraClient, shelf: LShelf): LShelf = once("delete|${shelf.id}|${shelf.revision}") {
        client.deleteShelf(shelf.id, LRevisionedChange(it.operationId, shelf.revision, it.capturedAt))
    }

    suspend fun addToShelf(client: LitaraClient, shelf: LShelf, titleId: String): LShelf = once("add|${shelf.id}|${shelf.revision}|$titleId") {
        client.addToShelf(shelf.id, titleId, LRevisionedChange(it.operationId, shelf.revision, it.capturedAt))
    }

    suspend fun removeFromShelf(client: LitaraClient, shelf: LShelf, titleId: String): LShelf = once("remove|${shelf.id}|${shelf.revision}|$titleId") {
        client.removeFromShelf(shelf.id, titleId, LRevisionedChange(it.operationId, shelf.revision, it.capturedAt))
    }

    /** Sets or clears the rating, sending the review and dates back unchanged. */
    suspend fun rate(client: LitaraClient, current: LTitlePersonal, halves: Int?): LTitlePersonal {
        require(halves == null || halves in 1..10) { "a rating is 1 to 10 half stars" }
        return once("rate|${current.titleId}|${current.revision}|$halves") {
            client.putTitlePersonal(current.titleId, LTitlePersonalWrite(it.operationId, current.revision, current.data.copy(ratingHalves = halves), it.capturedAt))
        }
    }
}

/** Every shelf of the signed-in account that a title can be added to. */
suspend fun LitaraClient.shelvesToAddTo(maxPages: Int = 20): List<LShelf> {
    val all = ArrayList<LShelf>()
    var page = 0
    var seen = 0
    while (page < maxPages) {
        val r = shelves(page, 200, "mine")
        seen += r.items.size
        all += r.items.filter { it.manualAndEditable }
        if (r.items.isEmpty() || seen >= r.total) break
        page++
    }
    return all.sortedBy { it.data?.name?.lowercase() }
}
