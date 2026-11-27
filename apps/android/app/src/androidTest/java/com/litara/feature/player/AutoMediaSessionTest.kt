package com.litara.feature.player

import android.content.ComponentName
import android.media.browse.MediaBrowser as PlatformBrowser
import android.media.session.MediaController as PlatformController
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaBrowser
import androidx.media3.session.MediaController
import androidx.media3.session.SessionError
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.litara.core.auth.SecureStorage
import com.litara.feature.litara.LitaraSessionStore
import com.litara.feature.litara.LitaraTestDependencies
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * The real service and the platform voice bridge a car uses, without opening a phone screen: search support, shelf
 * order, play-from-search at the book's saved speed, chapters across files, a refused selection, and resuming from an
 * empty queue. Needs a running seeded server: litaraUrl, litaraPassword, litaraRecording (the three-file one).
 */
@UnstableApi
@RunWith(AndroidJUnit4::class)
class AutoMediaSessionTest {
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

    @Test fun voiceSearchSavedSpeedChaptersRefusedSelectionAndResumption() = runBlocking<Unit> {
        val url = args.getString("litaraUrl")
        val password = args.getString("litaraPassword")
        val recording = args.getString("litaraRecording")
        assumeTrue("litaraUrl/litaraPassword/litaraRecording not provided; real-server car test not run",
            url != null && password != null && recording != null)

        val deps = EntryPointAccessors.fromApplication(context, LitaraTestDependencies::class.java)
        val repo = deps.repository()
        repo.allowProcessRestart = false
        deps.dataScope().active = null
        main { deps.player().stop() }.join()
        LitaraSessionStore(SecureStorage(context)).let { runCatching { runBlocking { repo.signOut() } }; it.forgetIdentity() }
        File(context.filesDir, "litara-offline").deleteRecursively()
        repo.signIn(url!!, true, "fixture-user-a", password!!, "Car test")
        deps.dataScope().active = null

        val backend = deps.backend()
        val card = backend.cards().first { it.id == backend.handleFor(recording!!) }
        val handle = card.id
        val title = card.title!!
        val client = repo.clientOrNull()!!
        val service = EntryPointAccessors.fromApplication(context, AutoTestDependencies::class.java)
        val snap = client.snapshot(recording!!)
        val settings = AudioSettingsStore(context)
        val oldBookSpeed = settings.bookSpeed(handle)
        settings.saveBookSpeed(handle, 1.5f)
        // A known start: earlier tests may have left the book finished and its saved position at the end.
        if (snap.completion.finished) repo.finish(snap, "manual_unfinish", null)
        repo.progress(snap).also { it.load() }.report(0, 500)

        val failure = AtomicReference<SessionError?>()
        var browser: MediaBrowser? = null
        var legacy: PlatformBrowser? = null
        try {
            val listener = object : MediaBrowser.Listener {
                override fun onError(controller: MediaController, sessionError: SessionError) { failure.set(sessionError) }
            }
            val car = main {
                MediaBrowser.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java)))
                    .setListener(listener).buildAsync()
            }.get(20, TimeUnit.SECONDS)
            browser = car
            val root = main { car.getLibraryRoot(null) }.get(10, TimeUnit.SECONDS)
            assertTrue(root.params!!.extras.getBoolean("android.media.browse.SEARCH_SUPPORTED"))
            val shelves = main { car.getChildren(AutoBrowseTree.ROOT_ID, 0, Int.MAX_VALUE, null) }.get(10, TimeUnit.SECONDS).value!!
            assertEquals(AutoBrowseTree.CONTINUE_ID, shelves.first().mediaId)
            val modes = main { car.getChildren(AutoBrowseTree.LIBRARY_ID, 0, Int.MAX_VALUE, null) }.get(10, TimeUnit.SECONDS).value!!
            assertEquals(listOf(AutoLibraryTree.TITLES, AutoLibraryTree.AUTHORS, AutoLibraryTree.SERIES), modes.map { it.mediaId })

            // Android Auto uses the platform/legacy transport path for play-from-search.
            val connected = CountDownLatch(1)
            val platform = main {
                PlatformBrowser(context, ComponentName(context, PlaybackService::class.java),
                    object : PlatformBrowser.ConnectionCallback() {
                        override fun onConnected() { connected.countDown() }
                    }, null).also { it.connect() }
            }
            legacy = platform
            assertTrue(connected.await(10, TimeUnit.SECONDS))
            main { PlatformController(context, platform.sessionToken).transportControls.playFromSearch(title, null) }
            await("voice playback at the saved speed") {
                main { car.mediaItemCount > 0 && car.isPlaying && car.playbackParameters.speed == 1.5f }
            }
            main { car.pause() }
            val firstFile = main { car.currentMediaItem?.mediaId }

            val chapters = main { car.getChildren(AutoBrowseTree.NOW_PLAYING_CHAPTERS_ID, 0, 40, null) }.get(20, TimeUnit.SECONDS).value!!
            assertEquals(4, chapters.size)
            main { car.setMediaItem(MediaItem.Builder().setMediaId(AutoBrowseTree.chapterMediaId(handle, 3)).build()); car.prepare(); car.play() }
            await("chapter across file boundaries") { main { car.currentMediaItem?.mediaId != firstFile && car.isPlaying && car.currentPosition >= 11_000 } }
            val lastFile = main { car.currentMediaItem?.mediaId }
            await("the new place reaches the server") {
                runBlocking { client.position(recording).position?.let { it.fileId == snap.files[2].id && it.offsetMs >= 10_000 } == true }
            }
            main { car.pause() }

            main { car.setMediaItem(MediaItem.Builder().setMediaId("book/0").build()) }
            await("a refused selection reports an error") { failure.get() != null }
            assertTrue(failure.get()!!.message.isNotBlank())
            // Read the service's own player: the controller shows a requested item before the service answers.
            await("a refused selection keeps the current queue") {
                main { service.activeBookPlayer().current?.currentMediaItem?.mediaId == lastFile }
            }

            assertFalse("unfinished before the queue is cleared", client.snapshot(recording).completion.finished)
            main { car.clearMediaItems() }
            await("queue cleared before resumption") { main { car.mediaItemCount == 0 } }
            Thread.sleep(3_000) // time for a wrongly sent completion to arrive
            assertFalse("clearing the queue must not finish the book", client.snapshot(recording).completion.finished)
            failure.set(null)
            main { car.play() }
            try {
                await("playing again from an empty queue, where it left off") {
                    main { car.currentMediaItem?.mediaId == lastFile && car.isPlaying && car.currentPosition >= 9_000 }
                }
            } catch (e: AssertionError) {
                val history = service.database().audioProgressDao().recent().map { "${it.bookId}:file=${it.currentFileId},s=${it.positionSeconds},pct=${it.percentage},at=${it.updatedAt}" }
                val seen = main {
                    val player = service.activeBookPlayer().current
                    "car item=${car.currentMediaItem?.mediaId} items=${car.mediaItemCount} playing=${car.isPlaying} at=${car.currentPosition}; " +
                        "player item=${player?.currentMediaItem?.mediaId} file at=${player?.filePositionMs()}"
                }
                val server = client.position(recording).position
                throw AssertionError("${e.message}; wanted item=$lastFile handle=$handle; $seen; server=${server?.fileId} ${server?.offsetMs}; third file=${snap.files[2].id}; history=$history; error=${failure.get()?.message}", e)
            }
            main { car.pause() }
        } finally {
            main { deps.player().stop() }.join()
            main { browser?.stop(); browser?.clearMediaItems(); browser?.release(); legacy?.disconnect() }
            settings.saveBookSpeed(handle, oldBookSpeed)
        }
    }
}
