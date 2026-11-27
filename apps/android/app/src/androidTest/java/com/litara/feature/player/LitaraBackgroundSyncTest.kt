package com.litara.feature.player

import androidx.media3.common.util.UnstableApi
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.litara.core.auth.SecureStorage
import com.litara.core.db.AudioProgressEntity
import com.litara.feature.litara.LitaraSessionStore
import com.litara.feature.litara.LitaraTestDependencies
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * A listening position left unsent is sent by the background job, with no player or screen open. Needs a running seeded
 * server: litaraUrl, litaraPassword, litaraAlternate (a recording no other player test uses for positions).
 */
@UnstableApi
@RunWith(AndroidJUnit4::class)
class LitaraBackgroundSyncTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val args = InstrumentationRegistry.getArguments()

    @Test fun anUnsentPositionIsSentInTheBackground() = runBlocking<Unit> {
        val url = args.getString("litaraUrl")
        val password = args.getString("litaraPassword")
        val recording = args.getString("litaraAlternate")
        assumeTrue("litaraUrl/litaraPassword/litaraAlternate not provided; real-server sync test not run",
            url != null && password != null && recording != null)

        val deps = EntryPointAccessors.fromApplication(context, LitaraTestDependencies::class.java)
        val repo = deps.repository()
        repo.allowProcessRestart = false
        deps.dataScope().active = null
        LitaraSessionStore(SecureStorage(context)).let { runCatching { runBlocking { repo.signOut() } }; it.forgetIdentity() }
        File(context.filesDir, "litara-offline").deleteRecursively()
        repo.signIn(url!!, true, "fixture-user-a", password!!, "Sync test")
        deps.dataScope().active = null

        val backend = deps.backend()
        backend.cards()
        val client = repo.clientOrNull()!!
        val snap = client.snapshot(recording!!)
        val handle = backend.handleFor(recording)!!
        val file = snap.files.first()
        val before = client.position(recording).position?.offsetMs
        val wanted = if (before == 7_000L) 8_000L else 7_000L
        val dao = EntryPointAccessors.fromApplication(context, AutoTestDependencies::class.java).database().audioProgressDao()
        dao.upsert(AudioProgressEntity(handle, backend.handleFor(file.id)!!, wanted / 1000.0, 1.0, System.currentTimeMillis(), dirty = true))
        assertNotEquals(wanted, client.position(recording).position?.offsetMs)

        backend.retryLater() // what a failed send asks for; WorkManager runs it once there is a network

        val deadline = System.currentTimeMillis() + 60_000
        while (System.currentTimeMillis() < deadline &&
            (client.position(recording).position?.offsetMs != wanted || dao.get(handle)?.dirty != false)) Thread.sleep(500)
        assertEquals("the server has the position", wanted, client.position(recording).position?.offsetMs)
        assertEquals("and the device no longer waits to send it", false, dao.get(handle)?.dirty)
    }
}
