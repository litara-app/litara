package com.litara.feature.player

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.litara.core.auth.AccountDataScope
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/** Authenticated image fetching stays on the phone; media clients receive scoped local URIs. */
@Singleton
class AutoArtwork @Inject constructor(
    @ApplicationContext private val context: Context,
    private val dataScope: AccountDataScope,
    private val litara: LitaraSource,
) {
    private val locks = ConcurrentHashMap<String, Any>()
    private fun scope(): String = MessageDigest.getInstance("SHA-256")
        .digest(litara.scopeKey().toByteArray())
        .joinToString("") { "%02x".format(it) }.take(24)

    private fun root(): Uri = Uri.Builder().scheme("content").authority("${context.packageName}.artwork")
        .appendPath(scope()).build()

    fun uri(bookId: Int): Uri = root().buildUpon().appendPath(bookId.toString()).build()

    /** The provider is not exported. Only connected media clients get read access to this scope. */
    fun grantTo(packageName: String) {
        if (packageName == context.packageName) return
        runCatching {
            context.grantUriPermission(packageName, root(),
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
        }
    }

    fun open(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r" || dataScope.changed() || uri.authority != "${context.packageName}.artwork" ||
            uri.pathSegments.size != 2 || uri.pathSegments[0] != scope()) {
            throw FileNotFoundException("Invalid artwork request")
        }
        val id = uri.pathSegments[1].toIntOrNull()?.takeIf { it > 0 }
            ?: throw FileNotFoundException("Invalid book")
        return runBlocking(Dispatchers.IO) {
            withTimeout(6_000) {
                val key = "${scope()}-$id"
                synchronized(locks.getOrPut(key) { Any() }) {
                    val folder = File(context.cacheDir, "auto-artwork").apply { mkdirs() }
                    val cached = File(folder, "$key.jpg")
                    if (!cached.exists()) {
                        if (!litara.owns(id)) throw FileNotFoundException("Sign in to load artwork")
                        val temporary = File.createTempFile("cover-", ".tmp", folder)
                        try {
                            if (!kotlinx.coroutines.runBlocking { litara.artwork(id, temporary) }) throw FileNotFoundException("Artwork unavailable")
                            if (!temporary.renameTo(cached)) throw FileNotFoundException("Unable to cache artwork")
                        } finally { temporary.delete() }
                        folder.listFiles()?.filter { it.extension == "jpg" && it != cached }
                            ?.sortedByDescending { it.lastModified() }?.drop(127)?.forEach { it.delete() }
                    }
                    if (uri.pathSegments[0] != scope()) throw FileNotFoundException("Account changed")
                    ParcelFileDescriptor.open(cached, ParcelFileDescriptor.MODE_READ_ONLY)
                }
            }
        }
    }
}
