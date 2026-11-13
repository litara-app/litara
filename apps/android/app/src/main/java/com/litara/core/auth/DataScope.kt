package com.litara.core.auth

import java.security.MessageDigest

/**
 * Which on-device data set belongs to a server AND an account (audit L6, ADR-0013).
 *
 * The first account to use the app owns the original, unscoped data set (empty scope), which keeps
 * existing installs and their downloads where they were. Every other (server, account) pair gets its
 * own stable 12-hex scope, so downloads, positions, restore state and queued writes of two accounts
 * can never mix. Signed out, the scope stays on the server's owner data and carries no account.
 */
object DataScope {
    /** Normalizes a server URL so trivial differences (case, trailing slash) don't make a "new" server. */
    fun key(url: String): String = url.trim().trimEnd('/').lowercase()

    /** The ownership key of one account on one server: `<server>|<userId>`. */
    fun accountKey(url: String, userId: Int): String = key(url) + "|" + userId

    /**
     * "" for the data set the install already owns (or when nothing is configured), else a short stable id.
     *
     * [owner] is either a bare server key (installs from before accounts were separated) or an
     * [accountKey]. [userId] is the signed-in account, or null when signed out.
     */
    fun of(owner: String?, serverUrl: String?, userId: Int? = null): String {
        val url = serverUrl?.takeIf { it.isNotBlank() } ?: return ""
        val server = key(url)
        if (owner == null) return ""
        if (userId == null) {
            // Signed out: nothing account-specific may be read; stay on the owner's data for this server.
            return if (owner.substringBefore('|') == server) "" else hash(server)
        }
        val account = accountKey(url, userId)
        return if (owner == account) "" else hash(account)
    }

    /** The stable 12-hex scope for an arbitrary ownership key. */
    fun scopeFor(key: String): String = hash(key)

    private fun hash(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }.take(12)
}
