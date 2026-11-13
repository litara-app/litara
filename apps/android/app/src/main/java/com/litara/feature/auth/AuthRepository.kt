package com.litara.feature.auth

import android.content.Context
import com.litara.core.auth.SessionManager
import com.litara.core.data.ProcessRestarter
import dagger.hilt.android.qualifiers.ApplicationContext
import com.litara.core.model.LoginRequest
import com.litara.core.model.OidcCallbackResponse
import com.litara.core.model.OidcProviderPublic
import com.litara.core.model.SetupStatus
import com.litara.core.network.ApiService
import com.litara.core.sync.SyncScheduler
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Auth-flow operations. Wraps [ApiService] and commits successful logins into [SessionManager].
 */
@Singleton
class AuthRepository @Inject constructor(
    private val api: ApiService,
    private val session: SessionManager,
    @ApplicationContext private val context: Context,
    private val syncScheduler: SyncScheduler,
) {
    /**
     * Sends what was queued while signed out (the sync worker skips its run then). Each server keeps
     * its own database (see [SessionManager.dataScope]). The open one belongs to the server we were
     * using, so after signing in to another server the app restarts onto the right one; the queued
     * sync survives the restart.
     */
    private fun afterSignIn() {
        syncScheduler.schedule()
        if (session.dataScopeChanged()) ProcessRestarter.restart(context)
    }

    /** Probes the configured server. Throws if unreachable / not a Litara server. */
    suspend fun setupStatus(): SetupStatus = api.getSetupStatus()

    suspend fun login(username: String, password: String) {
        val result = api.login(LoginRequest(username.trim(), password))
        session.signIn(result.accessToken, result.user)
        afterSignIn()
    }

    /** Returns enabled OIDC providers, or an empty list if the endpoint is unavailable. */
    suspend fun oidcProviders(): List<OidcProviderPublic> =
        runCatching { api.getPublicOidcProviders() }.getOrDefault(emptyList())

    /** Commits an OIDC login result into the session. */
    fun commitOidc(result: OidcCallbackResponse) {
        session.signIn(result.accessToken, result.user)
        afterSignIn()
    }

    suspend fun logout() {
        runCatching { api.logout() }
        session.signOut()
    }
}
