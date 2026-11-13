package com.litara.core.auth

import com.litara.core.model.AuthUser
import io.mockk.every
import io.mockk.mockk
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Audit L6 regression. The imported baseline partitioned the on-device database and download
 * folders per SERVER only, so two accounts on one server shared local audio/reader progress,
 * downloads and queued writes (and SyncWorker could upload account A's dirty position while
 * signed in as B). Data must be partitioned by server AND account.
 *
 * Written to fail against the unmodified baseline first (see handoffs/T003.md for the recorded
 * failing run), then fixed in [DataScope] / [SessionManager].
 */
class AccountScopeTest {
    private val values = mutableMapOf<String, String?>()
    private lateinit var storage: SecureStorage
    private lateinit var session: SessionManager

    private val server = "https://litara.example.com"
    private fun user(id: Int) = AuthUser(id = id, username = "user$id")

    @Before
    fun setUp() {
        values.clear()
        storage = mockk(relaxed = true)
        every { storage.getString(any()) } answers { values[firstArg()] }
        every { storage.putString(any(), any()) } answers { values[firstArg()] = secondArg() }
        every { storage.remove(any()) } answers { values.remove(firstArg<String>()) }
        session = SessionManager(storage, Json { ignoreUnknownKeys = true })
        session.bootstrap()
        session.setServerUrl(server)
    }

    @Test
    fun `two accounts on one server never share a data scope`() {
        session.signIn("token-a", user(1))
        val scopeA = session.dataScope
        session.signOut()
        session.signIn("token-b", user(2))
        val scopeB = session.dataScope
        assertNotEquals("accounts A and B would share one database and download folder", scopeA, scopeB)
    }

    @Test
    fun `switching account on the same server requires reopening the data set`() {
        session.signIn("token-a", user(1))
        session.activeDataScope = session.dataScope // the database was opened for account A
        session.signOut()
        session.signIn("token-b", user(2))
        assertTrue("B must not keep reading A's open database", session.dataScopeChanged())
    }

    @Test
    fun `the same account keeps its own data across sign out and back in`() {
        session.signIn("token-a", user(1))
        session.activeDataScope = session.dataScope
        session.signOut()
        assertFalse(session.dataScopeChanged()) // signed out stays on the owner's data
        session.signIn("token-a2", user(1))
        assertFalse(session.dataScopeChanged())
    }

    @Test
    fun `an account and server pair maps to a stable distinct scope`() {
        session.signIn("token-a", user(1))
        session.signOut()
        session.signIn("token-b", user(2))
        val b = session.dataScope
        session.signOut()
        session.signIn("token-b2", user(2))
        assertEquals("a returning account must find its own data again", b, session.dataScope)
        assertEquals(12, b.length)
    }

    @Test
    fun `the first account to sign in after upgrade claims the pre-existing unscoped data`() {
        // Pre-fix installs recorded only the server as the data owner.
        values[SecureStorage.KEY_DATA_OWNER] = DataScope.key(server)
        session.signIn("token-a", user(7))
        assertEquals("", session.dataScope)
        session.signOut()
        session.signIn("token-b", user(8))
        assertNotEquals("", session.dataScope)
    }
}
