package com.litara.core.litara

import java.io.File
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicLong

/** Stable local ownership of offline data: the server's persisted identity plus the account (ADR-0013, 0035). */
data class AccountScope(val serverId: String, val userId: String) {
    /** Directory name: a hash, so server and user identifiers never become path components. */
    fun dirName(): String =
        MessageDigest.getInstance("SHA-256").digest("$serverId|$userId".toByteArray()).joinToString("") { "%02x".format(it) }.take(24)
}

/** Raised when a task tries to publish a result after its originating scope was locked or replaced. */
class StaleScopeException(message: String) : Exception(message)

/** A task's binding to the scope and lock generation it started under. */
class ScopeToken internal constructor(val scope: AccountScope, internal val generation: Long)

/**
 * Account-scoped offline storage. Snapshots, downloaded files, positions and queued writes live under
 * `<root>/<scope-hash>/`. Every long task takes a [ScopeToken] at start and must publish through
 * [publish]; logout or an account switch bumps the generation, so a response that arrives later can
 * never commit into the new scope (cancellation alone is not enough). Locked data is preserved, not
 * pruned, and a second account can neither read it nor upload its queued work.
 */
class OfflineStore(private val root: File) {
    private val generation = AtomicLong(0)

    @Volatile
    private var active: AccountScope? = null

    val activeScope: AccountScope? get() = active

    /** Activates [scope] (sign-in or restore after re-authentication). Invalidates every earlier token. */
    @Synchronized
    fun activate(scope: AccountScope): ScopeToken {
        generation.incrementAndGet()
        active = scope
        return ScopeToken(scope, generation.get())
    }

    /** Logout or revocation: lock immediately. Data stays on disk until an explicit retention decision. */
    @Synchronized
    fun lock() {
        generation.incrementAndGet()
        active = null
    }

    @Synchronized
    fun begin(): ScopeToken = ScopeToken(active ?: throw StaleScopeException("no active account"), generation.get())

    fun dir(scope: AccountScope): File = File(root, scope.dirName()).apply { mkdirs() }

    /** Runs [block] only if [token] is still the active scope; the check and the block are atomic. */
    @Synchronized
    fun <T> publish(token: ScopeToken, block: (File) -> T): T {
        if (active != token.scope || generation.get() != token.generation) {
            throw StaleScopeException("scope changed while the task was running")
        }
        return block(dir(token.scope))
    }

    /** Reads only the active account's directory; another account's data is unreachable through this API. */
    @Synchronized
    fun <T> read(token: ScopeToken, block: (File) -> T): T = publish(token, block)
}
