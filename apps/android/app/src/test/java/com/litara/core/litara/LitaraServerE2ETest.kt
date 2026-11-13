package com.litara.core.litara

import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertArrayEquals
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
 * Real end-to-end check: the Android-side client, downloader and account-scoped store against a RUNNING
 * Litara Go server with PostgreSQL and generated MP3 media (no mocks). It plays nothing: ExoPlayer and
 * Cast/Auto are not exercised here (see handoffs/T003.md for what is and is not verified).
 *
 * Needs LITARA_E2E_URL (for example http://127.0.0.1:18090/api/v1) and LITARA_E2E_PASSWORD (the seed's
 * synthetic password). Without them the test is reported as skipped, or fails when LITARA_REQUIRE_E2E=1.
 * Optional LITARA_E2E_MEDIA is the seeded media directory, used to compare downloads byte for byte.
 */
class LitaraServerE2ETest {
    @get:Rule val tmp = TemporaryFolder()

    private val url = System.getenv("LITARA_E2E_URL")
    private val password = System.getenv("LITARA_E2E_PASSWORD")

    private fun client(store: CredentialStore) = LitaraClient(url, OkHttpClient.Builder().retryOnConnectionFailure(false).build(), store)

    @Test
    fun `seeded three-file recording downloads, resumes, syncs progress and isolates accounts`() = runBlocking {
        if (url == null || password == null) {
            check(System.getenv("LITARA_REQUIRE_E2E") != "1") { "LITARA_E2E_URL/LITARA_E2E_PASSWORD are required when LITARA_REQUIRE_E2E=1" }
            assumeTrue("LITARA_E2E_URL not set; real-server E2E not run", false)
        }
        val credsA = InMemoryCredentialStore()
        val a = client(credsA)
        val disc = a.discover()
        assertEquals("Litara", disc.product)
        // A private account per run (admin API, explicit grant) so concurrent flavor runs never share progress state.
        val adminCreds = InMemoryCredentialStore()
        val admin = client(adminCreds)
        admin.login("fixture-admin", password!!, "Android E2E admin")
        val seedUserA = client(InMemoryCredentialStore())
        val libraryId = seedUserA.run { login("fixture-user-a", password, "probe"); snapshot(listRecordings().items.single { it.durationMs == 180_000L }.id).libraryId }
        val username = "e2e-" + UUID.randomUUID().toString().take(8)
        val http = OkHttpClient()
        fun adminCall(method: String, path: String, json: String?) {
            val req = okhttp3.Request.Builder().url(url + path).header("Authorization", "Bearer ${adminCreds.load()!!.accessToken}")
                .method(method, json?.toRequestBody("application/json".toMediaType()) ?: if (method == "PUT") "".toRequestBody() else null).build()
            http.newCall(req).execute().use { r -> check(r.isSuccessful) { "admin $method $path -> ${r.code}" } }
        }
        adminCall("POST", "/admin/users", """{"username":"$username","displayName":"E2E","password":"$password-e2e","isAdmin":false}""")
        val newUserId = client(InMemoryCredentialStore()).let { c -> c.login(username, "$password-e2e", "probe").user.id }
        adminCall("PUT", "/admin/users/$newUserId/libraries/$libraryId", null)
        val tpA = a.login(username, "$password-e2e", "Android E2E A")
        val scopeA = AccountScope(disc.serverId, tpA.user.id)

        val list = a.listRecordings(size = 50)
        val three = list.items.single { it.durationMs == 180_000L }
        val snap = a.snapshot(three.id)
        assertEquals("ready", snap.readiness)
        assertEquals(3, snap.files.size)
        assertTrue(snap.capabilities.download && snap.capabilities.wholeRecordingSeek)
        assertEquals(listOf(0L, 45_000L, 90_000L, 160_000L), snap.chapters.map { it.recordingStartMs })

        val store = OfflineStore(File(tmp.root, "offline"))
        val token = store.activate(scopeA)
        val downloader = RangeDownloader(a)
        val dir = store.publish(token) { it }
        snap.files.forEachIndexed { i, f ->
            if (i == 1) { // pre-seed an interrupted partial: resume must use Range + If-Range and append only the tail
                val part = File(dir, "${f.id}.mp3.part")
                val first = a.rawRange(f, 0, 4999)
                part.writeBytes(first)
                File(part.path + ".etag").writeText("\"${f.contentVersion}\"")
            }
            downloader.download(f, File(dir, "${f.id}.mp3"))
        }
        val media = System.getenv("LITARA_E2E_MEDIA")
        snap.files.forEachIndexed { i, f ->
            val got = File(dir, "${f.id}.mp3")
            assertEquals(f.sizeBytes, got.length())
            if (media != null) assertArrayEquals("file ${i + 1} differs from the original", File(media, "r1-part${i + 1}.mp3").readBytes(), got.readBytes())
        }

        // Revision-aware progress: accepted, retried by operation ID, stale -> durable conflict.
        val f1 = snap.files[1]
        val op = UUID.randomUUID().toString()
        val startRev = a.position(three.id).revision.toLong() // repeatable against an already-used fixture
        val write = LPositionWrite(op, startRev.toString(), snap.layoutRevision, LPositionInput(f1.id, f1.contentVersion, 30_000, "2026-11-13T12:00:00Z"))
        val st = a.writePosition(three.id, write)
        assertEquals((startRev + 1).toString(), st.revision)
        assertEquals(st, a.writePosition(three.id, write)) // identical operation -> original result
        try {
            a.writePosition(three.id, write.copy(operationId = UUID.randomUUID().toString(), position = write.position.copy(offsetMs = 1000)))
            fail("a stale base revision must conflict")
        } catch (e: LitaraHttpException) {
            assertEquals(409, e.status)
            assertEquals("position_conflict", e.problem.code)
            assertNotNull(e.problem.conflictId)
        }
        val pending = a.position(three.id)
        assertTrue(pending.unresolvedConflicts.isNotEmpty()) // recoverable after an app restart
        val resolved = a.resolveConflict(three.id, pending.unresolvedConflicts.last().id,
            LResolveConflict(UUID.randomUUID().toString(), (startRev + 1).toString(), snap.layoutRevision, "keep_server", null))
        assertEquals((startRev + 2).toString(), resolved.revision)
        assertEquals(30_000L, resolved.position!!.offsetMs)

        // Overlapping reports from one device are serialized: no self-conflicts.
        val sync = ProgressSync(a, three.id, snap.layoutRevision, snap.files, File(tmp.root, "pending.json"))
        sync.load()
        val before = sync.conflicts.size
        val results = (1..8).map { i -> async { sync.report(0, 1000L * i) } }.map { it.await() }
        assertTrue("8 concurrent reports: $results", results.all { it == ReportOutcome.Accepted })
        assertEquals(before, a.position(three.id).unresolvedConflicts.size)

        // Natural end completes only this recording.
        val last = snap.files.last()
        val done = a.writeCompletion(three.id, LCompletionWrite(UUID.randomUUID().toString(), a.completion(three.id).revision, snap.layoutRevision, "natural_end",
            "2026-11-13T12:00:00Z", LAnchor(last.id, last.contentVersion, last.durationMs!!)))
        assertTrue(done.finished)
        val alternate = a.listRecordings(completion = "finished")
        assertEquals(listOf(three.id), alternate.items.map { it.id })

        // Account B: same server, own scope. It cannot read A's recording or A's offline directory,
        // and a download A started before the switch cannot publish into B's scope.
        val credsB = InMemoryCredentialStore()
        val b = client(credsB)
        val tpB = b.login("fixture-user-b", password, "Android E2E B")
        try { b.snapshot(three.id); fail("B has no grant on A's library") } catch (e: LitaraHttpException) { assertEquals(403, e.status) }
        val inFlight = store.begin()
        val tokenB = store.activate(AccountScope(disc.serverId, tpB.user.id))
        try { store.publish(inFlight) { File(it, "late.bin").writeText("x") }; fail() } catch (e: StaleScopeException) { /* expected */ }
        assertFalse(File(store.dir(AccountScope(disc.serverId, tpB.user.id)), "${snap.files[0].id}.mp3").exists())
        store.read(tokenB) { assertEquals(0, it.listFiles()!!.size) }

        // Logout revokes the device session server-side and clears local credentials.
        a.logout()
        assertEquals(null, credsA.load())
        try { b.snapshot(three.id) } catch (e: LitaraHttpException) { /* still 403 for B */ }
        Unit
    }

    private suspend fun LitaraClient.rawRange(f: LFile, from: Long, to: Long): ByteArray {
        val req = okhttp3.Request.Builder().url(serverUrl(f.contentPath)).header("Range", "bytes=$from-$to")
        execute(req).use { r ->
            assertEquals(206, r.code)
            return r.body!!.bytes()
        }
    }
}
