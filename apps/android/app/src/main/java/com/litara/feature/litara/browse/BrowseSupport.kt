package com.litara.feature.litara.browse

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import coil.ImageLoader
import coil.compose.AsyncImage
import com.litara.R
import com.litara.core.litara.LitaraClient
import com.litara.core.litara.LitaraHttpException
import com.litara.core.litara.PagedState
import com.litara.core.litara.SessionEndedException
import com.litara.core.litara.TransientException
import com.litara.core.litara.urlEncode
import com.litara.feature.litara.LitaraRepository

/** Test tags for the browsing screens. */
object BrowseTags {
    fun section(name: String) = "browse-section-$name"
    const val SEARCH = "browse-search"
    const val FILTERS = "browse-filters"
    const val FILTER_APPLY = "browse-filter-apply"
    const val FILTER_AUTHOR = "browse-filter-author"
    const val SORT = "browse-sort"
    const val COUNT = "browse-count"
    const val ERROR = "browse-error"
    const val PAGE_TITLE = "browse-page-title"
    const val BACK = "browse-back"
    const val NEW_SHELF = "browse-new-shelf"
    const val SHELF_NAME = "browse-shelf-name"
    const val SHELF_CONFIRM = "browse-shelf-confirm"
    const val SHELF_DELETE = "browse-shelf-delete"
    const val ADD_TO_SHELF = "browse-add-to-shelf"
    const val RATING = "browse-rating"
    const val NOTE = "browse-note"
    const val PAPER = "browse-paper"
    const val STATS_OPEN = "browse-stats-open"
    const val STATS_TOTALS = "browse-stats-totals"
    fun title(id: String) = "browse-title-$id"
    fun author(name: String) = "browse-author-$name"
    fun series(name: String) = "browse-series-$name"
    fun shelf(name: String) = "browse-shelf-$name"
    fun shelfPick(name: String) = "browse-shelf-pick-$name"
    fun removeFromShelf(id: String) = "browse-shelf-remove-$id"
    fun star(n: Int) = "browse-star-$n"
}

/** Where the browsing screens can go. */
class BrowseNav(
    val back: () -> Unit,
    val title: (String) -> Unit,
    val author: (String) -> Unit,
    val series: (String) -> Unit,
    val shelf: (String) -> Unit,
)

/** What the browsing screens share: the signed-in client and one wording for failures. Browsing is online only. */
abstract class BrowseViewModel(private val app: Application, protected val repo: LitaraRepository) : AndroidViewModel(app) {
    protected fun client(): LitaraClient = repo.clientOrNull() ?: throw SessionEndedException("signed_out")

    val covers: ImageLoader get() = repo.coverLoader()

    fun coverUrl(titleId: String, audio: Boolean): String? =
        repo.clientOrNull()?.url("/titles/$titleId/cover?medium=" + if (audio) "audio" else "ebook")

    fun authorPhotoUrl(name: String, version: String): String? =
        repo.clientOrNull()?.url("/authors/photo?name=${urlEncode(name)}&v=${urlEncode(version)}")

    fun missingCoverUrl(series: String, number: Long, version: String): String? =
        repo.clientOrNull()?.url("/series/missing/cover?name=${urlEncode(series)}&number=$number&v=${urlEncode(version)}")

    fun message(e: Throwable): String {
        android.util.Log.w("LitaraBrowse", "request failed", e)
        return when (e) {
            is TransientException -> app.getString(R.string.browse_offline)
            is SessionEndedException -> { repo.refreshSignedIn(); app.getString(R.string.litara_err_signed_out, e.code) }
            is LitaraHttpException ->
                if (e.status == 404 || e.status == 403) app.getString(R.string.browse_gone)
                else app.getString(R.string.browse_failed, e.problem.code.ifEmpty { "HTTP ${e.status}" })
            else -> app.getString(R.string.browse_failed, e.javaClass.simpleName)
        }
    }

    protected fun text(id: Int, vararg args: Any): String = app.getString(id, *args)
}

