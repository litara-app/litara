package com.litara.feature.litara

import android.content.ComponentName
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
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
 * Resolving conflicts in the phone UI, through the REAL launcher activity against a real server: a resume
 * conflict is answered by choosing a brand-new position (file 3, 20 s), and a completion conflict is answered
 * by setting the finished state explicitly. Another device is simulated by a second client of the same user.
 * Arguments: litaraUrl, litaraPassword, litaraRecording.
 */
@UnstableApi
@OptIn(ExperimentalTestApi::class)
class LitaraConflictUiTest {
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
            deps.repository().allowProcessRestart = false
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
    fun aResumeConflictIsResolvedByChoosingAPositionAndACompletionConflictByAnExplicitState() = runBlocking<Unit> {
        val recording = args.getString("litaraRecording")!!
        val url = args.getString("litaraUrl")!!
        val deps = EntryPointAccessors.fromApplication(context, LitaraTestDependencies::class.java)
        val phone = deps.repository().clientOrNull()!!
        val other = com.litara.core.litara.LitaraClient(url.trimEnd('/') + "/api/v1", okhttp3.OkHttpClient.Builder().retryOnConnectionFailure(false).build(), com.litara.core.litara.InMemoryCredentialStore())
        other.login("fixture-user-a", args.getString("litaraPassword")!!, "Other device")
        val snap = phone.snapshot(recording)
        val f1 = snap.files[0]
        val f3 = snap.files[2]
        fun stamp() = java.time.Instant.now().toString()

        // A resume conflict: the other device wrote first, then this phone wrote from the older revision.
        val rev = phone.position(recording).revision
        other.writePosition(recording, com.litara.core.litara.LPositionWrite(java.util.UUID.randomUUID().toString(), rev, snap.layoutRevision,
            com.litara.core.litara.LPositionInput(f1.id, f1.contentVersion, 12_000, stamp())))
        try {
            phone.writePosition(recording, com.litara.core.litara.LPositionWrite(java.util.UUID.randomUUID().toString(), rev, snap.layoutRevision,
                com.litara.core.litara.LPositionInput(f1.id, f1.contentVersion, 3_000, stamp())))
            throw AssertionError("expected a conflict")
        } catch (e: com.litara.core.litara.LitaraHttpException) { assertEquals(409, e.status) }
        assertEquals(1, phone.position(recording).unresolvedConflicts.size)

        waitTag(ShellTags.recording(recording))
        compose.onNodeWithTag(ShellTags.recording(recording)).performClick()
        waitTag(ConflictTags.CHOOSE)
        compose.onNodeWithTag(ConflictTags.CHOOSE).performClick()
        waitTag(ConflictTags.file(2))
        compose.onNodeWithTag(ConflictTags.file(2)).performClick()
        compose.onNodeWithTag(ConflictTags.EXPLICIT_SECONDS).performTextReplacement("20")
        compose.onNodeWithTag(ConflictTags.EXPLICIT_CONFIRM).performClick()
        compose.waitUntil(20_000) { !present(ConflictTags.EXPLICIT_CONFIRM) && present(ShellTags.PLAY) }
        val resolved = phone.position(recording)
        assertEquals(0, resolved.unresolvedConflicts.size)
        assertEquals(f3.id, resolved.position!!.fileId)
        assertEquals(20_000L, resolved.position!!.offsetMs)

        // A completion conflict: the other device changed the state, then this phone wrote the opposite from the old revision.
        instrumentation.runOnMainSync { compose.activity.onBackPressedDispatcher.onBackPressed() }
        val before = phone.completion(recording)
        val first = if (before.finished) "manual_unfinish" else "manual_finish"
        val second = if (before.finished) "manual_finish" else "manual_unfinish"
        other.writeCompletion(recording, com.litara.core.litara.LCompletionWrite(java.util.UUID.randomUUID().toString(), before.revision, snap.layoutRevision, first, stamp(), null))
        try {
            phone.writeCompletion(recording, com.litara.core.litara.LCompletionWrite(java.util.UUID.randomUUID().toString(), before.revision, snap.layoutRevision, second, stamp(), null))
            throw AssertionError("expected a completion conflict")
        } catch (e: com.litara.core.litara.LitaraHttpException) { assertEquals(409, e.status) }
        assertTrue(phone.position(recording).unresolvedConflicts.single().isCompletion)

        waitTag(ShellTags.recording(recording))
        compose.onNodeWithTag(ShellTags.recording(recording)).performClick()
        waitTag(ConflictTags.COMPLETION_FINISHED)
        compose.onNodeWithTag(ConflictTags.COMPLETION_FINISHED).performClick()
        compose.waitUntil(20_000) { !present(ConflictTags.COMPLETION_FINISHED) }
        assertTrue("the explicit choice is what the server now holds", phone.completion(recording).finished)
        assertEquals(0, phone.position(recording).unresolvedConflicts.size)
    }
}
