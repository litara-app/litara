package com.litara.feature.reader.pdf

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
    private val box = LRectangle(0.1, 0.2, 0.3, 0.05)

    private fun local(id: String, kind: String, page: Int, text: String = "", pending: Boolean = false, conflict: String? = null,
        selected: Boolean = false, color: String? = null) =
        LocalAnnotation(id, kind, LLocator.PdfPage(page, 0.0, 0.0),
            selection = if (selected) LSelection.PdfRectangles(page, listOf(box)) else null, text = text, colorName = color,
            createdAt = "t", updatedAt = "t",
            pending = if (pending) PendingAnnotationOp("op", "0", false, "t") else null, conflict = conflict)

    @Test fun `marks are listed in page order`() {
        val marks = PdfMarks.from(listOf(local("n", "note", 3, "mine"), local("b", "bookmark", 0), local("h", "highlight", 1, selected = true)))
        assertEquals(listOf("b", "h", "n"), marks.map { it.id })
        assertEquals(listOf(box), marks[1].rectangles)
    }

    @Test fun `waiting and refused changes are marked`() {
        val marks = PdfMarks.from(listOf(local("a", "note", 0, pending = true), local("b", "note", 1, conflict = "revision_conflict")))
        assertEquals(listOf(true, false), marks.map { it.waiting })
        assertEquals(listOf(false, true), marks.map { it.conflict })
    }

    @Test fun `the ribbon finds the bookmark on the shown page`() {
        val marks = PdfMarks.from(listOf(local("n", "note", 2), local("b", "bookmark", 2)))
        assertEquals("b", PdfMarks.bookmarkOn(marks, 2)!!.id)
        assertNull(PdfMarks.bookmarkOn(marks, 1))
    }

    @Test fun `highlight mode draws selections with their colour and nothing for page notes`() {
        val painted = PdfMarks.paint(PdfMarks.from(listOf(
            local("h", "highlight", 1, selected = true, color = "green"), local("s", "note", 1, "on text", selected = true),
            local("p", "note", 1, "on the page"), local("b", "bookmark", 1))))
        assertEquals(listOf("h", "s"), painted.map { it.id }.sorted())
        val h = painted.first { it.id == "h" }
        assertEquals("#4ADE80", h.color)
        assertNull("the default look", painted.first { it.id == "s" }.color)
        assertTrue(painted.first { it.id == "s" }.note)
    }

    @Test fun `a locator that is not a PDF page is not placed on a page`() {
        val other = LocalAnnotation("x", "note", LLocator.FoliateCfi("epubcfi(/6/4)"), createdAt = "t", updatedAt = "t")
        assertTrue(PdfMarks.from(listOf(other)).isEmpty())
    }
}