/** A book cover, or an empty tile of the same shape when the title has none. */
@Composable
fun BookCover(url: String?, loader: ImageLoader, description: String?, width: Int = 44) {
    AsyncImage(
        model = url, imageLoader = loader, contentDescription = description, contentScale = ContentScale.Crop,
        modifier = Modifier.size(width.dp, (width * 3 / 2).dp).clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
    )
}

/** An author's photo, or their initials (ADR-0104). */
@Composable
fun Portrait(name: String, url: String?, loader: ImageLoader, description: String?, size: Int = 44) {
    Box(Modifier.size(size.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        if (url == null) {
            val initials = name.split(' ').filter { it.isNotBlank() }.let { parts ->
                listOfNotNull(parts.firstOrNull(), parts.drop(1).lastOrNull()).joinToString("") { it.take(1).uppercase() }
            }
            Text(initials, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            AsyncImage(url, description, imageLoader = loader, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

/** One tappable list row: an image, two or three lines, and optionally something at the end. */
@Composable
fun EntryRow(
    title: String,
    lines: List<String>,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    leading: @Composable () -> Unit = {},
    trailing: @Composable () -> Unit = {},
) {
    Row(
        (if (onClick != null) modifier.clickable(onClick = onClick) else modifier).fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        leading()
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            lines.filter { it.isNotBlank() }.forEach {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        trailing()
    }
    HorizontalDivider()
}

@Composable
fun BrowseSearchField(value: String, onValue: (String) -> Unit, label: String) {
    val focus = LocalFocusManager.current
    OutlinedTextField(
        value = value, onValueChange = onValue, singleLine = true, label = { Text(label) },
        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
        trailingIcon = if (value.isEmpty()) null else {
            { IconButton({ onValue("") }) { Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.litara_search_clear)) } }
        },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
        modifier = Modifier.fillMaxWidth().testTag(BrowseTags.SEARCH),
    )
}

/** A button that opens a short list of choices. */
@Composable
fun <T> Chooser(label: String, options: List<Pair<T, String>>, onPick: (T) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton({ open = true }, modifier) { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        DropdownMenu(open, { open = false }) {
            options.forEach { (value, text) -> DropdownMenuItem({ Text(text) }, { open = false; onPick(value) }) }
        }
    }
}

@Composable
fun ErrorLine(message: String, onRetry: (() -> Unit)?) {
    Column {
        Text(message, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag(BrowseTags.ERROR))
        if (onRetry != null) TextButton(onRetry) { Text(stringResource(R.string.browse_retry)) }
    }
}

/**
 * The rows of a paged list, ending with whatever its state calls for: a progress bar, the error with a retry, the
 * empty message, or the request for the next page as soon as the end scrolls into view.
 */
fun <T> LazyListScope.pagedFooter(state: PagedState<T>, describe: (Throwable) -> String, empty: @Composable () -> Unit, loadMore: () -> Unit) {
    item(key = "paged-footer") {
        val error = state.error
        when {
            error != null -> ErrorLine(remember(error) { describe(error) }, loadMore)
            state.loading -> LinearProgressIndicator(Modifier.fillMaxWidth().padding(vertical = 12.dp))
            state.loaded && state.items.isEmpty() -> empty()
            state.hasMore -> {
                LaunchedEffect(state.items.size) { loadMore() }
                Box(Modifier.fillMaxWidth().height(24.dp).width(1.dp))
            }
        }
    }
}

@Composable
fun EmptyNote(text: String) = Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 16.dp))

/** A full-screen page with a back button and a scrolling body. */
@Composable
fun BrowsePage(title: String, onBack: () -> Unit, content: LazyListScope.() -> Unit) {
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onBack, Modifier.testTag(BrowseTags.BACK)) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.browse_back))
                }
                Text(title, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.testTag(BrowseTags.PAGE_TITLE))
            }
            LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(4.dp), content = content)
        }
    }
}
