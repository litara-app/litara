package com.litara.feature.reader.pdf

import com.litara.core.litara.LAnnotation
import com.litara.core.litara.LLocator
import com.litara.core.litara.LocalAnnotation

/** A note, bookmark or web highlight on one PDF page. This reader places them by page only. */
data class PdfMark(
    val id: String,
    val kind: Kind,
    /** 0-based. */
    val page: Int,
    val text: String = "",
    val quote: String = "",
    /** Made with a text selection on the web: listed here, changed only on the web. */
    val readOnly: Boolean = false,
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

    /** This device's notes and bookmarks plus the web's highlights, in page order. */
    fun combine(local: List<LocalAnnotation>, web: List<LAnnotation>): List<PdfMark> {
        val own = local.mapNotNull { a ->
            val page = (a.locator as? LLocator.PdfPage)?.pageIndex ?: return@mapNotNull null
            val kind = kindOf(a.kind) ?: return@mapNotNull null
            PdfMark(a.id, kind, page, a.text, a.quote, waiting = a.pending != null, conflict = a.conflict != null)
        }
        val ids = own.map { it.id }.toSet()
        val other = web.mapNotNull { s ->
            val d = s.data ?: return@mapNotNull null
            val page = (d.anchor.locator as? LLocator.PdfPage)?.pageIndex ?: return@mapNotNull null
            val kind = kindOf(d.kind) ?: return@mapNotNull null
            if (s.id in ids) null else PdfMark(s.id, kind, page, d.text, d.quote, readOnly = true)
        }
        return (own + other).sortedWith(compareBy<PdfMark> { it.page }.thenBy { it.kind }.thenBy { it.id })
    }

    /** The bookmark on [page] that the ribbon button shows and removes. */
    fun bookmarkOn(marks: List<PdfMark>, page: Int): PdfMark? =
        marks.firstOrNull { it.kind == PdfMark.Kind.BOOKMARK && it.page == page && !it.readOnly }
}
