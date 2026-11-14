package com.litara.core.litara

import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.UUID

/**
 * Real-server check of the two explicit-resolution features: choosing a new position for a resume conflict and
 * resolving completion conflicts (keep server / use the kept event / explicit event). Same environment as
 * [LitaraServerE2ETest]; skipped (or failed with LITARA_REQUIRE_E2E=1) when no server is configured.
 */
class ConflictResolutionE2ETest {
    @get:Rule val tmp = TemporaryFolder()

    private val url = System.getenv("LITARA_E2E_URL")
    private val password = System.getenv("LITARA_E2E_PASSWORD")

    private fun client(store: CredentialStore) = LitaraClient(url, OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)

    private fun privateAccount(): LitaraClient {
        val adminCreds = InMemoryCredentialStore()
        runBlocking { client(adminCreds).login("fixture-admin", password!!, "conflict admin") }
        val probe = client(InMemoryCredentialStore())
        val libraryId = runBlocking {
            probe.login("fixture-user-a", password, "probe")
            probe.snapshot(probe.listRecordings().items.single { it.durationMs == 180_000L }.id).libraryId
        }
        val username = "cr-" + UUID.randomUUID().toString().take(8)
        val http = OkHttpClient()
        fun adminCall(method: String, path: String, json: String?) {
            val req = okhttp3.Request.Builder().url(url + path).header("Authorization", "Bearer ${adminCreds.load()!!.accessToken}")
                .method(method, json?.toRequestBody("application/json".toMediaType()) ?: if (method == "PUT") "".toRequestBody() else null).build()
            http.newCall(req).execute().use { r -> check(r.isSuccessful) { "admin $method $path -> ${r.code}" } }
        }
        adminCall("POST", "/admin/users", """{"username":"$username","displayName":"CR","password":"$password-cr","isAdmin":false}""")
        val id = runBlocking { client(InMemoryCredentialStore()).login(username, "$password-cr", "probe").user.id }
        adminCall("PUT", "/admin/users/$id/libraries/$libraryId", null)
        return client(InMemoryCredentialStore()).also { c -> runBlocking { c.login(username, "$password-cr", "conflict device") } }
    }

    @Test
    fun `an explicit position and every completion choice resolve against the real server`() = runBlocking {
        if (url == null || password == null) {
            check(System.getenv("LITARA_REQUIRE_E2E") != "1") { "LITARA_E2E_URL/LITARA_E2E_PASSWORD are required when LITARA_REQUIRE_E2E=1" }
            assumeTrue("LITARA_E2E_URL not set; real-server E2E not run", false)
        }
        val c = privateAccount()
        val rec = c.listRecordings(size = 50).items.single { it.durationMs == 180_000L }
        val snap = c.snapshot(rec.id)
        val f1 = snap.files[0]
        val f3 = snap.files[2]

        // ---- resume conflict -> the user chooses a brand-new position (file 3, 20 s) ----------------------------
        val sync = ProgressSync(c, rec.id, snap.layoutRevision, snap.files, File(tmp.root, "pending.json"))
        sync.load()
        val rev0 = sync.revision
        c.writePosition(rec.id, LPositionWrite(UUID.randomUUID().toString(), rev0, snap.layoutRevision, LPositionInput(f1.id, f1.contentVersion, 10_000, "2026-11-13T12:00:00Z")))
        try {
            c.writePosition(rec.id, LPositionWrite(UUID.randomUUID().toString(), rev0, snap.layoutRevision, LPositionInput(f1.id, f1.contentVersion, 5_000, "2026-11-13T12:00:01Z")))
            fail("stale base must conflict")
        } catch (e: LitaraHttpException) { assertEquals(409, e.status) }
        sync.load()
        val conflict = sync.conflicts.single()
        assertFalse(conflict.isCompletion)
        val state = sync.resolve(conflict.id, "use_explicit", LPositionInput(f3.id, f3.contentVersion, 20_000, "2026-11-13T12:00:02Z"))
        assertTrue(state.unresolvedConflicts.isEmpty())
        assertEquals(f3.id, state.position!!.fileId)
        assertEquals(20_000L, state.position!!.offsetMs)
        assertEquals("the explicit choice is what a fresh device now resumes from", 20_000L, c.position(rec.id).position!!.offsetMs)

        // ---- completion conflicts -----------------------------------------------------------------------------
        val cs = CompletionSync(c, rec.id, File(tmp.root, "pending-completion.json"))
        fun staleWrite(event: String, base: String) = runBlocking {
            try {
                c.writeCompletion(rec.id, LCompletionWrite(UUID.randomUUID().toString(), base, snap.layoutRevision, event, "2026-11-13T12:10:00Z", null))
                fail("a stale completion base must conflict")
            } catch (e: LitaraHttpException) {
                assertEquals(409, e.status); assertNotNull(e.problem.conflictId); e.problem.conflictId!!
            }
        }
        val base0 = c.completion(rec.id).revision
        assertTrue(c.writeCompletion(rec.id, LCompletionWrite(UUID.randomUUID().toString(), base0, snap.layoutRevision, "manual_finish", "2026-11-13T12:05:00Z", null)).finished)

        // 1) keep_server: the kept event is discarded, state unchanged.
        staleWrite("manual_unfinish", base0)
        val open1 = c.position(rec.id).unresolvedConflicts.single()
        assertTrue("completion conflicts are listed with their kept event", open1.isCompletion && open1.completionCandidate!!.event == "manual_unfinish")
        assertTrue(cs.resolve(open1.id, "keep_server", snap.layoutRevision).finished)
        assertTrue(c.position(rec.id).unresolvedConflicts.isEmpty())

        // 2) use_candidate: the kept event is applied.
        val base1 = c.completion(rec.id).revision
        staleWrite("manual_unfinish", (base1.toLong() - 1).toString())
        val open2 = c.position(rec.id).unresolvedConflicts.single()
        assertFalse(cs.resolve(open2.id, "use_candidate", snap.layoutRevision).finished)

        // 3) use_explicit: a new event the user picked (finished again) replaces the kept one.
        val base2 = c.completion(rec.id).revision
        staleWrite("manual_unfinish", (base2.toLong() - 1).toString())
        val open3 = c.position(rec.id).unresolvedConflicts.single()
        assertTrue(cs.resolve(open3.id, "use_explicit", snap.layoutRevision, "manual_finish").finished)
        assertTrue(c.position(rec.id).unresolvedConflicts.isEmpty())

        // A resolved conflict cannot be resolved twice.
        try { cs.resolve(open3.id, "keep_server", snap.layoutRevision); fail("already resolved") } catch (e: LitaraHttpException) { assertEquals(409, e.status) }
    }
}
