package com.litara.feature.reader.pdf

import com.litara.core.litara.LAnnotation
import com.litara.core.litara.LAnnotationData
import com.litara.core.litara.LEditionAnchor
import com.litara.core.litara.LLocator
import com.litara.core.litara.LRectangle
import com.litara.core.litara.LSelection
import com.litara.core.litara.LocalAnnotation
import com.litara.core.litara.PendingAnnotationOp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PdfMarksTest {
    private fun local(id: String, kind: String, page: Int, text: String = "", pending: Boolean = false, conflict: String? = null) =
        LocalAnnotation(id, kind, LLocator.PdfPage(page, 0.0, 0.0), text = text, createdAt = "t", updatedAt = "t",
            pending = if (pending) PendingAnnotationOp("op", "0", false, "t") else null, conflict = conflict)

    private fun web(id: String, page: Int, quote: String) = LAnnotation(
        id, "e1", "1", false,
        LAnnotationData("highlight", LEditionAnchor("f1", "v1", LLocator.PdfPage(page, 0.1, 0.2)),
            LSelection.PdfRectangles(page, listOf(LRectangle(0.1, 0.2, 0.3, 0.05))), "", quote),
        "t",
    )

    @Test fun `own marks and web highlights are listed in page order`() {
        val marks = PdfMarks.combine(listOf(local("n", "note", 3, "mine"), local("b", "bookmark", 0)), listOf(web("h", 1, "quoted")))
        assertEquals(listOf("b", "h", "n"), marks.map { it.id })
        assertTrue(marks[1].readOnly)
        assertEquals("quoted", marks[1].quote)
        assertEquals(listOf(false, true, false), marks.map { it.readOnly })
    }

    @Test fun `waiting and refused changes are marked`() {
        val marks = PdfMarks.combine(listOf(local("a", "note", 0, pending = true), local("b", "note", 1, conflict = "revision_conflict")), emptyList())
        assertEquals(listOf(true, false), marks.map { it.waiting })
        assertEquals(listOf(false, true), marks.map { it.conflict })
    }

    @Test fun `the ribbon finds only this device-editable bookmark on the shown page`() {
        val marks = PdfMarks.combine(listOf(local("n", "note", 2), local("b", "bookmark", 2)), emptyList())
        assertEquals("b", PdfMarks.bookmarkOn(marks, 2)!!.id)
        assertNull(PdfMarks.bookmarkOn(marks, 1))
    }

    @Test fun `a locator that is not a PDF page is not placed on a page`() {
        val other = LocalAnnotation("x", "note", LLocator.FoliateCfi("epubcfi(/6/4)"), createdAt = "t", updatedAt = "t")
        assertTrue(PdfMarks.combine(listOf(other), emptyList()).isEmpty())
    }
}
