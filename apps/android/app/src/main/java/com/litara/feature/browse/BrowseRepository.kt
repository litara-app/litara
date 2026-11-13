package com.litara.feature.browse

import com.litara.core.model.AuthorsPage
import com.litara.core.model.BookCard
import com.litara.core.model.BookQuery
import com.litara.core.model.BooksPage
import com.litara.core.model.Collection
import com.litara.core.model.Library
import com.litara.core.model.Pagination
import com.litara.core.model.SearchResult
import com.litara.core.model.SeriesBooksPage
import com.litara.core.model.SeriesPage
import com.litara.core.model.ScrollerBooks
import com.litara.core.model.SmartScope
import com.litara.core.network.ApiService
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Read-side operations for the browse tabs. Thin wrapper over [ApiService] covering the
 * libraries/collections/smartScopes/authors/series/dashboard/catalog endpoints.
 */
@Singleton
class BrowseRepository @Inject constructor(
    private val api: ApiService,
    private val json: Json,
) {
    suspend fun libraries(): List<Library> = api.getLibraries()

    suspend fun libraryBooks(libraryId: Int, query: BookQuery): BooksPage =
        api.getLibraryBooks(libraryId, query)

    suspend fun search(q: String, limit: Int = 20): List<SearchResult> = api.searchBooks(q, limit)

    suspend fun smartScopes(): List<SmartScope> = api.getSmartScopes()

    suspend fun smartScopeBooks(id: Int, page: Int, size: Int): BooksPage = try {
        // Standard session query API. The legacy GET requires official-app attestation on 3.7+.
        api.querySmartScopeBooks(id, BookQuery(pagination = Pagination(page, size)))
    } catch (error: HttpException) {
        if (error.code() !in listOf(404, 405)) throw error
        api.getSmartScopeBooks(id, page, size)
    }

    suspend fun collections(): List<Collection> = api.getCollections()

    suspend fun collectionBooks(id: Int, page: Int, size: Int): BooksPage =
        api.getCollectionBooks(id, page, size)

    suspend fun authors(page: Int, size: Int): AuthorsPage = api.getAuthors(page = page, size = size)

    suspend fun authorBooks(id: Int, page: Int, size: Int): BooksPage =
        api.getAuthorBooks(id, page, size)

    suspend fun series(page: Int, size: Int): SeriesPage = api.getSeries(page = page, size = size)

    suspend fun seriesBooks(seriesId: Int, page: Int, size: Int): SeriesBooksPage =
        api.getSeriesBooks(seriesId, page, size)

    suspend fun scroller(type: String, limit: Int = 20, smartScopeId: Int? = null): List<BookCard> =
        ScrollerBooks.decode(json, api.getScroller(type, limit, smartScopeId))

    /** Catalog typeahead for the filter sheet (authors/genres/tags/languages). */
    suspend fun searchCatalog(kind: String, q: String): List<String> =
        if (q.isBlank()) emptyList()
        else api.searchCatalog(kind, q.trim()).mapNotNull { it.name }.filter { it.isNotBlank() }
}
