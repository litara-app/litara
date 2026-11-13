package com.litara.feature.player

import android.util.Log
import com.litara.core.db.AudioProgressDao
import com.litara.core.db.AudioProgressEntity
import com.litara.core.model.AudioProgress
import com.litara.core.network.ApiService
import com.litara.core.network.AudiobookAssetResolver
import com.litara.core.sync.SyncScheduler
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.unmockkStatic
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/** Litara handles route to the Litara source; BookOrbit ids and server-clock winners are untouched. */
class AudioProgressLitaraRoutingTest {
    private val handle = LitaraSource.HANDLE_BASE + 5
    private lateinit var dao: AudioProgressDao
    private lateinit var api: ApiService
    private lateinit var source: LitaraSource
    private lateinit var repo: AudioProgressRepository

    @Before
    fun setUp() {
        mockkStatic(Log::class)
        every { Log.w(any(), any<String>()) } returns 0
        dao = mockk(relaxed = true)
        api = mockk()
        source = mockk(relaxed = true)
        every { source.owns(handle) } returns true
        every { source.owns(neq(handle)) } returns false
        repo = AudioProgressRepository(dao, api, mockk(), Json { ignoreUnknownKeys = true }, mockk<SyncScheduler>(relaxed = true), source)
    }

    @After
    fun tearDown() = unmockkStatic(Log::class)

    @Test
    fun `a Litara report is written locally then pushed through the source, never to the old API`() = runBlocking {
        coEvery { source.push(handle, 7, 12.5) } returns true
        repo.report(handle, 7, 12.5, 10.0)
        coVerify { dao.upsert(match { it.bookId == handle && it.dirty }) }
        coVerify(exactly = 1) { source.push(handle, 7, 12.5) }
        coVerify { dao.markSynced(handle) }
    }

    @Test
    fun `an offline Litara push stays dirty for a retry`() = runBlocking {
        coEvery { source.push(any(), any(), any()) } returns false
        repo.report(handle, 7, 1.0, 1.0)
        coVerify(exactly = 0) { dao.markSynced(any()) }
    }

    @Test
    fun `resume follows the server's canonical revision even when the device clock is newer`() = runBlocking {
        val local = AudioProgressEntity(handle, 7, 500.0, 90.0, System.currentTimeMillis() + 60_000, dirty = false)
        coEvery { dao.get(handle) } returns local
        coEvery { dao.dirtyEntries() } returns emptyList()
        coEvery { source.serverPosition(handle) } returns AudioProgress(8, 30.0, 10.0, "2026-11-13T12:00:00Z")
        val point = repo.resumePoint(handle)!!
        assertEquals("canonical server position wins over a newer device clock", 8, point.progress.currentFileId)
        assertEquals(30.0, point.progress.positionSeconds, 0.0)
    }

    @Test
    fun `resume falls back to the local row when the server is unreachable`() = runBlocking {
        val local = AudioProgressEntity(handle, 7, 500.0, 90.0, 1_000L, dirty = true)
        coEvery { dao.get(handle) } returns local
        coEvery { dao.dirtyEntries() } returns emptyList()
        coEvery { source.serverPosition(handle) } returns null
        assertEquals(500.0, repo.resumePoint(handle)!!.progress.positionSeconds, 0.0)
    }

    @Test
    fun `natural end is routed to the source only for Litara books`() = runBlocking {
        repo.playbackEnded(handle)
        repo.playbackEnded(42)
        coVerify(exactly = 1) { source.ended(handle) }
        coVerify(exactly = 0) { source.ended(42) }
    }
}
