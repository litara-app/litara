package com.litara.core.auth

import com.litara.core.model.AuthUser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/** Top-level auth state used to gate navigation (server-setup -> login -> main). */
sealed interface SessionState {
    /** Initial state before persisted credentials have been loaded. */
    data object Loading : SessionState

    /** No server configured yet — show the server-setup screen. */
    data object NeedsServer : SessionState

    /** Server known but not authenticated — show login. */
    data object SignedOut : SessionState

    data class SignedIn(val user: AuthUser) : SessionState
}

/**
 * Single source of truth for auth: server URL, access token, and the signed-in user.
 *
 * The access token and server URL are cached in memory (volatile) for synchronous access from the
 * OkHttp interceptors, and mirrored into [SecureStorage] for persistence across launches. The
 * refresh token lives only in the persisted cookie jar.
 */
@Singleton
class SessionManager @Inject constructor(
    private val storage: SecureStorage,
    private val json: Json,
) {
    @Volatile
    var accessToken: String? = null
        private set

    @Volatile
    var serverUrl: String? = null
        private set

    private val _state = MutableStateFlow<SessionState>(SessionState.Loading)
    val state: StateFlow<SessionState> = _state.asStateFlow()

    /** The signed-in user, or null when not authenticated. */
    val currentUser: AuthUser? get() = (_state.value as? SessionState.SignedIn)?.user

    /** Load persisted credentials once at startup and derive the initial [SessionState]. */
    fun bootstrap() {
        serverUrl = storage.getString(SecureStorage.KEY_SERVER_URL)
        accessToken = storage.getString(SecureStorage.KEY_ACCESS_TOKEN)
        val user = storage.getString(SecureStorage.KEY_USER)
            ?.let { runCatching { json.decodeFromString<AuthUser>(it) }.getOrNull() }

        // Data from before servers were kept apart belongs to whichever account this install already uses.
        if (!serverUrl.isNullOrBlank() && !accessToken.isNullOrBlank() && user != null) claimOwner(serverUrl!!, user.id)

        _state.value = when {
            serverUrl.isNullOrBlank() -> SessionState.NeedsServer
            accessToken.isNullOrBlank() || user == null -> SessionState.SignedOut
            else -> SessionState.SignedIn(user)
        }
    }

    /** Scope the open database was created for (see [dataScope]); null until it is first opened. */
    @Volatile
    var activeDataScope: String? = null

    /**
     * Names the on-device data (database file and download folders) of the configured server and the
     * signed-in account. Ids are per server and progress/downloads are per person, so each (server,
     * account) pair keeps its own (audit L6). The first account used owns the original data and has an
     * empty scope, which keeps existing installs and their downloads exactly where they were.
     */
    val dataScope: String
        get() {
            // A Litara-only account (no BookOrbit user) always gets a scope of its own. Data with no recorded owner is
            // never handed to it: only an explicit owner record for exactly this account may reuse the legacy scope.
            val litara = storage.getString(KEY_LITARA_SCOPE)
            if (currentUser == null && litara != null) {
                val key = "litara|$litara"
                return if (storage.getString(SecureStorage.KEY_DATA_OWNER) == key) "" else DataScope.scopeFor(key)
            }
            return DataScope.of(storage.getString(SecureStorage.KEY_DATA_OWNER), serverUrl, currentUser?.id)
        }

    /**
     * The first account to sign in owns the original data. An owner recorded before accounts were
     * separated (a bare server key) is upgraded to the first account that signs in to that server.
     */
    private fun claimOwner(server: String, userId: Int) {
        val owner = storage.getString(SecureStorage.KEY_DATA_OWNER)
        if (owner == null || owner == key(server)) storage.putString(SecureStorage.KEY_DATA_OWNER, DataScope.accountKey(server, userId))
    }

    private fun key(url: String) = DataScope.key(url)

    private companion object {
        /** Written by the Litara session store: `<serverId>|<userId>` while a Litara account is signed in. */
        const val KEY_LITARA_SCOPE = "litara_scope"
    }

    /** True when the configured server's data is not what the open database holds (needs an app restart). */
    fun dataScopeChanged(): Boolean = activeDataScope?.let { it != dataScope } == true

    fun setServerUrl(url: String) {
        serverUrl = url.trimEnd('/')
        storage.putString(SecureStorage.KEY_SERVER_URL, serverUrl)
        if (_state.value is SessionState.Loading || _state.value is SessionState.NeedsServer) {
            _state.value = SessionState.SignedOut
        }
    }

    /** Reverts to the no-server state (used when a setup-status probe fails during onboarding). */
    fun clearServer() {
        serverUrl = null
        storage.remove(SecureStorage.KEY_SERVER_URL)
        _state.value = SessionState.NeedsServer
    }

    fun signIn(token: String, user: AuthUser) {
        // The first account anyone signs in with owns the original data; later ones get their own.
        serverUrl?.let { claimOwner(it, user.id) }
        accessToken = token
        storage.putString(SecureStorage.KEY_ACCESS_TOKEN, token)
        storage.putString(SecureStorage.KEY_USER, json.encodeToString(AuthUser.serializer(), user))
        _state.value = SessionState.SignedIn(user)
    }

    /** Called by [com.litara.core.network.TokenRefresher] after a successful silent refresh. */
    fun updateAccessToken(token: String) {
        accessToken = token
        storage.putString(SecureStorage.KEY_ACCESS_TOKEN, token)
    }

    /** Clears the token/user but keeps the server URL so the user lands back on login. */
    fun signOut() {
        accessToken = null
        storage.remove(SecureStorage.KEY_ACCESS_TOKEN)
        storage.remove(SecureStorage.KEY_USER)
        storage.remove(SecureStorage.KEY_COOKIES)
        if (serverUrl.isNullOrBlank()) {
            _state.value = SessionState.NeedsServer
        } else {
            _state.value = SessionState.SignedOut
        }
    }
}
