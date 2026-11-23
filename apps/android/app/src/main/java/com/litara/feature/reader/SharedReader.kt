package com.litara.feature.reader

import android.content.Context
import android.webkit.WebResourceResponse
import com.litara.core.storage.LocalRef
import com.litara.core.storage.openParcelFileDescriptor
import java.io.InputStream
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * The shared reader engine on Android (ADR-0093 option 3b): the web reader's frame (`assets/reader-shared`, a build output
 * copied from `apps/web/public/reader`) speaks its own message protocol (ADR-0067); `assets/reader-shared-host/index.html`
 * relays it to Kotlin. This file is the Kotlin side of that protocol: parsing what the frame sends and building what it
 * accepts. Android-owned (AGPL); nothing here is copied into the web source.
 */
sealed interface SharedEvent {
    data object Ready : SharedEvent
    data class Toc(val items: List<TocItem>) : SharedEvent
    data class Loaded(val engine: String, val title: String?, val pages: Int?) : SharedEvent

    /** An ebook position ([cfi]) or a PDF position ([pageIndex] of [numPages], 0-based, with x/y in crop-box fractions). */
    data class Relocate(
        val cfi: String?,
        val fraction: Double?,
        val tocLabel: String?,
        val pageIndex: Int?,
        val numPages: Int?,
    ) : SharedEvent

    data class Chapters(val items: List<Chapter>) : SharedEvent
    data class Selection(val text: String, val cfi: String?, val rect: ViewportRect?) : SharedEvent
    data object SelectionCleared : SharedEvent
    data class AnnotationClick(val id: String) : SharedEvent
    data object RestoreFailed : SharedEvent
    data class Failure(val code: String, val detail: String) : SharedEvent
    data class Located(val positions: Map<String, Double>) : SharedEvent
    data object Other : SharedEvent

    data class Chapter(val label: String, val fraction: Double)
}

/** One face of a bundled reading font (ADR-0091); [bytes] are WOFF2. */
class FontFace(val weight: Int, val style: String, val bytes: ByteArray)

object SharedReaderProtocol {
    val json = Json { ignoreUnknownKeys = true }

    /** Formats the first increment reads through the shared engine; the others stay on the legacy reader (see the research note). */
    val EBOOK_FORMATS = setOf("epub", "fb2")

    fun ebookUsesSharedEngine(format: String): Boolean = format.lowercase() in EBOOK_FORMATS

    // ---- frame -> Kotlin ----

    private fun rect(el: JsonElement?): ViewportRect? = runCatching {
        val o = el?.jsonObject ?: return null
        val x = o["x"]!!.jsonPrimitive.doubleOrNull!!
        val y = o["y"]!!.jsonPrimitive.doubleOrNull!!
        ViewportRect(x, y, x + o["width"]!!.jsonPrimitive.doubleOrNull!!, y + o["height"]!!.jsonPrimitive.doubleOrNull!!)
    }.getOrNull()

