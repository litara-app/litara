package com.litara.feature.litara

import android.content.ComponentName
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaBrowser
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.litara.core.auth.SecureStorage
import com.litara.core.auth.SessionManager
import com.litara.core.network.CastUpstreamClient
import com.litara.feature.cast.CastProxyServer
import com.litara.feature.player.AutoBrowseTree
import com.litara.feature.player.AutoLibraryTree
import com.litara.feature.player.PlaybackService
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Android Auto and Cast against a RUNNING Litara Go server, on an emulator, through the real
 * [PlaybackService] (the same MediaLibrarySession a car connects to) and the real Cast proxy with the
 * app's real Cast upstream client. Arguments: litaraUrl, litaraPassword, litaraRecording (three-file),
 * litaraAlternate (M4B). Reported as skipped without them. Emulator/proxy level only: no Chromecast
 * receiver, no head unit.
 */
@UnstableApi
@RunWith(AndroidJUnit4::class)
class LitaraAutoCastTest {
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
            Thread.sleep(100)
        }
        fail("Timed out: $label")
    }

    @Test
    fun carBrowsesSearchesPlaysChaptersReportsProgressAndCastProxyKeepsCredentialsOnThePhone() = runBlocking<Unit> {
        val url = args.getString("litaraUrl")
        val password = args.getString("litaraPassword")
        val three = args.getString("litaraRecording")
        val alt = args.getString("litaraAlternate")
        assumeTrue("litaraUrl/litaraPassword/litaraRecording/litaraAlternate not provided; real-server Auto/Cast test not run",
            url != null && password != null && three != null && alt != null)

        val deps = EntryPointAccessors.fromApplication(context, LitaraTestDependencies::class.java)
        val repo = deps.repository()
        val backend = deps.backend()
        repo.allowProcessRestart = false
        // The test shares the app process: do not let a scope change restart (kill) it.
        deps.session().activeDataScope = null
        LitaraSessionStore(SecureStorage(context)).let { runCatching { runBlocking { repo.signOut() } }; it.forgetIdentity() }
        File(context.filesDir, "litara-offline").deleteRecursively()
        repo.signIn(url!!, true, "fixture-user-a", password!!, "Android Auto test")
        deps.session().activeDataScope = null

        // ---- the car's view: the same MediaLibrarySession the head unit connects to ----
        val cards = backend.cards()
        val handle = backend.handleFor(three!!)!!
        val altHandle = backend.handleFor(alt!!)!!
        assertTrue("both ready recordings are offered", cards.any { it.id == handle } && cards.any { it.id == altHandle })

        val browser = main {
            MediaBrowser.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java))).buildAsync()
        }.get(20, TimeUnit.SECONDS)
        try {
            val titles = main { browser.getChildren(AutoLibraryTree.TITLES, 0, 100, null) }.get(20, TimeUnit.SECONDS).value!!
            assertTrue("library > titles lists the Litara recording", titles.any { it.mediaId == AutoBrowseTree.bookMediaId(handle) })
            val found = main { browser.getSearchResult("Generated Fixture", 0, 40, null) }.get(20, TimeUnit.SECONDS).value!!
            assertTrue("search finds it", found.any { it.mediaId == AutoBrowseTree.bookMediaId(handle) })

            // Play the three-file recording the way a car tap does, streaming through the service with the bearer token.
            val bookItem = MediaItem.Builder().setMediaId(AutoBrowseTree.bookMediaId(handle)).build()
            main { browser.setMediaItem(bookItem); browser.prepare(); browser.play() }
            await("streams from the Litara server") { main { browser.isPlaying && browser.currentPosition >= 2_000 } }
            val firstFile = main { browser.currentMediaItem?.mediaId }
            assertNotNull(firstFile)

            // The car's playback reports progress to the Litara server as file/version + offset (the poller runs every 5 s).
            val client = repo.clientOrNull()!!
            val snap = client.snapshot(three)
            await("progress reported to the server") {
                runBlocking { client.position(three).position?.let { it.fileId == snap.files[0].id && it.offsetMs >= 4_000 } == true }
            }
            val state = client.position(three)
            assertEquals(snap.files[0].contentVersion, state.position!!.contentVersion)
            assertEquals("Auto never auto-picks a winner: no conflicts were created", 0, state.unresolvedConflicts.size)

            // Chapter navigation across files ("Finale" is chapter 4 = file 3 at 10 s).
            main { browser.pause() }
            val chapters = main { browser.getChildren(AutoBrowseTree.NOW_PLAYING_CHAPTERS_ID, 0, 40, null) }.get(20, TimeUnit.SECONDS).value!!
            assertEquals(4, chapters.size)
            main { browser.setMediaItem(MediaItem.Builder().setMediaId(AutoBrowseTree.chapterMediaId(handle, 3)).build()); browser.prepare(); browser.play() }
            await("chapter across file boundaries") { main { browser.currentMediaItem?.mediaId != firstFile && browser.isPlaying && browser.currentPosition >= 12_000 } }
            // R4: progress must keep flowing after chapter navigation: a newer file 3 + offset (not the old file 1 position).
            await("progress after the chapter jump reaches the server as file 3") {
                runBlocking { client.position(three).position?.let { it.fileId == snap.files[2].id && it.contentVersion == snap.files[2].contentVersion && it.offsetMs >= 10_000 } == true }
            }
            main { browser.pause() }
            val afterPause = runBlocking { client.position(three).position!! }
            assertEquals("pause reports the real file", snap.files[2].id, afterPause.fileId)
            assertEquals("a chapter jump must not make this device conflict with itself", 0, client.position(three).unresolvedConflicts.size)

            // ---- Cast: the receiver talks only to the phone's proxy; credentials stay on the phone ----
            val proxy = deps.castProxy()
            proxy.start()
            try {
                val file = snap.files[1]
                val upstreamUrl = repo.streamUrl(file)
                val plain = OkHttpClient()
                plain.newCall(Request.Builder().url(upstreamUrl).build()).execute().use {
                    assertEquals("a receiver without the bearer cannot read the server", 401, it.code)
                }
                val item = MediaItem.Builder().setMediaId("cast-mp3").setUri(upstreamUrl).setMimeType(file.mimeType).build()
                val proxied = proxy.rewriteForCast(listOf(item)).single().localConfiguration!!.uri.toString()
                assertFalse("no server credential or token appears in the receiver URL", proxied.contains(client.accessToken()!!))
                plain.newCall(Request.Builder().url(proxied).header("Range", "bytes=100-299").build()).execute().use {
                    assertEquals(206, it.code)
                    assertEquals("bytes 100-299/${file.sizeBytes}", it.header("Content-Range"))
                    val direct = runBlocking {
                        client.execute(Request.Builder().url(upstreamUrl).header("Range", "bytes=100-299")).use { d -> d.body!!.bytes() }
                    }
                    assertArrayEquals(direct, it.body!!.bytes())
                }
                // An M4B goes through the chapter filter path; the response is still the full original length.
                val altSnap = client.snapshot(alt)
                val m4b = altSnap.files.single()
                val m4bItem = MediaItem.Builder().setMediaId("cast-m4b").setUri(repo.streamUrl(m4b)).setMimeType("audio/mp4").build()
                val m4bUrl = proxy.rewriteForCast(listOf(m4bItem)).single().localConfiguration!!.uri.toString()
                plain.newCall(Request.Builder().url(m4bUrl).build()).execute().use {
                    assertEquals(200, it.code)
                    assertEquals(m4b.sizeBytes, it.body!!.bytes().size.toLong())
                }
            } finally {
                proxy.stop()
            }
        } finally {
            main { browser.release() }
        }
    }
}
