package com.litara.core.litara

import org.junit.Assert.assertEquals
import org.junit.Test

class StartedRecordingsTest {
    private fun recording(id: String, at: String?, finished: Boolean = false, readiness: String = "ready") =
        LRecordingSummary(
            id = id, titleId = id, title = id, readiness = readiness, durationMs = 1_000,
            completion = LCompletion("1", finished, null), lastActivityAt = at,
        )

    @Test fun `only started, unfinished and playable recordings, newest first`() {
        val items = listOf(
            recording("never", null),
            recording("older", "2026-11-01T10:00:00Z"),
            recording("newer", "2026-11-02T10:00:00.5Z"),
            recording("done", "2026-11-03T10:00:00Z", finished = true),
            recording("partial", "2026-11-04T10:00:00Z", readiness = "incomplete"),
        )
        assertEquals(listOf("newer", "older"), startedRecordings(items).map { it.id })
    }

    @Test fun `a list cached before these fields existed still reads`() {
        val old = LitaraJson.decodeFromString<LRecordingSummary>(
            """{"id":"a","titleId":"t","title":"A","readiness":"ready","durationMs":null}""",
        )
        assertEquals(emptyList<LRecordingSummary>(), startedRecordings(listOf(old)))
    }
}
