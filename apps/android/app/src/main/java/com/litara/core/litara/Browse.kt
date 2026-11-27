package com.litara.core.litara

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import kotlin.math.floor

// ---- wire models: library table, directories, shelves, personal rating and stats --------------------------------

@Serializable
data class LTitleRow(
    val id: String,
    val title: String,
    val authors: List<String> = emptyList(),
    val series: List<String> = emptyList(),
    val seriesIndex: Double? = null,
    val publisher: String? = null,
    val published: String? = null,
    val formats: List<String> = emptyList(),
    val ratingHalves: Int? = null,
    /** unread, reading or finished. */
    val status: String = "unread",
    val editionCount: Long = 0,
    val recordingCount: Long = 0,
)

@Serializable
data class LTitleRows(val items: List<LTitleRow>, val total: Long, val page: Long, val size: Long)

@Serializable
data class LTitleDetail(val title: LTitleSummary)

@Serializable
data class LRecordingLink(val id: String, val label: String, val libraryId: String)

@Serializable
data class LRecordingLinks(val items: List<LRecordingLink>, val total: Long, val page: Long, val size: Long)

@Serializable
data class LDirectoryAuthor(
    val name: String,
    val lastName: String = "",
    val titles: Long,
    val seriesCount: Long = 0,
    val coverTitleId: String = "",
    val photoVersion: String? = null,
)

@Serializable
data class LDirectoryAuthors(val items: List<LDirectoryAuthor>, val total: Long, val page: Long, val size: Long, val letters: List<String> = emptyList())

@Serializable
data class LDirectorySeries(
    val name: String,
    val titles: Long,
    val finished: Long = 0,
    val authors: List<String> = emptyList(),
    val coverTitleId: String = "",
)

@Serializable
data class LDirectorySeriesPage(val items: List<LDirectorySeries>, val total: Long, val page: Long, val size: Long)

@Serializable
data class LDirectoryField(val field: String, val value: JsonElement = JsonNull, val provider: String? = null, val providerUrl: String? = null)

@Serializable
data class LAuthorPhoto(val version: String? = null, val provider: String? = null, val providerUrl: String? = null)

@Serializable
data class LProviderMatch(val name: String, val provider: String, val url: String)

@Serializable
data class LDirectoryDetails(
    val name: String,
    val fields: List<LDirectoryField> = emptyList(),
    val photo: LAuthorPhoto? = null,
    val match: LProviderMatch? = null,
) {
    /** The saved text of [field], or null when there is none. */
    fun text(field: String): String? = fields.firstOrNull { it.field == field }?.value?.let { v ->
        when (v) {
            is JsonNull -> null
            is JsonPrimitive -> v.content
            is JsonArray -> v.filterIsInstance<JsonPrimitive>().joinToString(", ") { it.content }
            else -> null
        }
    }?.takeIf { it.isNotBlank() }

    /** The provider a saved value came from, for the credit ADR-0106 requires; null when a person wrote it. */
    fun providerOf(field: String): String? = fields.firstOrNull { it.field == field && text(field) != null }?.provider
}

@Serializable
data class LMissingBook(
    val number: Long,
    val title: String,
    val authors: List<String> = emptyList(),
    val released: String = "",
    val url: String = "",
    val coverVersion: String? = null,
)

@Serializable
data class LMissingBooks(val items: List<LMissingBook> = emptyList(), val match: LProviderMatch? = null)

@Serializable
data class LContinueTarget(val titleId: String? = null, val title: String? = null, val medium: String? = null, val state: String? = null)

@Serializable
data class LShelfData(
    val name: String,
    /** manual or smart. */
    val kind: String,
    /** private or shared. */
    val visibility: String,
    /** A smart shelf's rules, passed through unchanged: this app does not edit them (ADR-0107). */
    val filter: JsonElement? = null,
)

@Serializable
data class LShelf(
    val id: String,
    val revision: String,
    val data: LShelfData? = null,
    val deleted: Boolean = false,
    val canEdit: Boolean = false,
    val visibleTitleCount: Long = 0,
) {
    val manualAndEditable: Boolean get() = !deleted && canEdit && data?.kind == "manual"
}

@Serializable
data class LShelves(val items: List<LShelf>, val total: Long, val page: Long, val size: Long)

@Serializable
data class LShelfWrite(val operationId: String, val baseRevision: String, val data: LShelfData, val capturedAt: String)

/** A revision-checked change with no other content: delete a shelf, or add or remove one title. */
@Serializable
data class LRevisionedChange(val operationId: String, val baseRevision: String, val capturedAt: String)

@Serializable
data class LTitlePersonalData(val ratingHalves: Int? = null, val review: String = "", val startedAt: String? = null, val finishedAt: String? = null)

@Serializable
data class LTitlePersonal(val titleId: String, val revision: String, val data: LTitlePersonalData)

@Serializable
data class LTitlePersonalWrite(val operationId: String, val baseRevision: String, val data: LTitlePersonalData, val capturedAt: String)

