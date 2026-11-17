package com.litara.core.litara

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * Exact-version comic page images on this device. Pages come from the server's validated manifest
 * (GET .../pages/{index}); each is stored under `<dir>/<contentVersion>/<manifestVersion>/<index>` so pages of
 * different bytes or a re-extracted manifest can never be mixed. A page is published only after the whole body
 * arrived (rename), so a killed process never leaves a truncated image that would later be shown.
 */
class ComicPageStore(private val client: LitaraClient, root: File, private val manifest: LPageManifest) {
    private val dir = File(root, "${manifest.contentVersion}/${manifest.manifestVersion}")
    private val locks = ConcurrentHashMap<Int, Mutex>()

    fun fileFor(index: Int) = File(dir, index.toString())

    /** The stored image for [index] if it was fully downloaded, otherwise null. */
    fun cached(index: Int): File? = fileFor(index).takeIf { it.isFile && it.length() > 0 }

    /** Returns the image file for [index], downloading it once. Throws on a changed version or a server problem. */
    suspend fun page(index: Int): File {
        val page = manifest.pages.getOrNull(index) ?: throw IllegalArgumentException("no page $index")
        cached(index)?.let { return it }
        return locks.getOrPut(index) { Mutex() }.withLock {
            cached(index)?.let { return it }
            dir.mkdirs()
            val dest = fileFor(index)
            val part = File(dest.path + ".part")
            val resp = client.execute(Request.Builder().url(client.serverUrl(page.contentPath)).get())
            resp.use { r ->
                when {
                    r.code == 412 -> throw ContentChangedException(manifest.fileId)
                    !r.isSuccessful -> throw LitaraHttpException(r.code, client.problemOf(withContext(Dispatchers.IO) { r.body?.string().orEmpty() }, r.code))
                }
                withContext(Dispatchers.IO) {
                    val body = r.body ?: throw IOException("empty page body")
                    try {
                        part.outputStream().use { out -> body.byteStream().use { it.copyTo(out) } }
                    } catch (e: IOException) {
                        part.delete()
                        throw TransientException(e, "page download interrupted")
                    }
                    if (part.length() == 0L || (r.header("Content-Length")?.toLongOrNull()?.let { it != part.length() } == true)) {
                        part.delete()
                        throw IntegrityException("page $index size mismatch")
                    }
                    if (!part.renameTo(dest)) { part.copyTo(dest, overwrite = true); part.delete() }
                }
            }
            dest
        }
    }
}
