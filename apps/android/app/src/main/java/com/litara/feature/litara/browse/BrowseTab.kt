package com.litara.feature.litara.browse

import android.net.Uri
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.dropUnlessResumed
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.litara.R

/** The Browse tab: every title with search, filters and sorting, then authors, series and shelves. */
@Composable
fun BrowseTab(nav: BrowseNav, section: Int, onSection: (Int) -> Unit) {
    val names = listOf(R.string.browse_titles to "titles", R.string.browse_authors to "authors", R.string.browse_series to "series", R.string.browse_shelves to "shelves")
    TabRow(section) {
        names.forEachIndexed { i, (label, tag) ->
            Tab(section == i, { onSection(i) }, Modifier.testTag(BrowseTags.section(tag)), text = { Text(stringResource(label), maxLines = 1) })
        }
    }
    when (section) {
        0 -> TitlesSection(nav)
        1 -> AuthorsSection(nav)
        2 -> SeriesSection(nav)
        else -> ShelvesSection(nav)
    }
}

private const val ROUTE_STATS = "stats"

fun browseNav(nav: NavHostController) = BrowseNav(
    back = { nav.popBackStack() },
    title = { nav.navigate("title/${Uri.encode(it)}") },
    author = { nav.navigate("author/${Uri.encode(it)}") },
    series = { nav.navigate("series/${Uri.encode(it)}") },
    shelf = { nav.navigate("shelf/${Uri.encode(it)}") },
)

fun openStats(nav: NavHostController) = nav.navigate(ROUTE_STATS)

/** The full-screen browsing pages above the shell's tabs. */
fun NavGraphBuilder.browseRoutes(nav: NavHostController, onRead: (String, String) -> Unit, onListen: (String) -> Unit) {
    val actions = browseNav(nav)
    // A double tap during a transition must not pop or push twice.
    composable("title/{titleId}") {
        val back = dropUnlessResumed { nav.popBackStack() }
        TitleScreen(BrowseNav(back, actions.title, actions.author, actions.series, actions.shelf), onRead, onListen)
    }
    composable("author/{name}") {
        val back = dropUnlessResumed { nav.popBackStack() }
        AuthorScreen(BrowseNav(back, actions.title, actions.author, actions.series, actions.shelf))
    }
    composable("series/{name}") {
        val back = dropUnlessResumed { nav.popBackStack() }
        SeriesScreen(BrowseNav(back, actions.title, actions.author, actions.series, actions.shelf))
    }
    composable("shelf/{shelfId}") {
        val back = dropUnlessResumed { nav.popBackStack() }
        ShelfScreen(BrowseNav(back, actions.title, actions.author, actions.series, actions.shelf))
    }
    composable(ROUTE_STATS) { StatsScreen(onBack = dropUnlessResumed { nav.popBackStack() }) }
}