@Serializable
data class LActivityDay(
    val date: String,
    val readingSeconds: Long = 0,
    val listeningSeconds: Long = 0,
    val readingSessions: Long = 0,
    val listeningSessions: Long = 0,
    val readingDay: Boolean = false,
) {
    val seconds: Long get() = readingSeconds + listeningSeconds
}

/** [activeSeconds] and [books] count ebook reading only; listening is reported beside them (ADR-0109). */
@Serializable
data class LReadingStats(
    val from: String,
    val to: String,
    val activeSeconds: Long,
    val books: Long,
    val sessions: Long,
    val listeningSeconds: Long = 0,
    val listeningSessions: Long = 0,
    val listenedBooks: Long = 0,
    val readingDays: Long = 0,
    val currentStreak: Long = 0,
    val longestStreak: Long = 0,
    val readingDaySeconds: Long = 300,
    val activity: List<LActivityDay> = emptyList(),
)

// ---- library search ----------------------------------------------------------------------------------------------

/** The title list's sorting and filters. Every set filter must match; nested AND/OR rules stay on the web (ADR-0085). */
@Serializable
data class TitleQuery(
    val q: String = "",
    val mediaKind: String? = null,
    val status: String? = null,
    val rated: String? = null,
    val format: String = "",
    val author: String = "",
    val series: String = "",
    val publisher: String = "",
    val language: String = "",
    val sort: String = "title",
    val descending: Boolean = false,
) {
    /** How many filters are on, not counting the search text or the sort. */
    val filterCount: Int get() = listOf(mediaKind, status, rated).count { it != null } +
        listOf(format, author, series, publisher, language).count { it.isNotBlank() }

    fun cleared() = TitleQuery(q = q, sort = sort, descending = descending)

    /** The query string of `GET /titles`. */
    fun toQueryString(page: Int, size: Int): String = buildString {
        append("page=$page&size=$size&sort=$sort&order=").append(if (descending) "desc" else "asc")
        fun add(name: String, value: String?) {
            val v = value?.trim()
            if (!v.isNullOrEmpty()) append('&').append(name).append('=').append(urlEncode(v))
        }
        add("q", q.take(200))
        add("mediaKind", mediaKind)
        add("status", status)
        add("rated", rated)
        add("format", format)
        add("author", author)
        add("series", series)
        add("publisher", publisher)
        add("language", language)
    }

    companion object {
        val SORTS = listOf("title", "author", "series", "added", "published", "rating", "status", "publisher", "language", "pages", "series_index", "editions")
    }
}

internal fun urlEncode(s: String): String = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")

// ---- author and series pages (ADR-0100) ---------------------------------------------------------------------------

/** In series order: numbered books by number, then unnumbered ones by title. */
val SERIES_ORDER: Comparator<LTitleRow> = compareBy<LTitleRow> { it.seriesIndex ?: Double.MAX_VALUE }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.title }

/** One block of an author page: a series, or the books in none when [series] is null. */
data class SeriesGroup(val series: String?, val titles: List<LTitleRow>)

/** An author's books grouped by series (series by name), each in series order, then the books in no series by title. */
fun groupBySeries(rows: List<LTitleRow>): List<SeriesGroup> {
    val grouped = rows.filter { !it.series.firstOrNull().isNullOrBlank() }
        .groupBy { it.series.first().trim().lowercase() }
        .values
        .map { SeriesGroup(it.first().series.first().trim(), it.sortedWith(SERIES_ORDER)) }
        .sortedBy { it.series!!.lowercase() }
    val loose = rows.filter { it.series.firstOrNull().isNullOrBlank() }.sortedBy { it.title.lowercase() }
    return if (loose.isEmpty()) grouped else grouped + SeriesGroup(null, loose)
}

/** Whole numbers between the first and last book of a series that no book has (ADR-0100). */
fun missingNumbers(indexes: List<Double?>): List<Long> {
    val present = indexes.filterNotNull()
    if (present.isEmpty()) return emptyList()
    val whole = present.map { floor(it).toLong() }.toSet()
    val lo = floor(present.min()).toLong()
    val hi = floor(present.max()).toLong()
    if (hi - lo > MAX_SERIES_SPAN) return emptyList() // a wild number such as a year would list thousands
    return (lo..hi).filter { it !in whole }
}

private const val MAX_SERIES_SPAN = 500L

sealed interface SeriesPlace {
    data class Book(val row: LTitleRow) : SeriesPlace
    data class Gap(val number: Long) : SeriesPlace
    data class Missing(val member: LMissingBook) : SeriesPlace
}

/**
 * A series page's reading order, with each absent book in its place. Once the series is matched to a provider, the
 * provider's list says what is missing (ADR-0103); otherwise the gaps between owned numbers do.
 */
