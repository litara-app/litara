package com.litara.feature.litara

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.litara.core.auth.SecureStorage
import com.litara.core.litara.LitaraJson
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.atomic.AtomicReference

/**
 * Listening sessions (ADR-0109) and audiobook bookmarks (ADR-0110) against a RUNNING Litara server: the phone player
 * plays a real recording, and the app's own bookmark repository creates, renames and deletes a bookmark. Arguments:
 * litaraUrl, litaraPassword, litaraRecording. Reported as skipped without them.
 */
@RunWith(AndroidJUnit4::class)
class LitaraListeningBookmarksTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val args = InstrumentationRegistry.getArguments()

    private fun <T> main(block: () -> T): T {
        val result = AtomicReference<T>()
        instrumentation.runOnMainSync { result.set(block()) }
        return result.get()
    }

    private fun await(label: String, ms: Long = 40_000, predicate: () -> Boolean) {
        val deadline = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < deadline) {
            if (predicate()) return
            Thread.sleep(250)
        }
        fail("Timed out: $label")
    }

    @Test
    fun playingRecordsListeningAndBookmarksReachTheServer() = runBlocking<Unit> {
        val url = args.getString("litaraUrl")
        val password = args.getString("litaraPassword")
        val recording = args.getString("litaraRecording")
        assumeTrue("litaraUrl/litaraPassword/litaraRecording not provided", url != null && password != null && recording != null)

        val deps = EntryPointAccessors.fromApplication(context, LitaraTestDependencies::class.java)
        val repo = deps.repository()
        repo.allowProcessRestart = false
        deps.dataScope().active = null
        LitaraSessionStore(SecureStorage(context)).let { runCatching { runBlocking { repo.signOut() } }; it.forgetIdentity() }
        File(context.filesDir, "litara-offline").deleteRecursively()
        repo.signIn(url!!, true, "fixture-user-a", password!!, "Listening test")
        deps.dataScope().active = null
        val client = repo.clientOrNull()!!

        suspend fun items(path: String): List<JsonObject> {
            val text = client.execute(Request.Builder().url(client.url(path)).get()).use { it.body!!.string() }
            return LitaraJson.parseToJsonElement(text).jsonObject["items"]!!.jsonArray.map { it.jsonObject }
        }

        deps.backend().cards()
        val handle = deps.backend().handleFor(recording!!)!!
        val player = deps.player()
        val titleId = client.snapshot(recording).titleId

        // All tests share one process. One that played this recording earlier leaves its session open, and playing
        // again within 30 minutes rightly continues it. End it here, so this test measures a session of its own.
        main { player.stop() }
        Thread.sleep(1_000)

        main { player.loadAndPlay(handle) }
        await("playback starts") { player.state.value.isPlaying }
        // An earlier test may also have left the saved position near the end.
        main { player.seekToAbsolute(0.0) }
        await("playback restarts from the beginning") { player.state.value.isPlaying && player.state.value.positionSec < 5 }
        // Sessions that began before this moment belong to earlier tests, whenever they reach the server.
        main { player.togglePlay() }
        await("playback pauses before measuring") { !player.state.value.isPlaying }
        main { player.stop() }
        Thread.sleep(1_000)
        val startedAfter = java.time.Instant.now()
        suspend fun ownSessions() = items("/titles/$titleId/listening-sessions?size=200")
            .filter { !java.time.Instant.parse(it["startedAt"]!!.jsonPrimitive.content).isBefore(startedAfter) }

        main { player.loadAndPlay(handle) }
        await("playback starts") { player.state.value.isPlaying }
        Thread.sleep(16_000)
        main { player.togglePlay() }
        await("playback pauses") { !player.state.value.isPlaying }
        val deadline = System.currentTimeMillis() + 40_000
        while (ownSessions().isEmpty()) {
            if (System.currentTimeMillis() > deadline) {
                val queued = File(context.filesDir, "litara-offline").walkTopDown().filter { it.parentFile?.name == "sessions" }.map { it.readText() }.toList()
                fail("the listening session did not reach the server; queued=$queued position=${player.state.value.positionSec} book=${player.state.value.currentBook?.id} handle=$handle")
            }
            Thread.sleep(500)
        }
        val heard = ownSessions().single()
        val seconds = heard["listenedSeconds"]!!.jsonPrimitive.content.toInt()
        // The first player report can come up to five seconds after play starts.
        assertTrue("about 16 s were played, recorded $seconds", seconds in 8..20)
        assertEquals(recording, heard["recordingId"]!!.jsonPrimitive.content)

        val bookmarks = deps.audioBookmarks()
        val made = bookmarks.add(handle, 5.0, "from the phone")
        assertTrue(made.available)
        assertEquals(5_000L, made.positionMs)
        suspend fun serverNotes() = items("/recordings/$recording/bookmarks?size=200").map { it["data"]!!.jsonObject["note"]!!.jsonPrimitive.content }
        assertTrue(serverNotes().contains("from the phone"))
        bookmarks.rename(handle, made.id, "renamed on the phone")
        assertTrue(serverNotes().contains("renamed on the phone"))
        assertEquals("renamed on the phone", bookmarks.list(handle).single { it.id == made.id }.title)
        bookmarks.delete(handle, made.id)
        assertTrue(bookmarks.list(handle).none { it.id == made.id })
        assertTrue(!serverNotes().contains("renamed on the phone"))
        main { player.stop() }
        Unit
    }
}
