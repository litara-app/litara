package com.litara.core.auth

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.inject.Inject
import javax.inject.Singleton

/** Credentials are device-encrypted. */
@Singleton
class SecureStorage internal constructor(
    private val context: Context,
    private val prefsName: String,
    private val masterKeyAlias: String,
) {
    @Inject constructor(@ApplicationContext context: Context) : this(
        context, "litara_secure_prefs", MasterKey.DEFAULT_MASTER_KEY_ALIAS,
    )

    private val prefs: SharedPreferences = try {
        openAndValidate()
    } catch (e: Exception) {
        // Do not erase credentials for unrelated programming/runtime errors.
        if (e !is GeneralSecurityException && e !is IOException && e !is SecurityException) throw e
        Log.w("SecureStorage", "Encrypted credentials cannot be read; resetting sign-in", e)
        // Both Tink keysets are entries INSIDE this file, not a second preference file.
        // Drain pending apply() writes first: deleting the file alone lets an old write recreate
        // it with the old keysets after we have replaced the Keystore key.
        if (!context.getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit().clear().commit()) {
            throw IOException("Cannot clear encrypted preferences", e)
        }
        if (!context.deleteSharedPreferences(prefsName)) throw IOException("Cannot reset encrypted preferences", e)
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(masterKeyAlias)
        openAndValidate() // One retry only; surface persistent storage/Keystore failures.
    }

    private fun openAndValidate(): SharedPreferences {
        val masterKey = MasterKey.Builder(context, masterKeyAlias)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            prefsName,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        ).also { it.all } // Detect corrupt encrypted values as well as undecryptable keysets.
    }

    fun getString(key: String): String? = prefs.getString(key, null)

    fun putString(key: String, value: String?) {
        // commit(), not apply(): sign-in/out can end in ProcessRestarter, which kills the process right after the write, and
        // an asynchronous apply() that has not reached disk is lost (T007: the app came back signed out after Litara sign-in).
        prefs.edit().putString(key, value).commit()
    }

    fun remove(key: String) {
        prefs.edit().remove(key).commit()
    }
}
