package com.litara.feature.litara

import com.litara.feature.player.AutoSearch

/**
 * The phone's library search. It filters the lists the app already holds, so it also works on the offline copies.
 * Every word must appear somewhere in the fields; case, accents and extra spaces are ignored.
 */
fun matchesSearch(query: String, fields: List<String>): Boolean {
    val term = AutoSearch.normalize(query)
    if (term.isEmpty()) return true
    val text = AutoSearch.normalize(fields.joinToString(" "))
    return term.split(' ').all { it in text }
}

fun searchRecordings(rows: List<LibraryRow>, query: String): List<LibraryRow> = rows.filter {
    val r = it.summary
    matchesSearch(query, listOfNotNull(r.title, r.series?.name) + r.authors + r.narrators)
}

fun searchBooks(rows: List<BookRow>, query: String): List<BookRow> = rows.filter {
    matchesSearch(query, listOf(it.title) + it.authors + it.series)
}
