package com.litara.core.litara

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** R6: replacing a manifest is an atomic swap; an interruption leaves a complete old or complete new file. */
class AtomicFileTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test
    fun `a leftover partial temp file from an interrupted write never replaces the old manifest`() {
        val target = File(tmp.root, "downloaded.json")
        AtomicFile.write(target, """{"v":1}""")
        File(tmp.root, "downloaded.json.tmp").writeText("""{"v":2,"trunc""")
        assertEquals("""{"v":1}""", target.readText())
    }

    @Test
    fun `the next write replaces the manifest completely and leaves no temp file`() {
        val target = File(tmp.root, "downloaded.json")
        AtomicFile.write(target, "old")
        File(tmp.root, "downloaded.json.tmp").writeText("stale partial")
        AtomicFile.write(target, "new and longer content")
        assertEquals("new and longer content", target.readText())
        assertFalse(File(tmp.root, "downloaded.json.tmp").exists())
    }

    @Test
    fun `a shorter replacement is not mixed with the longer old bytes`() {
        val target = File(tmp.root, "m.json")
        AtomicFile.write(target, "x".repeat(10_000))
        AtomicFile.write(target, "short")
        assertEquals("short", target.readText())
    }
}
