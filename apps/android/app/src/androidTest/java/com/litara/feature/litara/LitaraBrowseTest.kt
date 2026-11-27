package com.litara.feature.litara

import android.graphics.Bitmap
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performScrollTo
import androidx.media3.common.util.UnstableApi
import androidx.test.platform.app.InstrumentationRegistry
import com.litara.app.MainActivity
import com.litara.core.auth.SecureStorage
import com.litara.core.litara.LitaraJson
import com.litara.feature.litara.browse.BrowseTags
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import java.io.File

/**
 * The browsing screens against a RUNNING seeded server, through the real launcher activity: title search and filters,
 * author and series pages, a rating, a shelf from creation to deletion, stats, and "Wi-Fi only" downloads (with the
 * network reported as metered, since an emulator's is not). The seeded library needs "Fixture Series" to hold books 1
 * and 3. Arguments: litaraUrl, litaraPassword, litaraRecording. Reported as skipped without them. Screenshots are
 * written to the app's external files directory.
 */
@UnstableApi
@OptIn(ExperimentalTestApi::class)
class LitaraBrowseTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val args = InstrumentationRegistry.getArguments()
    private val deps by lazy { EntryPointAccessors.fromApplication(context, LitaraTestDependencies::class.java) }

    private val signIn = object : ExternalResource() {
        override fun before() {
            val url = args.getString("litaraUrl")
            val password = args.getString("litaraPassword")
            assumeTrue("litaraUrl/litaraPassword/litaraRecording not provided; browsing test not run",
                url != null && password != null && args.getString("litaraRecording") != null)
            deps.repository().allowProcessRestart = false
            deps.session().activeDataScope = null
            runCatching { runBlocking { deps.repository().signOut() } }
            LitaraSessionStore(SecureStorage(context)).forgetIdentity()
            File(context.filesDir, "litara-offline").deleteRecursively()
            runBlocking { deps.repository().signIn(url!!, true, "fixture-user-a", password!!, "Browse test") }
            deps.session().activeDataScope = null
        }

        override fun after() {
            deps.repository().meteredNetwork = { false }
            runBlocking { deps.appSettings().setWifiOnlyDownloads(false) }
        }
    }
    private val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule val chain: RuleChain = RuleChain.outerRule(signIn).around(compose)

    private fun count(tag: String) = compose.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().size
    private fun textShown(text: String) = compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty()

    private fun await(label: String, predicate: () -> Boolean) {
        try {
            compose.waitUntil(30_000) { predicate() }
        } catch (e: androidx.compose.ui.test.ComposeTimeoutException) {
            shot("failed")
            throw AssertionError("Timed out: $label", e)
        }
    }

    private fun waitTag(tag: String) = await("tag $tag") { count(tag) > 0 }
    private fun gone(tag: String) = await("tag $tag gone") { count(tag) == 0 }
    private fun waitText(text: String) = await("text $text") { textShown(text) }
    private fun click(tag: String) { waitTag(tag); compose.onNodeWithTag(tag).performClick() }
    private fun clickText(text: String) { waitText(text); compose.onAllNodes(hasText(text))[0].performClick() }

    private fun shot(name: String) {
        compose.waitForIdle()
        Thread.sleep(700) // images and transitions
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: return
        File(context.getExternalFilesDir(null), "browse-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 90, it) }
    }

    @Test
    fun browsingShelvesRatingStatsAndWifiOnly() = runBlocking<Unit> {
        val client = deps.repository().clientOrNull()!!
        fun server(path: String) = runBlocking {
            client.execute(Request.Builder().url(client.url(path)).get()).use { LitaraJson.parseToJsonElement(it.body!!.string()).jsonObject }
        }
        val recording = args.getString("litaraRecording")!!
        val titleId = client.snapshot(recording).titleId
        val titleName = client.snapshot(recording).title
        // Start unrated so the run can be repeated.
        com.litara.core.litara.PersonalEdits().let { edits ->
            val current = client.titlePersonal(titleId)
            if (current.data.ratingHalves != null) edits.rate(client, current, null)
        }

        // Titles: search, then a filter that matches nothing, then clearing it.
        click(ShellTags.TAB_BROWSE)
        waitTag(BrowseTags.title(titleId))
        shot("titles")
        compose.onNodeWithTag(BrowseTags.SEARCH).performTextInput("incomplete")
        gone(BrowseTags.title(titleId))
        waitText("1 title")
        compose.onNodeWithTag(BrowseTags.SEARCH).performTextClearance()
        waitTag(BrowseTags.title(titleId))
        click(BrowseTags.FILTERS)
        waitTag(BrowseTags.FILTER_AUTHOR)
        compose.onNodeWithTag(BrowseTags.FILTER_AUTHOR).performTextInput("Nobody At All")
        click(BrowseTags.FILTER_APPLY)
        waitText("Nothing matches.")
        waitText("Filters (1)")
        click(BrowseTags.FILTERS)
        clickText("Clear filters")
        click(BrowseTags.FILTER_APPLY)
        waitTag(BrowseTags.title(titleId))
        // Sorting is asked of the server.
        click(BrowseTags.SORT)
        clickText("Date added")
        waitText("Sort: Date added")
        waitTag(BrowseTags.title(titleId))

        // Authors and the author page.
        click(BrowseTags.section("authors"))
        click(BrowseTags.author("Fixture Author"))
        waitText("Fixture Series")
        waitTag(BrowseTags.title(titleId))
        shot("author")
        click(BrowseTags.BACK)

        // Series: books 1 and 3 are held, so book 2 is shown as missing.
        click(BrowseTags.section("series"))
        click(BrowseTags.series("Fixture Series"))
        waitText("Book #2 is not in your libraries")
        shot("series")

        // The title page: rate it, and the server has the rating.
        click(BrowseTags.title(titleId))
        waitTag(BrowseTags.RATING)
        click(BrowseTags.star(4))
        waitText("4 of 5")
        await("rating saved") { server("/titles/$titleId/personal")["data"]!!.jsonObject["ratingHalves"]!!.jsonPrimitive.content == "8" }
        shot("title")
        clickText("− ½")
        waitText("3.5 of 5")
        clickText("Clear rating")
        waitText("Not rated")
        click(BrowseTags.BACK)
        click(BrowseTags.BACK)

        // A shelf from creation to deletion.
        val shelfName = "Phone shelf ${System.currentTimeMillis() % 100000}"
        click(BrowseTags.section("shelves"))
        click(BrowseTags.NEW_SHELF)
        waitTag(BrowseTags.SHELF_NAME)
        compose.onNodeWithTag(BrowseTags.SHELF_NAME).performTextInput(shelfName)
        click(BrowseTags.SHELF_CONFIRM)
        waitText("Nothing here yet.")
        click(BrowseTags.BACK)
        waitTag(BrowseTags.shelf(shelfName))
        click(BrowseTags.section("titles"))
        click(BrowseTags.title(titleId))
        click(BrowseTags.ADD_TO_SHELF)
        click(BrowseTags.shelfPick(shelfName))
        waitText("Added to $shelfName")
        click(BrowseTags.BACK)
        click(BrowseTags.section("shelves"))
        click(BrowseTags.shelf(shelfName))
        waitTag(BrowseTags.removeFromShelf(titleId))
        shot("shelf")
        click(BrowseTags.removeFromShelf(titleId))
        gone(BrowseTags.removeFromShelf(titleId))
        click(BrowseTags.SHELF_DELETE)
        click(BrowseTags.SHELF_CONFIRM)
        waitTag(BrowseTags.NEW_SHELF)
        gone(BrowseTags.shelf(shelfName))
        assertTrue(server("/shelves?size=200")["items"]!!.jsonArray.none {
            it.jsonObject["data"]?.toString()?.contains(shelfName) == true && it.jsonObject["deleted"]!!.jsonPrimitive.content == "false"
        })

        // Stats, with 20 minutes of listening for them to show.
        val ended = System.currentTimeMillis() - 60_000
        client.putSession(com.litara.core.litara.SessionEntry(java.util.UUID.randomUUID().toString(), com.litara.core.litara.SessionKind.LISTEN,
            recording, ended - 20 * 60_000, ended, 20 * 60L, 0.1, 0.2))
        click(ShellTags.TAB_ACCOUNT)
        click(BrowseTags.STATS_OPEN)
        waitTag(BrowseTags.STATS_TOTALS)
        waitText("Longest streak")
        waitText("Audiobooks listened to: 1")
        shot("stats")
        click(BrowseTags.BACK)

        // Wi-Fi only: from the title page to the recording, where a download on a metered network is refused.
        deps.appSettings().setWifiOnlyDownloads(true)
        assertTrue(deps.appSettings().wifiOnlyDownloads.first())
        deps.repository().meteredNetwork = { true }
        click(ShellTags.TAB_BROWSE)
        click(BrowseTags.section("titles"))
        click(BrowseTags.title(titleId))
        click(BrowseTags.title(recording))
        waitTag(ShellTags.DETAIL_TITLE)
        waitText(titleName)
        click(ShellTags.DOWNLOAD)
        waitText("Downloads are set to Wi-Fi only")
        shot("wifi-only")
        assertEquals(null, deps.repository().downloaded(recording))
        deps.repository().meteredNetwork = { false }
        click(ShellTags.DOWNLOAD)
        await("download completes on Wi-Fi") { deps.repository().downloaded(recording) != null }
        deps.repository().deleteDownload(recording)

        // Settings offers the switch to a Litara account.
        click(ShellTags.TAB_ACCOUNT)
        click(ShellTags.SETTINGS)
        waitText("Wi-Fi only")
        compose.onAllNodes(hasText("Wi-Fi only"))[0].performScrollTo()
        shot("settings")
    }
}
