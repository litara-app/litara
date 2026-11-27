package com.litara.core.auth

import javax.inject.Inject
import javax.inject.Singleton

/**
 * Which on-device data set the signed-in account uses (audit L6): its database and cached files. Each
 * (server, account) pair gets its own, so progress, downloads and queued writes of two accounts never
 * mix. Signed out is the empty scope.
 */
@Singleton
class AccountDataScope @Inject constructor(
    private val storage: SecureStorage,
) {
    /** Scope the open database was created for (see [current]); null until it is first opened. */
    @Volatile
    var active: String? = null

    /** An account always gets a scope of its own; it is never handed the unscoped data. */
    val current: String
        get() = storage.getString(KEY_ACCOUNT_SCOPE)?.let { DataScope.scopeFor("litara|$it") }.orEmpty()

    /** True when the signed-in account's data is not what the open database holds (needs an app restart). */
    fun changed(): Boolean = active?.let { it != current } == true

    private companion object {
        /** Written by the session store: `<serverId>|<userId>` while an account is signed in. */
        const val KEY_ACCOUNT_SCOPE = "litara_scope"
    }
}
