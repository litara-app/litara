package com.litara.feature.litara

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import dagger.hilt.android.EntryPointAccessors
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/**
 * Real-UI end-to-end on an emulator against a RUNNING Litara Go server with generated MP3 media:
 * sign in, open the seeded three-file recording, stream it through ExoPlayer with a bearer token and
 * ranged requests, download it, play it from the downloaded files to its natural end, and observe the
 * completion. Needs instrumentation arguments litaraUrl (for example http://10.0.2.2:18090),
 * litaraPassword and litaraRecording (the three-file recording id). Reported as skipped when absent.
 * It runs on an emulator only: it says nothing about Chromecast, Android Auto or a head unit.
 */
@OptIn(ExperimentalTestApi::class)
class LitaraServerFlowTest {
    private val compose = createAndroidComposeRule<LitaraActivity>()

    // Start every run signed out: a stale session from an earlier run against a reset server must not leak in.
    private val clean = object : org.junit.rules.ExternalResource() {
        override fun before() {
            val ctx = InstrumentationRegistry.getInstrumentation().targetContext
            EntryPointAccessors.fromApplication(ctx, LitaraTestDependencies::class.java).repository().allowProcessRestart = false
            LitaraSessionStore(com.litara.core.auth.SecureStorage(ctx)).forgetIdentity()
            java.io.File(ctx.filesDir, "litara-offline").deleteRecursively()
        }
    }

    @get:Rule val chain: org.junit.rules.RuleChain = org.junit.rules.RuleChain.outerRule(clean).around(compose)
    private val rule get() = compose

    private val args = InstrumentationRegistry.getArguments()

    private fun text(tag: String): String =
        rule.onNodeWithTag(tag).fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.joinToString { it.text }.orEmpty()

    private fun waitTag(tag: String, ms: Long = 30_000) {
        try {
            rule.waitUntil(ms) { rule.onAllNodesWithTagSafe(tag) }
        } catch (e: androidx.compose.ui.test.ComposeTimeoutException) {
            val err = if (rule.onAllNodesWithTagSafe(LitaraTags.ERROR)) text(LitaraTags.ERROR) else "(no error shown)"
            throw AssertionError("tag $tag never appeared; UI error: $err", e)
        }
    }

    private fun androidx.compose.ui.test.junit4.AndroidComposeTestRule<*, *>.onAllNodesWithTagSafe(tag: String) =
        onAllNodes(androidx.compose.ui.test.hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()

    @Test
    fun signInStreamDownloadPlayToNaturalEnd() {
        val url = args.getString("litaraUrl")
        val password = args.getString("litaraPassword")
        val recording = args.getString("litaraRecording")
        assumeTrue("litaraUrl/litaraPassword/litaraRecording not provided; real-server UI flow not run", url != null && password != null && recording != null)

        rule.onNodeWithTag(LitaraTags.URL).performTextInput(url!!)
        rule.onNodeWithTag(LitaraTags.INSECURE).performClick() // explicit development opt-in for plain HTTP
        rule.onNodeWithTag(LitaraTags.USER).performTextInput("fixture-user-a")
        rule.onNodeWithTag(LitaraTags.PASSWORD).performTextInput(password!!)
        rule.onNodeWithTag(LitaraTags.SIGN_IN).performClick()

        waitTag(LitaraTags.recording(recording!!))
        rule.onNodeWithTag(LitaraTags.recording(recording)).performClick()
        waitTag(LitaraTags.chapter("Finale"))

        // 1. Stream (bearer + ranged requests through ExoPlayer) from the last chapter and watch time advance.
        rule.onNodeWithTag(LitaraTags.chapter("Finale")).performClick()
        rule.onNodeWithTag(LitaraTags.PLAY).performClick()
        rule.waitUntil(40_000) { text(LitaraTags.POSITION).startsWith("file 3") && offsetSeconds() >= 12 }
        rule.onNodeWithTag(LitaraTags.PLAY).performClick() // pause -> position is reported to the server

        // 2. Download, then play the downloaded files to their natural end.
        rule.onNodeWithTag(LitaraTags.DOWNLOAD).performClick()
        rule.waitUntil(60_000) { text(LitaraTags.DOWNLOAD).contains("Downloaded") }
        rule.onNodeWithTag(LitaraTags.chapter("Finale")).performClick()
        rule.onNodeWithTag(LitaraTags.PLAY).performClick()
        waitTag(LitaraTags.FINISHED, 60_000)
        assertTrue(text(LitaraTags.STATUS).isNotEmpty())
    }

    private fun offsetSeconds(): Long =
        Regex("""@ (\d+)s""").find(text(LitaraTags.POSITION))?.groupValues?.get(1)?.toLong() ?: 0
}
