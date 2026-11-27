package com.litara.feature.player

import com.litara.core.model.BookCard
import javax.inject.Inject
import javax.inject.Singleton

/** The car's library folders over the signed-in account's recordings. */
@Singleton
class AutoLibraryRepository @Inject constructor(
    private val litara: LitaraSource,
) {
    suspend fun children(id: String, labels: AutoBrowseTree.Labels): List<AutoBrowseTree.BrowseEntry> =
        if (id == AutoBrowseTree.LIBRARY_ID) AutoLibraryTree.modes(labels)
        else AutoLibraryTree.children(id, books(), labels)

    suspend fun item(id: String, labels: AutoBrowseTree.Labels): AutoBrowseTree.BrowseEntry? =
        AutoLibraryTree.modes(labels).firstOrNull { it.mediaId == id }
            ?: AutoLibraryTree.item(id, books(), labels)

    /** A list loaded for one account is never returned once another account is signed in. */
    private suspend fun books(): List<BookCard> {
        val requestScope = litara.scopeKey()
        val books = litara.cards()
        if (litara.scopeKey() != requestScope) throw AutoRequestException(AutoFailure.INVALID_REQUEST)
        return books.distinctBy { it.id }
    }
}
