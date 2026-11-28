package com.litara.feature.reader.pdf

import com.litara.core.litara.HighlightColors
import com.litara.core.litara.LLocator
import com.litara.core.litara.LRectangle
import com.litara.core.litara.LSelection
import com.litara.core.litara.LocalAnnotation
import com.litara.feature.reader.SharedReaderProtocol

/** A highlight, note or bookmark on one PDF page. The system reader places them by page; highlight mode draws them. */
data class PdfMark(
    val id: String,
    val kind: Kind,
    /** 0-based. */
    val page: Int,
    val text: String = "",
    val quote: String = "",
    /** The selected text or area, as fractions of the page's unrotated crop box. Empty for a page note or bookmark. */
    val rectangles: List<LRectangle> = emptyList(),
    /** A colour name (ADR-0094), or null for the default look. */
    val color: String? = null,
    /** Saved on this device and not yet accepted by the server. */
    val waiting: Boolean = false,
    /** The server kept this change as a conflict; the person decides in the web app. */
    val conflict: Boolean = false,
) {
    enum class Kind { HIGHLIGHT, NOTE, BOOKMARK }
}

/** A request to scroll to a page. [seq] makes two requests for the same page distinct. */
data class PdfJump(val page: Int, val seq: Int)

object PdfMarks {
    private fun kindOf(kind: String) = when (kind) {
        "highlight" -> PdfMark.Kind.HIGHLIGHT
        "note" -> PdfMark.Kind.NOTE
        "bookmark" -> PdfMark.Kind.BOOKMARK
        else -> null
    }

    /** This file's annotations in page order. */
    fun from(local: List<LocalAnnotation>): List<PdfMark> = local.mapNotNull { a ->
        val selection = a.selection as? LSelection.PdfRectangles
        val page = selection?.pageIndex ?: (a.locator as? LLocator.PdfPage)?.pageIndex ?: return@mapNotNull null
        val kind = kindOf(a.kind) ?: return@mapNotNull null
        PdfMark(a.id, kind, page, a.text, a.quote, selection?.rectangles.orEmpty(), a.color,
            waiting = a.pending != null, conflict = a.conflict != null)
    }.sortedWith(compareBy<PdfMark> { it.page }.thenBy { it.kind }.thenBy { it.id })

    /** The bookmark on [page] that the ribbon button shows and removes. */
    fun bookmarkOn(marks: List<PdfMark>, page: Int): PdfMark? = marks.firstOrNull { it.kind == PdfMark.Kind.BOOKMARK && it.page == page }

    /** What the engine draws in highlight mode: every mark that has a place inside its page. */
    fun paint(marks: List<PdfMark>): List<SharedReaderProtocol.PdfPaint> = marks.filter { it.rectangles.isNotEmpty() }.map {
        SharedReaderProtocol.PdfPaint(it.id, it.kind == PdfMark.Kind.NOTE, it.page, it.rectangles, HighlightColors.shade(it.color))
    }
}