fun readingOrder(rows: List<LTitleRow>, missing: LMissingBooks?): List<SeriesPlace> {
    val ordered = rows.sortedWith(SERIES_ORDER)
    val absent: ArrayDeque<Pair<Long, SeriesPlace>> = ArrayDeque(
        if (missing?.match != null) missing.items.sortedBy { it.number }.map { it.number to SeriesPlace.Missing(it) }
        else missingNumbers(ordered.map { it.seriesIndex }).map { it to SeriesPlace.Gap(it) },
    )
    val out = ArrayList<SeriesPlace>()
    for (row in ordered) {
        while (absent.isNotEmpty() && (row.seriesIndex == null || absent.first().first < row.seriesIndex)) out += absent.removeFirst().second
        out += SeriesPlace.Book(row)
    }
    absent.forEach { out += it.second }
    return out
}

/** "#2" or "#2.5". */
fun bookNumber(n: Double): String = "#" + if (n == floor(n)) n.toLong().toString() else n.toString()

// ---- stats (ADR-0098, ADR-0109) -----------------------------------------------------------------------------------

/** One square of the activity grid. [level] is 0 for a quiet day and 1 to 4 by combined time, in the web's steps. */
data class HeatDay(val date: LocalDate, val day: LActivityDay?, val level: Int)

fun heatLevel(seconds: Long, readingDaySeconds: Long = 300): Int = when {
    seconds <= 0 -> 0
    seconds < readingDaySeconds -> 1
    seconds < 30 * 60 -> 2
    seconds < 60 * 60 -> 3
    else -> 4
}

/** Weeks of seven days starting Monday, covering [from] to [to]; days outside the range are null. */
fun heatWeeks(from: LocalDate, to: LocalDate, activity: List<LActivityDay>, readingDaySeconds: Long = 300): List<List<HeatDay?>> {
    if (to.isBefore(from)) return emptyList()
    val byDate = activity.associateBy { it.date }
    val start = from.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    return generateSequence(start) { it.plusWeeks(1) }.takeWhile { !it.isAfter(to) }.map { monday ->
        (0L..6L).map { offset ->
            val d = monday.plusDays(offset)
            if (d.isBefore(from) || d.isAfter(to)) null
            else byDate[d.toString()].let { HeatDay(d, it, heatLevel(it?.seconds ?: 0, readingDaySeconds)) }
        }
    }.toList()
}

// ---- paging -------------------------------------------------------------------------------------------------------

data class PageResult<T>(val items: List<T>, val total: Long)

data class PagedState<T>(
    val items: List<T> = emptyList(),
    val total: Long = 0,
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: Throwable? = null,
) {
    val hasMore: Boolean get() = loaded && items.size < total
}

/**
 * A list read page by page as the person scrolls. [reset] starts over for a new query; an answer that arrives for an
 * older query is thrown away. Not thread-safe: call from one dispatcher (the main one in the app).
 */
class PagedList<T>(private val keyOf: (T) -> Any, private val onChange: (PagedState<T>) -> Unit) {
    var state = PagedState<T>()
        private set
    private var generation = 0
    private var nextPage = 0
    private var fetch: (suspend (page: Int) -> PageResult<T>)? = null
    private var refreshFailed = false

    private fun set(s: PagedState<T>) { state = s; onChange(s) }

    suspend fun reset(fetch: suspend (page: Int) -> PageResult<T>) {
        this.fetch = fetch
        generation++
        nextPage = 0
        refreshFailed = false
        set(PagedState())
        load()
    }

    /**
     * Reads the pages already shown again and swaps them in together. The old rows stay up meanwhile, so a screen the
     * person comes back to keeps its place. Before anything has been shown this is the same as [reset].
     */
    suspend fun refresh(fetch: suspend (page: Int) -> PageResult<T>) {
        if (!state.loaded) return reset(fetch)
        this.fetch = fetch
        rereadShown()
    }

    /** Loads the next page, or retries what failed. Does nothing while a page is on its way or at the end. */
    suspend fun loadMore() {
        if (state.loading) return
        if (refreshFailed) return rereadShown()
        if (state.loaded && !state.hasMore) return
        load()
    }

    private suspend fun rereadShown() {
        val f = fetch ?: return
        val mine = ++generation
        refreshFailed = false
        set(state.copy(loading = true, error = null))
        try {
            val pages = maxOf(nextPage, 1)
            var all = emptyList<T>()
            var total = 0L
            var read = 0
            while (read < pages) {
                val r = f(read)
                if (mine != generation) return
                read++
                all = (all + r.items).distinctBy(keyOf)
                total = if (r.items.isEmpty()) all.size.toLong() else r.total
                if (r.items.isEmpty() || all.size >= total) break
            }
            nextPage = read
            set(PagedState(all, total, loaded = true))
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            if (mine != generation) return
            refreshFailed = true
            set(state.copy(loading = false, error = e))
        }
    }

    private suspend fun load() {
        val f = fetch ?: return
        val mine = generation
        set(state.copy(loading = true, error = null))
        try {
            val r = f(nextPage)
            if (mine != generation) return
            nextPage++
            // A title can move between pages while the list is read; showing it twice would repeat its list key.
            val all = (state.items + r.items).distinctBy(keyOf)
            // An empty page ends the list even if the total still says there is more.
            set(PagedState(all, if (r.items.isEmpty()) all.size.toLong() else r.total, loaded = true))
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            if (mine == generation) set(state.copy(loading = false, error = e))
        }
    }
}
