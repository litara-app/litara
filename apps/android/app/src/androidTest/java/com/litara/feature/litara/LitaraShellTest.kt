package com.litara.feature.litara

import android.content.ComponentName
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaBrowser
import androidx.media3.session.SessionToken
import androidx.test.platform.app.InstrumentationRegistry
import com.litara.app.MainActivity
import com.litara.core.auth.SecureStorage
import com.litara.feature.player.AutoBrowseTree
import com.litara.feature.player.PlaybackService
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * The phone app for a signed-in Litara account, through the REAL launcher activity: the Litara shell
 * replaces the BookOrbit shell, lists recordings, downloads one (Downloads tab, offline copy), plays it
 * through the shared player (progress reaches the server), shows the offline copy in Android Auto's
 * "Downloaded" shelf, and deletes it again. Arguments: litaraUrl, litaraPassword, litaraRecording.
 */
@UnstableApi
@OptIn(ExperimentalTestApi::class)
class LitaraShellTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val args = InstrumentationRegistry.getArguments()

    private val signIn = object : ExternalResource() {
        override fun before() {
            val url = args.getString("litaraUrl")
            val password = args.getString("litaraPassword")
            assumeTrue("litaraUrl/litaraPassword/litaraRecording not provided; real-server shell test not run",
                url != null && password != null && args.getString("litaraRecording") != null)
            val deps = EntryPointAccessors.fromApplication(context, LitaraTestDependencies::class.java)
            // Same process as the app: a scope change must not kill the test run.
            deps.session().activeDataScope = null
            runCatching { runBlocking { deps.repository().signOut() } }
            LitaraSessionStore(SecureStorage(context)).forgetIdentity()
            File(context.filesDir, "litara-offline").deleteRecursively()
            runBlocking { deps.repository().signIn(url!!, true, "fixture-user-a", password!!, "Shell test") }
            deps.session().activeDataScope = null
        }
    }
    private val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule val chain: RuleChain = RuleChain.outerRule(signIn).around(compose)

    private fun <T> main(block: () -> T): T {
        val result = AtomicReference<T>()
        instrumentation.runOnMainSync { result.set(block()) }
        return result.get()
    }

    private fun present(tag: String) = compose.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()

    private fun waitTag(tag: String, ms: Long = 30_000) {
        try { compose.waitUntil(ms) { present(tag) } } catch (e: androidx.compose.ui.test.ComposeTimeoutException) {
            val err = if (present(LitaraTags.ERROR)) "an error is shown" else "no error shown"
            throw AssertionError("tag $tag never appeared ($err)", e)
        }
    }

    @Test
    fun shellListsDownloadsPlaysAndExposesTheOfflineCopyToAuto() = runBlocking<Unit> {
        val recording = args.getString("litaraRecording")!!
        val deps = EntryPointAccessors.fromApplication(context, LitaraTestDependencies::class.java)
        val handle = deps.backend().handleFor(recording)!!

        // 1. The launcher shows the Litara shell, not the BookOrbit server-setup flow.
        waitTag(ShellTags.recording(recording))
        compose.onNodeWithTag(ShellTags.recording(recording)).performClick()
        waitTag(ShellTags.DETAIL_TITLE)
        waitTag(LitaraTags.chapter("Finale"))

        // 2. Download from the detail screen; the Downloads tab lists the offline copy.
        compose.onNodeWithTag(ShellTags.DOWNLOAD).performClick()
        compose.waitUntil(60_000) { runCatching { deps.repository().downloaded(recording) }.getOrNull() != null && present(ShellTags.DELETE_DOWNLOAD) }
        compose.onNodeWithTag(ShellTags.TAB_DOWNLOADS).performClick()
        waitTag(ShellTags.download(recording))

        // 3. Android Auto's "Downloaded" shelf includes the Litara offline copy.
        val browser = main {
            MediaBrowser.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java))).buildAsync()
        }.get(20, TimeUnit.SECONDS)
        try {
            val shelf = main { browser.getChildren(AutoBrowseTree.DOWNLOADS_ID, 0, 100, null) }.get(20, TimeUnit.SECONDS).value!!
            assertTrue("Downloaded shelf lists the Litara recording", shelf.any { it.mediaId == AutoBrowseTree.bookMediaId(handle) })

            // 4. Play from the Library through the shared player; progress reaches the server (revision-aware sync).
            // Start from a known place: earlier tests may have left the saved position at the end of the book.
            val client0 = deps.repository().clientOrNull()!!
            runBlocking { deps.repository().progress(client0.snapshot(recording)).also { it.load() }.report(0, 500) }
            compose.onNodeWithTag(ShellTags.TAB_LIBRARY).performClick()
            waitTag(ShellTags.recording(recording))
            compose.onNodeWithTag(ShellTags.recording(recording)).performClick()
            waitTag(ShellTags.PLAY)
            compose.onNodeWithTag(ShellTags.PLAY).performClick()
            val client = deps.repository().clientOrNull()!!
            val snap = client.snapshot(recording)
            compose.waitUntil(45_000) { runBlocking { client.position(recording).position?.let { it.fileId == snap.files[0].id && it.offsetMs >= 3_000 } == true } }
            assertEquals("no conflicts from the phone's own playback", 0, client.position(recording).unresolvedConflicts.size)

            // 5. Deleting the download removes it from the tab and from Auto's shelf; the bytes are gone.
            instrumentation.runOnMainSync { compose.activity.onBackPressedDispatcher.onBackPressed() } // leave the player
            compose.onNodeWithTag(ShellTags.TAB_DOWNLOADS).performClick()
            waitTag(ShellTags.download(recording))
            compose.onNodeWithTag(ShellTags.DELETE_DOWNLOAD).performClick()
            compose.waitUntil(20_000) { present(ShellTags.EMPTY_DOWNLOADS) }
            assertTrue(deps.repository().downloadedRecordings().isEmpty())
            val after = main { browser.getChildren(AutoBrowseTree.DOWNLOADS_ID, 0, 100, null) }.get(20, TimeUnit.SECONDS).value!!
            assertFalse(after.any { it.mediaId == AutoBrowseTree.bookMediaId(handle) })
        } finally {
            main { browser.release() }
        }

        // 6. The Account tab offers sign-out (not clicked: sign-out restarts the process).
        compose.onNodeWithTag(ShellTags.TAB_ACCOUNT).performClick()
        waitTag(ShellTags.SIGN_OUT)
    }
}
