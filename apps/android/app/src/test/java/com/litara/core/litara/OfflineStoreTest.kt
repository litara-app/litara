package com.litara.core.litara

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** Audit L6 at the storage layer: serverId + userId partition, and in-flight tasks cannot cross scopes. */
class OfflineStoreTest {
    @get:Rule val tmp = TemporaryFolder()

    private val a = AccountScope("server-1", "user-a")
    private val b = AccountScope("server-1", "user-b")

    @Test
    fun `scopes never share a directory and identifiers never become path components`() {
        val store = OfflineStore(tmp.root)
        assertNotEquals(a.dirName(), b.dirName())
        assertNotEquals(a.dirName(), AccountScope("server-2", "user-a").dirName())
        assertFalse(a.dirName().contains("user") || a.dirName().contains("server"))
        assertTrue(store.dir(a).parentFile == tmp.root)
    }

    @Test
    fun `a download that finishes after an account switch cannot publish into the new scope`() {
        val store = OfflineStore(tmp.root)
        val tokenA = store.activate(a)
        // Account A starts a download; before it completes the user switches to account B.
        store.activate(b)
        try {
            store.publish(tokenA) { dir -> File(dir, "book.mp3").writeText("A's bytes") }
            fail("A's late result must not be committed")
        } catch (e: StaleScopeException) { /* expected */ }
        val tokenB = store.begin()
        store.publish(tokenB) { dir -> assertEquals(0, dir.listFiles()!!.size) }
        assertFalse("nothing from A may appear under B", File(store.dir(b), "book.mp3").exists())
        assertFalse(File(store.dir(a), "book.mp3").exists())
    }

    @Test
    fun `logout locks immediately and a task started before it cannot commit`() {
        val store = OfflineStore(tmp.root)
        val token = store.activate(a)
        store.lock()
        try { store.publish(token) { } ; fail() } catch (e: StaleScopeException) { /* expected */ }
        try { store.begin(); fail("no scope may start while locked") } catch (e: StaleScopeException) { /* expected */ }
    }

    @Test
    fun `switching back finds the first account's preserved data and an old token stays dead`() {
        val store = OfflineStore(tmp.root)
        val first = store.activate(a)
        store.publish(first) { File(it, "snapshot.json").writeText("{\"a\":1}") }
        store.lock()
        store.activate(b)
        store.lock()
        val again = store.activate(a) // restore requires re-authenticating the same account, then a NEW token
        store.read(again) { assertEquals("{\"a\":1}", File(it, "snapshot.json").readText()) }
        try { store.publish(first) { }; fail("tokens from before the lock must not revive") } catch (e: StaleScopeException) { /* expected */ }
    }
}
