package com.litara.feature.litara

import com.litara.core.auth.SecureStorage
import com.litara.core.litara.CredentialStore
import com.litara.core.litara.LUser
import com.litara.core.litara.LitaraJson
import com.litara.core.litara.StoredCredentials
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import javax.inject.Inject
import javax.inject.Singleton

/** Which server and account the Litara credentials belong to. Non-secret facts, kept next to the tokens. */
@Serializable
data class LitaraIdentity(val serverUrl: String, val serverId: String, val user: LUser, val allowInsecureHttp: Boolean)

/**
 * Protected storage for the Litara session: opaque access/refresh tokens, the pending refresh request
 * id (ADR-0033) and the identity, all in [SecureStorage] (device-encrypted). Separate keys from the
 * legacy BookOrbit session, which stays untouched.
 */
@Singleton
class LitaraSessionStore @Inject constructor(private val storage: SecureStorage) : CredentialStore {
    override fun load(): StoredCredentials? {
        val a = storage.getString(KEY_ACCESS) ?: return null
        val r = storage.getString(KEY_REFRESH) ?: return null
        return StoredCredentials(a, r)
    }

    override fun save(credentials: StoredCredentials) {
        storage.putString(KEY_ACCESS, credentials.accessToken)
        storage.putString(KEY_REFRESH, credentials.refreshToken)
    }

    override fun clear() {
        storage.remove(KEY_SCOPE)
        storage.remove(KEY_ACCESS)
        storage.remove(KEY_REFRESH)
        storage.remove(KEY_PENDING)
    }

    override var pendingRefreshId: String?
        get() = storage.getString(KEY_PENDING)
        set(value) = if (value == null) storage.remove(KEY_PENDING) else storage.putString(KEY_PENDING, value)

    fun identity(): LitaraIdentity? =
        storage.getString(KEY_IDENTITY)?.let { runCatching { LitaraJson.decodeFromString<LitaraIdentity>(it) }.getOrNull() }

    fun saveIdentity(identity: LitaraIdentity) {
        storage.putString(KEY_IDENTITY, LitaraJson.encodeToString(identity))
        // Read by SessionManager so the Room database and downloads are scoped to this server + account.
        storage.putString(KEY_SCOPE, "${identity.serverId}|${identity.user.id}")
        // Like any first account, the first one to use an empty install owns the original (unscoped) data set.
        if (storage.getString(SecureStorage.KEY_DATA_OWNER) == null) {
            storage.putString(SecureStorage.KEY_DATA_OWNER, "litara|${identity.serverId}|${identity.user.id}")
        }
    }

    /** Test/support hook: forget the whole Litara identity as well (offline data on disk is untouched). */
    fun forgetIdentity() { clear(); storage.remove(KEY_IDENTITY) }

    /** Forgets credentials but keeps the identity so offline data stays addressable (and locked) per account. */
    fun signOutKeepIdentity() = clear()

    private companion object {
        const val KEY_ACCESS = "litara_access"
        const val KEY_REFRESH = "litara_refresh"
        const val KEY_PENDING = "litara_pending_refresh"
        const val KEY_IDENTITY = "litara_identity"
        const val KEY_SCOPE = "litara_scope"
    }
}
