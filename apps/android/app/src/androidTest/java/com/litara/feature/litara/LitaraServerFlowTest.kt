package com.litara.feature.litara

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import com.litara.app.MainActivity
import com.litara.core.auth.SecureStorage
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/**
 * Real-UI end-to-end on an emulator against a RUNNING Litara Go server with generated MP3 media:
 * sign in through the app's own sign-in screen, open the seeded three-file recording, stream it through
 * ExoPlayer with a bearer token and ranged requests, download it, play it from the downloaded files to its
 * natural end, and observe the completion on the server. Needs instrumentation arguments litaraUrl (for
 * example http://10.0.2.2:18090), litaraPassword and litaraRecording (the three-file recording id).
 * Reported as skipped when absent. It runs on an emulator only: it says nothing about Chromecast,
 * Android Auto or a head unit.
 */
@OptIn(ExperimentalTestApi::class)
class LitaraServerFlowTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val args = InstrumentationRegistry.getArguments()
    private val deps by lazy { EntryPointAccessors.fromApplication(context, LitaraTestDependencies::class.java) }

    // Start every run signed out: a stale session from an earlier run against a reset server must not leak in.
    private val clean = object : org.junit.rules.ExternalResource() {
        override fun before() {
            deps.repository().allowProcessRestart = false
            deps.dataScope().active = null
            onMain { deps.player().stop() }
            runCatching { runBlocking { deps.repository().signOut() } }
            LitaraSessionStore(SecureStorage(context)).forgetIdentity()
            java.io.File(context.filesDir, "litara-offline").deleteRecursively()
        }
    }

    @get:Rule val chain: org.junit.rules.RuleChain = org.junit.rules.RuleChain.outerRule(clean).around(compose)

    private fun onMain(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(block)

    private fun present(tag: String) = compose.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()

    private fun waitTag(tag: String, ms: Long = 30_000) {
        try {
            compose.waitUntil(ms) { present(tag) }
        } catch (e: androidx.compose.ui.test.ComposeTimeoutException) {
            throw AssertionError("tag $tag never appeared (${if (present(LitaraTags.ERROR)) "an error is shown" else "no error shown"})", e)
        }
    }

    private fun waitPlaying(label: String, ms: Long, untilSec: Double) {
        try {
            compose.waitUntil(ms) { deps.player().state.value.let { it.isPlaying && it.positionSec >= untilSec } }
        } catch (e: androidx.compose.ui.test.ComposeTimeoutException) {
            val s = deps.player().state.value
            throw AssertionError("$label: position ${s.positionSec} s, playing ${s.isPlaying}, buffering ${s.buffering}, error ${s.playerError}", e)
        }
    }

    @Test
    fun signInStreamDownloadPlayToNaturalEnd() {
        val url = args.getString("litaraUrl")
        val password = args.getString("litaraPassword")
        val recording = args.getString("litaraRecording")
        assumeTrue("litaraUrl/litaraPassword/litaraRecording not provided; real-server UI flow not run", url != null && password != null && recording != null)

        waitTag(LitaraTags.URL)
        compose.onNodeWithTag(LitaraTags.URL).performTextInput(url!!)
        compose.onNodeWithTag(LitaraTags.INSECURE).performClick() // explicit development opt-in for plain HTTP
        compose.onNodeWithTag(LitaraTags.USER).performTextInput("fixture-user-a")
        compose.onNodeWithTag(LitaraTags.PASSWORD).performTextInput(password!!)
        compose.onNodeWithTag(LitaraTags.SIGN_IN).performScrollTo().performClick()

        waitTag(ShellTags.recording(recording!!))
        deps.dataScope().active = null
        val client = deps.repository().clientOrNull()!!
        val snap = runBlocking { client.snapshot(recording) }
        // A known start: the seeded server keeps what earlier runs left.
        runBlocking {
            if (snap.completion.finished) deps.repository().finish(snap, "manual_unfinish", null)
            deps.repository().progress(snap).also { it.load() }.report(0, 500)
        }
        compose.onNodeWithTag(ShellTags.recording(recording)).performClick()
        waitTag(LitaraTags.chapter("Finale"))
        val finaleSec = snap.chapters.first { it.label == "Finale" }.recordingStartMs!! / 1000.0

        // 1. Stream (bearer + ranged requests through ExoPlayer) from the last chapter and watch time advance.
        compose.onNodeWithTag(ShellTags.PLAY).performClick()
        waitPlaying("playback did not start", 40_000, 0.0)
        onMain { deps.player().seekToAbsolute(finaleSec) }
        waitPlaying("streaming did not advance in file 3", 40_000, finaleSec + 2)
        onMain { deps.player().togglePlay() } // pause -> position is reported to the server
        onMain { deps.player().stop() }

        // 2. Download, then play the downloaded files to their natural end.
        onMain { compose.activity.onBackPressedDispatcher.onBackPressed() }
        waitTag(ShellTags.DOWNLOAD)
        compose.onNodeWithTag(ShellTags.DOWNLOAD).performClick()
        compose.waitUntil(60_000) { runCatching { deps.repository().downloaded(recording) }.getOrNull() != null && present(ShellTags.DELETE_DOWNLOAD) }
        val handle = deps.backend().handleFor(recording)!!
        val uris = runBlocking { deps.backend().playback(handle)!!.uris }
        assertTrue("playback uses the downloaded files: $uris", uris.all { it.startsWith("file:") })
        compose.onNodeWithTag(ShellTags.PLAY).performClick()
        waitPlaying("downloaded playback did not start", 40_000, 0.0)
        onMain { deps.player().seekToAbsolute(finaleSec) }
        compose.waitUntil(60_000) { runBlocking { client.snapshot(recording).completion.finished } }
    }
}