    private fun toc(el: JsonElement?): List<TocItem> = (el as? JsonArray)?.mapNotNull { item ->
        val o = item as? JsonObject ?: return@mapNotNull null
        TocItem(
            label = o["label"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            href = o["href"]?.jsonPrimitive?.contentOrNull,
            subitems = toc(o["items"]),
        )
    }.orEmpty()

    fun parse(data: String): SharedEvent? = runCatching {
        val o = json.parseToJsonElement(data).jsonObject
        fun str(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun dbl(k: String) = (o[k] as? JsonPrimitive)?.doubleOrNull
        fun int(k: String) = (o[k] as? JsonPrimitive)?.intOrNull
        when (str("t")) {
            "ready" -> SharedEvent.Ready
            "toc" -> SharedEvent.Toc(toc(o["items"]))
            "loaded" -> SharedEvent.Loaded(str("engine").orEmpty(), str("title"), int("pages"))
            "relocate" -> SharedEvent.Relocate(str("cfi"), dbl("fraction"), str("tocLabel"), int("pageIndex"), int("numPages"))
            "chapters" -> SharedEvent.Chapters(
                (o["items"] as? JsonArray)?.mapNotNull {
                    val c = it as? JsonObject ?: return@mapNotNull null
                    val f = (c["fraction"] as? JsonPrimitive)?.doubleOrNull ?: return@mapNotNull null
                    SharedEvent.Chapter(c["label"]?.jsonPrimitive?.contentOrNull.orEmpty(), f)
                }.orEmpty(),
            )
            "selection" ->
                if ((o["cleared"] as? JsonPrimitive)?.booleanOrNull == true) SharedEvent.SelectionCleared
                else SharedEvent.Selection(str("text").orEmpty(), str("cfi"), rect(o["rect"]))
            "annotation-click" -> str("id")?.let { SharedEvent.AnnotationClick(it) } ?: SharedEvent.Other
            "restore-failed" -> SharedEvent.RestoreFailed
            "error" -> SharedEvent.Failure(str("code").orEmpty(), str("detail").orEmpty())
            "located" -> SharedEvent.Located(
                (o["positions"] as? JsonObject)?.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.doubleOrNull?.let { k to it } }?.toMap().orEmpty(),
            )
            else -> SharedEvent.Other
        }
    }.getOrNull()

    // ---- Kotlin -> frame (each is one JSON object for `window.__host`) ----

    fun open(kind: String, size: Long, name: String, cfi: String? = null, pageIndex: Int? = null, x: Double? = null, y: Double? = null): String =
        buildJsonObject {
            put("t", "open")
            put("kind", kind)
            put("size", size)
            put("name", name)
            put("restore", buildJsonObject {
                if (cfi != null) put("cfi", cfi)
                if (pageIndex != null) put("pageIndex", pageIndex)
                if (x != null) put("x", x)
                if (y != null) put("y", y)
            })
        }.toString()

    fun gotoCfiOrHref(target: String): String = buildJsonObject {
        put("t", "goto")
        if (target.startsWith("epubcfi(")) put("cfi", target) else put("href", target)
    }.toString()

    fun gotoFraction(fraction: Double): String = buildJsonObject { put("t", "goto"); put("fraction", fraction) }.toString()
    fun gotoPage(pageIndex: Int): String = buildJsonObject { put("t", "goto"); put("pageIndex", pageIndex) }.toString()
    fun nav(next: Boolean): String = buildJsonObject { put("t", "nav"); put("dir", if (next) "next" else "prev") }.toString()
    fun clearSelection(): String = buildJsonObject { put("t", "clear-selection") }.toString()
    fun close(): String = buildJsonObject { put("t", "close") }.toString()

    /** The frame's `style` message: fontPct (60..250), theme (light|sepia|dark), flow, font key. */
    fun style(settings: ReaderSettings): String = buildJsonObject {
        put("t", "style")
        put("fontPct", (settings.fontSize / 16.0 * 100).toInt().coerceIn(60, 250))
        put("theme", themeFor(settings))
        put("flow", if (settings.flow == "scrolled") "scrolled" else "paginated")
        fontKeyFor(settings.fontFamily)?.let { put("font", it) }
    }.toString()

    fun pdfStyle(fontPct: Int, theme: String): String = buildJsonObject {
        put("t", "style"); put("fontPct", fontPct); put("theme", theme)
    }.toString()

    internal fun themeFor(s: ReaderSettings): String = when {
        s.isDark -> "dark"
        s.themeName.equals("sepia", ignoreCase = true) -> "sepia"
        else -> "light"
    }

    /** The frame offers publisher (no key), serif, sans, mono and the bundled families; map the old CSS stacks onto them. */
    internal fun fontKeyFor(family: String?): String? = when {
        family == null -> null
        family.contains("Georgia") -> "serif"
        family.contains("Helvetica") || family.contains("Arial") -> "sans"
        family.contains("Menlo") || family.contains("Consolas") || family.contains("mono", ignoreCase = true) -> "mono"
        else -> null
    }

    /** Highlights to paint. The shared frame paints a fixed colour per kind, so the legacy colour and style are not carried. */
    fun annotations(items: List<com.litara.core.model.BookAnnotation>): String = buildJsonObject {
        put("t", "annotations")
        put("items", buildJsonArray {
            for (a in items) {
                val cfi = a.cfi ?: continue
                if (a.positionStatus == "failed") continue
                add(buildJsonObject { put("id", cfi); put("cfi", cfi); put("kind", if (a.note.isNullOrBlank()) "highlight" else "note") })
            }
        })
    }.toString()

    fun fonts(id: String, faces: List<FontFace>): String = buildJsonObject {
        put("t", "fonts")
        put("id", id)
        put("faces", buildJsonArray {
            for (f in faces) add(buildJsonObject {
                put("weight", f.weight); put("style", f.style)
                put("b64", android.util.Base64.encodeToString(f.bytes, android.util.Base64.NO_WRAP))
            })
        })
    }.toString()

    fun asJsLiteral(jsonString: String): String = Json.encodeToString(String.serializer(), jsonString)

    fun jsHost(message: String): String = "window.__host && window.__host(${asJsLiteral(message)});true;"
}

/**
 * Serves the open book to the host page from the app's own asset origin. The host asks for `/litara-book/<start>-<end>`
 * (end exclusive, the same numbers the frame's `range` message carries) and gets those bytes with status 200. HTTP `Range`
 * requests are not used: the WebView's interception rejected 206 responses for non-zero offsets.
 */
class SharedBookResponder(private val context: Context) {
    @Volatile
    var ref: LocalRef? = null

