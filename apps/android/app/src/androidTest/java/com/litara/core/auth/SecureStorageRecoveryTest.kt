package com.litara.core.auth

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.security.KeyStore
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Uses a separate key and file; never resets the signed-in app's credentials. */
@RunWith(AndroidJUnit4::class)
class SecureStorageRecoveryTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "recovery_test_${System.nanoTime()}"
    private val alias = "$name.key"

    private fun open() = SecureStorage(context, name, alias)

    @After fun cleanup() {
        context.deleteSharedPreferences(name)
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias)
    }

    @Test fun lostKeystoreKeyResetsCredentialsAndStaysUsable() {
        open().putString("token", "test-token")
        assertEquals("test-token", open().getString("token"))
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias)
        val recovered = open()
        assertNull(recovered.getString("token"))
        recovered.putString("token", "replacement")
        assertEquals("replacement", open().getString("token"))
    }
}
