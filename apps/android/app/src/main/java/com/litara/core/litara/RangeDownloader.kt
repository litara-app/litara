package com.litara.core.litara

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile

/** The content version is no longer served (412/404). The old complete download stays untouched and playable. */
class ContentChangedException(val fileId: String) : Exception("content changed for $fileId")

/** The finished file does not match the snapshot's size; the partial was discarded. */
class IntegrityException(message: String) : Exception(message)

/**
 * Resumable, byte-exact download of one original file version.
 *
 * Resume uses `Range: bytes=<n>-` with `If-Range: <etag>`. A `200` answer to a range request means the
 * server ignored the range or the validator no longer matches: the partial is restarted from zero and
 * a full body is NEVER appended to partial content. A changed version (412/404) leaves the previous
 * complete download alone so the user must explicitly re-download.
 */
class RangeDownloader(private val client: LitaraClient) {

    /** Downloads [file] to [dest]; [partial] and its `.etag` sidecar survive interruptions. Returns bytes written to dest. */
    suspend fun download(file: LFile, dest: File, partial: File = File(dest.path + ".part")): Long {
        val expected = file.sizeBytes ?: throw IntegrityException("snapshot has no size for ${file.id}")
        val etagFile = File(partial.path + ".etag")
        dest.parentFile?.mkdirs()
        if (dest.exists() && dest.length() == expected) return expected // already complete

        while (true) {
            val have = if (partial.exists()) partial.length() else 0L
            val etag = etagFile.takeIf { it.exists() }?.readText()
            if (have > expected) { reset(partial, etagFile); continue }

            val req = Request.Builder().url(client.serverUrl(file.contentPath)).get()
            if (have > 0 && etag != null) req.header("Range", "bytes=$have-").header("If-Range", etag)
            else if (have > 0) { reset(partial, etagFile); continue } // no validator: cannot resume safely

            val resp = client.execute(req)
            resp.use { r ->
                when (r.code) {
                    206 -> {
                        val start = Regex("""bytes (\d+)-""").find(r.header("Content-Range").orEmpty())?.groupValues?.get(1)?.toLongOrNull()
                        if (start != have || (etag != null && r.header("ETag") != etag)) { reset(partial, etagFile); return@use }
                        append(partial, r, truncate = false)
                    }
                    200 -> { // full body: restart, never append
                        reset(partial, etagFile)
                        r.header("ETag")?.let { etagFile.writeText(it) }
                        append(partial, r, truncate = true)
                    }
                    416 -> {
                        if (have == expected) { /* partial is already complete */ } else { reset(partial, etagFile); return@use }
                    }
                    412, 404 -> { reset(partial, etagFile); throw ContentChangedException(file.id) }
                    else -> throw LitaraHttpException(r.code, client.problemOf(r.body?.string().orEmpty(), r.code))
                }
            }
            if (partial.exists() && partial.length() == expected) break
            if (partial.exists() && partial.length() > expected) { reset(partial, etagFile); throw IntegrityException("downloaded more than ${file.sizeBytes} bytes") }
        }
        if (partial.length() != expected) { reset(partial, etagFile); throw IntegrityException("size mismatch") }
        if (!partial.renameTo(dest)) { partial.copyTo(dest, overwrite = true); partial.delete() }
        etagFile.delete()
        return expected
    }

    private fun reset(partial: File, etag: File) { partial.delete(); etag.delete() }

    private suspend fun append(partial: File, r: okhttp3.Response, truncate: Boolean) = withContext(Dispatchers.IO) {
        val body = r.body ?: throw IOException("empty body")
        try {
            RandomAccessFile(partial, "rw").use { raf ->
                if (truncate) raf.setLength(0)
                raf.seek(raf.length())
                val buf = ByteArray(64 * 1024)
                body.byteStream().use { input ->
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        raf.write(buf, 0, n)
                    }
                }
            }
        } catch (e: IOException) {
            throw TransientException(e, "download interrupted; partial kept for resume") // partial bytes remain on disk
        }
    }
}