    fun matches(path: String?): Boolean = path != null && parseSlice(path) != null

    private fun sizeOf(r: LocalRef): Long = when (r) {
        is LocalRef.PlainFile -> r.file.length()
        is LocalRef.ContentDoc -> context.contentResolver.openAssetFileDescriptor(r.uri, "r")?.use { it.length } ?: -1L
    }

    fun size(): Long = ref?.let { sizeOf(it) } ?: -1L

    fun respond(path: String): WebResourceResponse? {
        val r = ref ?: return error(404, "Not Found")
        val slice = parseSlice(path) ?: return error(400, "Bad Request")
        val total = sizeOf(r)
        if (total < 0) return error(404, "Not Found")
        val start = slice.first
        val end = minOf(slice.second, total)
        if (start >= end) return error(416, "Range Not Satisfiable")
        if (end - start > MAX_BODY) return error(413, "Payload Too Large")
        // The frame asks for at most 8 MiB per reply, so the slice is read eagerly.
        return WebResourceResponse("application/octet-stream", null, 200, "OK", mapOf("Cache-Control" to "no-store"), java.io.ByteArrayInputStream(readSlice(r, start, (end - start).toInt())))
    }

    private fun readSlice(r: LocalRef, start: Long, length: Int): ByteArray =
        r.openParcelFileDescriptor(context).use { pfd ->
            java.io.FileInputStream(pfd.fileDescriptor).use { fis ->
                val ch = fis.channel
                ch.position(start)
                val buf = java.nio.ByteBuffer.allocate(length)
                while (buf.hasRemaining()) if (ch.read(buf) < 0) break
                buf.array().copyOf(buf.position())
            }
        }

    private fun error(code: Int, reason: String) = WebResourceResponse("text/plain", "utf-8", code, reason, emptyMap(), InputStream.nullInputStream())

    companion object {
        private const val MAX_BODY = 32L * 1024 * 1024

        /** `/litara-book/<start>-<end>` to (start, end), end exclusive; null for anything else. */
        fun parseSlice(path: String): Pair<Long, Long>? {
            val m = Regex("""^/litara-book/(\d{1,15})-(\d{1,15})$""").matchEntire(path) ?: return null
            val a = m.groupValues[1].toLong()
            val b = m.groupValues[2].toLong()
            return if (b > a) a to b else null
        }
    }
}
