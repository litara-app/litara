package com.litara.feature.litara

import com.litara.core.auth.SecureStorage
import com.litara.core.auth.SessionManager
import com.litara.core.litara.LUser
import io.mockk.every
import io.mockk.mockk
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * R3: data whose owner is unknown (an install from before ownership was recorded) is never handed to
 * the first Litara account. The legacy Room database and downloads stay in the unattributed (empty) scope;
 * a Litara account always gets a scope of its own, so Auto's Downloaded shelf and pending progress cannot leak.
 */
class LegacyDataOwnershipTest {
    private val values = mutableMapOf<String, String?>()
    private val storage: SecureStorage = mockk<SecureStorage>(relaxed = true).also { s ->
        every { s.getString(any()) } answers { values[firstArg()] }
        every { s.putString(any(), any()) } answers { values[firstArg()] = secondArg() }
        every { s.remove(any()) } answers { values.remove(firstArg<String>()) }
    }

    private fun identity(server: String, user: String) =
        LitaraIdentity("https://litara.example", server, LUser(user, "u", "U", false, true), false)

    @Test
    fun `the first Litara sign-in does not claim unidentified legacy data`() {
        val store = LitaraSessionStore(storage)
        assertNull(values[SecureStorage.KEY_DATA_OWNER])
        store.saveIdentity(identity("srv-1", "user-1"))
        assertNull("no evidence of ownership exists, so nobody owns the legacy data", values[SecureStorage.KEY_DATA_OWNER])
    }

    @Test
    fun `a Litara account never reads the legacy unscoped data set`() {
        val store = LitaraSessionStore(storage)
        store.saveIdentity(identity("srv-1", "user-1"))
        val session = SessionManager(storage, Json { ignoreUnknownKeys = true })
        session.bootstrap()
        val scope = session.dataScope
        assertNotEquals("the empty legacy scope would expose unknown-owner downloads and progress", "", scope)
        store.forgetIdentity()
        store.saveIdentity(identity("srv-1", "user-2"))
        assertNotEquals("two Litara accounts must not share a scope", scope, session.dataScope)
        assertTrue(session.dataScope.isNotEmpty())
        assertEquals(12, session.dataScope.length)
    }
}
