package com.litara.feature.litara

import android.os.ParcelFileDescriptor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import com.litara.app.MainActivity
import com.litara.core.auth.SecureStorage
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import java.io.File

/** Explicit emulator-only integration test. Requires a synthetic EPUB and resets this test app's local state. */
class LitaraOfflineBookUiTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val args = InstrumentationRegistry.getArguments()
    private val deps get() = EntryPointAccessors.fromApplication(context, LitaraTestDependencies::class.java)
    private val compose = createAndroidComposeRule<MainActivity>()

    private val signIn = object : ExternalResource() {
        override fun before() {
            val url = args.getString("litaraBookUrl")
            val username = args.getString("litaraBookUser")
            val password = args.getString("litaraBookPassword")
            assumeTrue("Requires the disposable emulator and book stack",
                args.getString("litaraOfflineEmulator") == "true" &&
                    android.os.Build.HARDWARE in setOf("ranchu", "goldfish") &&
                    url != null && username != null && password != null)
            val repo = deps.repository()
            repo.allowProcessRestart = false
            deps.session().activeDataScope = null
            runCatching { runBlocking { repo.signOut() } }
            LitaraSessionStore(SecureStorage(context)).forgetIdentity()
            File(context.filesDir, "litara-offline").deleteRecursively()
            runBlocking { repo.signIn(url!!, true, username!!, password!!, "Offline book test") }
            deps.session().activeDataScope = null
        }
    }

    @get:Rule val chain: RuleChain = RuleChain.outerRule(signIn).around(compose)

    private fun shell(command: String) {
        ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(command)).use {
            it.readBytes()
        }
    }

    private fun waitTag(tag: String) = compose.waitUntil(30_000) {
        compose.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()
    }

    @Test fun opensACompletedDownloadWithTheNetworkOff() = runBlocking<Unit> {
        val repo = deps.repository()
        val edition = repo.editions().first { it.file.format == "epub" && bookDownloadable(it) }
        val title = repo.titles().first { it.id == edition.titleId }.title
        waitTag(ShellTags.TAB_BOOKS)
        compose.onNodeWithTag(ShellTags.TAB_BOOKS).performClick()
        waitTag(ShellTags.bookDownload(edition.id))
        compose.onNodeWithTag(ShellTags.bookDownload(edition.id)).performClick()
        val downloaded = context.getString(com.litara.R.string.litara_downloaded)
        compose.waitUntil(40_000) { compose.onAllNodes(hasText(downloaded, substring = true)).fetchSemanticsNodes().isNotEmpty() }
        try {
            shell("cmd connectivity airplane-mode enable")
            shell("svc wifi disable")
            shell("svc data disable")
            withTimeout(25_000) {
                // The shell command returns before Android finishes changing connectivity.
                while (true) {
                    try {
                        repo.editions()
                    } catch (_: com.litara.core.litara.TransientException) {
                        break
                    }
                    delay(500)
                }
            }
            compose.onNodeWithText(context.getString(com.litara.R.string.litara_refresh)).performClick()
            val offline = context.getString(com.litara.R.string.litara_offline_books)
            compose.waitUntil(40_000) {
                compose.onAllNodes(hasText(offline)).fetchSemanticsNodes().isNotEmpty()
            }
            val snapshot = repo.readerSnapshot(edition.id)
            assertEquals(edition.file.contentVersion, snapshot.edition.file.contentVersion)
            assertEquals(edition.file.sizeBytes, repo.editionFile(snapshot).length())
            compose.onNodeWithText(title, substring = false).performClick()
            val contents = context.getString(com.litara.R.string.contents)
            compose.waitUntil(40_000) {
                compose.onAllNodes(androidx.compose.ui.test.hasContentDescription(contents)).fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithContentDescription(contents).performClick()
            compose.waitUntil(30_000) {
                compose.onAllNodes(hasText("Chapter 1")).fetchSemanticsNodes().isNotEmpty()
            }
            assertTrue(repo.downloadedBooks().any { it.edition.id == edition.id })
        } finally {
            shell("cmd connectivity airplane-mode disable")
            shell("svc wifi enable")
            shell("svc data enable")
        }
    }
}
