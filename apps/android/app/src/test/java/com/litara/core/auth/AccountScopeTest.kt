package com.litara.core.auth

import com.litara.core.litara.LUser
import com.litara.feature.litara.LitaraIdentity
import com.litara.feature.litara.LitaraSessionStore
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Audit L6: on-device data is partitioned by server AND account, so accounts never share positions,
 * downloads or queued writes, and none of them reads the unscoped data set.
 */
class AccountScopeTest {
    private val values = mutableMapOf<String, String?>()
    private val storage: SecureStorage = mockk<SecureStorage>(relaxed = true).also { s ->
        every { s.getString(any()) } answers { values[firstArg()] }
        every { s.putString(any(), any()) } answers { values[firstArg()] = secondArg() }
        every { s.remove(any()) } answers { values.remove(firstArg<String>()) }
    }
    private val store = LitaraSessionStore(storage)
    private val scope = AccountDataScope(storage)

    private fun signIn(server: String, user: String) =
        store.saveIdentity(LitaraIdentity("https://litara.example", server, LUser(user, "u", "U", false, true), false))

    @Test
    fun `signed out is the unscoped set`() {
        assertEquals("", scope.current)
    }

    @Test
    fun `an account keeps the scope name earlier builds gave it`() {
        signIn("srv-1", "user-1")
        assertEquals("c7c390592d33", scope.current)
    }

    @Test
    fun `two accounts and two servers never share a scope`() {
        signIn("srv-1", "user-1")
        val first = scope.current
        store.forgetIdentity()
        signIn("srv-1", "user-2")
        val second = scope.current
        store.forgetIdentity()
        signIn("srv-2", "user-1")
        assertEquals(3, setOf(first, second, scope.current).size)
        assertTrue(listOf(first, second, scope.current).all { it.length == 12 })
    }

    @Test
    fun `switching account requires reopening the data set`() {
        signIn("srv-1", "user-1")
        scope.active = scope.current
        assertFalse(scope.changed())
        store.forgetIdentity()
        signIn("srv-1", "user-2")
        assertTrue("the second account must not keep reading the first one's open database", scope.changed())
    }

    @Test
    fun `a returning account finds its own data again`() {
        signIn("srv-1", "user-1")
        val mine = scope.current
        store.forgetIdentity()
        assertNotEquals(mine, scope.current)
        signIn("srv-1", "user-1")
        assertEquals(mine, scope.current)
    }
}
