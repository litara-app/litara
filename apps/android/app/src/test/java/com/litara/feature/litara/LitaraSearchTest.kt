package com.litara.feature.litara

import com.litara.core.litara.LRecordingSummary
import com.litara.core.litara.LSeries
import com.litara.core.litara.LitaraJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LitaraSearchTest {
    private val fields = listOf("Les Misérables", "Victor Hugo", "Classics")

    @Test fun `every word must match, ignoring case, accents and spacing`() {
        assertTrue(matchesSearch("  MISERABLES   hugo ", fields))
        assertTrue(matchesSearch("classics", fields))
        assertFalse(matchesSearch("hugo dumas", fields))
    }

    @Test fun `a blank query keeps everything`() {
        assertTrue(matchesSearch("   ", emptyList()))
    }

    private fun row(id: String, title: String, narrator: String, series: String? = null) = LibraryRow(
        handle = 1,
        summary = LRecordingSummary(
            id = id, titleId = id, title = title, readiness = "ready", durationMs = null,
            narrators = listOf(narrator), series = series?.let { LSeries(it, 1.0) },
        ),
        downloaded = false,
    )

    @Test fun `recordings match on title, narrator and series in their original order`() {
        val rows = listOf(row("a", "Dune", "Scott Brick", "Dune Chronicles"), row("b", "Emma", "Juliet Stevenson"))
        assertEquals(listOf("b"), searchRecordings(rows, "stevenson").map { it.summary.id })
        assertEquals(listOf("a"), searchRecordings(rows, "chronicles").map { it.summary.id })
        assertEquals(listOf("a", "b"), searchRecordings(rows, "").map { it.summary.id })
    }

    @Test fun `the server's recording series is read, and may be null`() {
        val json = """{"id":"a","titleId":"t","title":"A","readiness":"ready","durationMs":null,"series":%s}"""
        val with = LitaraJson.decodeFromString<LRecordingSummary>(json.format("""{"name":"Saga","index":null}"""))
        assertEquals("Saga", with.series?.name)
        assertEquals(null, LitaraJson.decodeFromString<LRecordingSummary>(json.format("null")).series)
    }
}
