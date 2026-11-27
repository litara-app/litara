package com.litara.feature.player

import com.litara.core.model.BookCard
import com.litara.core.model.BookFiles
import javax.inject.Inject
import javax.inject.Singleton

/** Car-sized shelves of the signed-in account's recordings: from the server, or its cached list when offline. */
@Singleton
class AutoCatalog @Inject constructor(
    private val progress: AudioProgressRepository,
    private val litara: LitaraSource,
) {
    suspend fun continueListening(labels: AutoBrowseTree.Labels): List<AutoBrowseTree.BrowseEntry> {
        val history = progress.recent()
        val finished = history.filter { it.percentage >= ResumeCandidates.FINISHED_PERCENT }.map { it.bookId }.toSet()
        val started = runCatching { litara.started() }.getOrDefault(emptyList())
            .filter { it.id !in finished }.mapNotNull { entry(it, labels) }
        // The whole list only names books in this device's history (a position the server has not received yet).
        val known = runCatching { litara.cards() }.getOrDefault(emptyList()).mapNotNull { entry(it, labels) }
        val byId = (known + started).associateBy { it.mediaId }
        val recent = history.filter { it.percentage < ResumeCandidates.FINISHED_PERCENT }
            .sortedByDescending { it.updatedAt }.mapNotNull { byId[AutoBrowseTree.bookMediaId(it.bookId)] }
        return (recent + started).distinctBy { it.mediaId }.take(80)
    }

    /** The "Downloaded" shelf: this account's complete offline copies. */
    suspend fun downloadedEntries(labels: AutoBrowseTree.Labels): List<AutoBrowseTree.BrowseEntry> =
        runCatching { litara.downloaded() }.getOrDefault(emptyList()).mapNotNull { entry(it, labels) }

    /** Every recording whose title, authors or narrators contain all the words of [query]. */
    suspend fun search(query: String, labels: AutoBrowseTree.Labels): List<AutoBrowseTree.BrowseEntry> {
        if (litara.scopeKey().isEmpty()) throw AutoRequestException(AutoFailure.SIGN_IN)
        val words = AutoSearch.normalize(query).split(' ')
        return runCatching { litara.cards() }.getOrDefault(emptyList())
            .filter { book ->
                val text = AutoSearch.normalize("${book.title} ${book.authors.joinToString(" ")} ${book.narrators.joinToString(" ")}")
                words.all { it in text }
            }
            .mapNotNull { entry(it, labels) }
    }

    suspend fun item(bookId: Int, labels: AutoBrowseTree.Labels): AutoBrowseTree.BrowseEntry? =
        if (!litara.owns(bookId)) null else litara.cards().firstOrNull { it.id == bookId }?.let { entry(it, labels) }

    private fun entry(book: BookCard, labels: AutoBrowseTree.Labels): AutoBrowseTree.BrowseEntry? {
        if (book.files.none { it.format?.lowercase() in BookFiles.AUDIO_FORMATS }) return null
        return AutoBrowseTree.BrowseEntry(AutoBrowseTree.bookMediaId(book.id), book.title ?: labels.audiobook,
            book.narrators.ifEmpty { book.authors }.joinToString(", ").ifBlank { null }, null, true)
    }
}
