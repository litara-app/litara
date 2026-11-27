package com.litara.feature.reader

object BookmarkNames {
    /** "Chapter 4 · 37%", or just "37%" when the book has no chapter titles. */
    fun default(chapterTitle: String?, percent: Int): String {
        val chapter = chapterTitle?.trim()?.takeIf { it.isNotEmpty() } ?: return "$percent%"
        return "$chapter · $percent%"
    }
}
