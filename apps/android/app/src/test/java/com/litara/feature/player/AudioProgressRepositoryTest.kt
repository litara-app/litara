package com.litara.feature.player

import android.util.Log
import com.litara.core.db.AudioProgressDao
import com.litara.core.db.AudioProgressEntity
import com.litara.core.model.AudioProgress
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.unmockkStatic
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Instant

class AudioProgressRepositoryTest {
    private val handle = LitaraSource.HANDLE_BASE + 5
    private val dao: AudioProgressDao = mockk(relaxed = true)
    private val source: LitaraSource = mockk(relaxed = true)
    private val repo = AudioProgressRepository(dao, source)

    @Before
    fun setUp() {
        mockkStatic(Log::class)
        every { Log.w(any(), any<String>()) } returns 0
        every { source.owns(handle) } returns true
        every { source.owns(neq(handle)) } returns false
        coEvery { dao.dirtyEntries() } returns emptyList()
        coEvery { dao.get(any()) } returns null
        coEvery { source.serverPosition(any()) } returns null
    }

    @After
    fun tearDown() = unmockkStatic(Log::class)

    private fun row(id: Int = handle, file: Int = 7, seconds: Double = 30.0, at: Long = 100L, dirty: Boolean = false) =
        AudioProgressEntity(id, file, seconds, 5.0, at, dirty)

    @Test
    fun `a report is written locally then pushed through the source`() = runTest {
        coEvery { source.push(handle, 7, 12.5) } returns true
        repo.report(handle, 7, 12.5, 10.0)
        coVerify { dao.upsert(match { it.bookId == handle && it.dirty }) }
        coVerify(exactly = 1) { source.push(handle, 7, 12.5) }
        coVerify { dao.markSynced(handle, any()) }
        coVerify(exactly = 0) { source.retryLater() }
    }

    @Test
    fun `only the position that was sent is marked as sent`() = runTest {
        coEvery { source.push(any(), any(), any()) } returns true
        coEvery { dao.dirtyEntries() } returnsMany listOf(listOf(row(at = 4_321L, dirty = true)), emptyList())
        repo.flushPending()
        coVerify(exactly = 1) { dao.markSynced(handle, 4_321L) }
    }

    @Test
    fun `a push that did not get through stays dirty for a retry`() = runTest {
        coEvery { source.push(any(), any(), any()) } returns false
        repo.report(handle, 7, 1.0, 1.0)
        coEvery { source.push(any(), any(), any()) } throws RuntimeException("offline")
        repo.report(handle, 7, 2.0, 1.0)
        coVerify(exactly = 0) { dao.markSynced(any(), any()) }
        coVerify(exactly = 2) { source.retryLater() }
    }

    @Test
    fun `flushPending says whether anything is still waiting`() = runTest {
        coEvery { source.push(any(), any(), any()) } returns true
        coEvery { dao.dirtyEntries() } returnsMany listOf(listOf(row(dirty = true)), emptyList())
        assertFalse(repo.flushPending())
        coVerify { dao.markSynced(handle, any()) }

        coEvery { source.push(any(), any(), any()) } returns false
        coEvery { dao.dirtyEntries() } returns listOf(row(dirty = true))
        assertTrue(repo.flushPending())
    }

    @Test
    fun `resume follows the server's canonical revision even when the device clock is newer`() = runTest {
        coEvery { dao.get(handle) } returns row(seconds = 500.0, at = System.currentTimeMillis() + 60_000)
        coEvery { source.serverPosition(handle) } returns AudioProgress(8, 30.0, 10.0, "2026-11-13T12:00:00Z")
        val point = repo.resumePoint(handle)!!
        assertEquals("canonical server position wins over a newer device clock", 8, point.progress.currentFileId)
        assertEquals(30.0, point.progress.positionSeconds, 0.0)
        assertEquals(Instant.parse("2026-11-13T12:00:00Z").toEpochMilli(), point.lastActivityMillis)
    }

    @Test
    fun `a server position without a timestamp ranks as oldest`() = runTest {
        coEvery { source.serverPosition(handle) } returns AudioProgress(10, 30.0, 12.0, null)
        assertEquals(0L, repo.resumePoint(handle)!!.lastActivityMillis)
    }

    @Test
    fun `resume falls back to the local row and time when the server is unreachable`() = runTest {
        coEvery { dao.get(handle) } returns row(seconds = 500.0, at = 555L)
        coEvery { source.serverPosition(handle) } throws RuntimeException("offline")
        val point = repo.resumePoint(handle)!!
        assertEquals(500.0, point.progress.positionSeconds, 0.0)
        assertEquals(555L, point.lastActivityMillis)
    }

    @Test
    fun `with no position anywhere there is nothing to resume`() = runTest {
        assertNull(repo.resolveResume(handle))
    }

    @Test
    fun `localResumePoint reads only the local row`() = runTest {
        coEvery { dao.get(handle) } returns row(at = 777L)
        assertEquals(777L, repo.localResumePoint(handle)!!.lastActivityMillis)
        coVerify(exactly = 0) { source.serverPosition(any()) }
    }

    @Test
    fun `natural end is sent only for the signed-in account's recordings`() = runTest {
        repo.playbackEnded(handle)
        repo.playbackEnded(handle + 1)
        coVerify(exactly = 1) { source.ended(handle) }
        coVerify(exactly = 0) { source.ended(handle + 1) }
    }

    @Test
    fun `a position whose account is locked or signed out is neither sent nor dropped`() = runTest {
        val locked = LitaraSource.HANDLE_BASE + 9
        coEvery { dao.dirtyEntries() } returns listOf(row(id = locked, dirty = true))
        coEvery { dao.get(locked) } returns row(id = locked, dirty = true)
        repo.flushPending()
        repo.resumePoint(locked, flush = false)
        coVerify(exactly = 0) { source.push(any(), any(), any()) }
        coVerify(exactly = 0) { source.serverPosition(locked) }
        coVerify(exactly = 0) { dao.markSynced(locked, any()) }
    }
}
