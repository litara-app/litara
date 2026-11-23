package com.litara.feature.reader

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import com.litara.core.model.BookAnnotation
import com.litara.core.storage.LocalRef
import com.litara.core.storage.openInputStream
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Parameters for opening a book in the reader. */
data class OpenParams(
    val ref: LocalRef,
    val format: String,
    val cfi: String?,
    val fraction: Double?,
    val settings: ReaderSettings,
)

@Serializable
private data class OpenMeta(
    val format: String,
    val cfi: String?,
    val fraction: Double?,
    val settings: ReaderSettings,
)

// Base64 is streamed in slices so a large book never rides in a single evaluateJavascript call.
// Length stays a multiple of 4 so each slice decodes independently in the WebView.
private const val CHUNK_CHARS = 256_000

// Raw bytes per read, sized so CHUNK_BYTES * 4/3 == CHUNK_CHARS exactly. A multiple of 3 so every
// chunk but the last encodes with no padding, keeping each slice independently decodable.
private const val CHUNK_BYTES = CHUNK_CHARS / 4 * 3

/**
 * Imperative handle over the reader WebView. Drives foliate via the begin/chunk/commit/command
 * protocol, buffering an open requested before the bridge signals ready.
 */
class ReaderController {
    @Volatile
    private var webView: WebView? = null

    /** Set by the screen to receive parsed reader events. */
    var listener: ((ReaderEvent) -> Unit)? = null

    /** Shared-engine mode (ADR-0093): the page is the host page and speaks the web reader's frame protocol. */
    @Volatile
    var shared: Boolean = false
        private set

    /** Raw shared-engine events (the PDF screen and tests use these; ebooks get [listener] events mapped from them). */
    var sharedListener: ((SharedEvent) -> Unit)? = null

    /** Serves the book bytes to the shared host page; set by [ReaderWebView] when it creates the shared page. */
    var responder: SharedBookResponder? = null

    private var sharedToc: List<TocItem> = emptyList()
    private var pendingFraction: Double? = null

    fun attach(webView: WebView, shared: Boolean = false) {
        this.webView = webView
        this.shared = shared
    }

    fun detach(view: WebView) {
        if (webView === view) webView = null
    }

    /** Called from the JS interface (binder thread); marshals events to the main thread. */
    fun handleMessage(view: WebView, data: String) {
        if (webView !== view) return
        if (shared) {
            val event = SharedReaderProtocol.parse(data) ?: return
            Handler(Looper.getMainLooper()).post { if (webView === view) onSharedEvent(event) }
            return
        }
        val event = ReaderBridge.parseEvent(data) ?: return
        Handler(Looper.getMainLooper()).post {
            if (webView === view) listener?.invoke(event)
        }
    }

    private fun onSharedEvent(e: SharedEvent) {
        sharedListener?.invoke(e)
        val l = listener ?: return
        when (e) {
            SharedEvent.Ready -> l(ReaderEvent.Ready)
            is SharedEvent.Toc -> sharedToc = e.items
            is SharedEvent.Loaded -> {
                l(ReaderEvent.Loaded(sharedToc, e.title))
                pendingFraction?.let { f -> pendingFraction = null; sharedSend(SharedReaderProtocol.gotoFraction(f)) }
            }
            is SharedEvent.Relocate -> l(ReaderEvent.Relocate(e.cfi, e.fraction, e.tocLabel))
            is SharedEvent.Selection -> l(ReaderEvent.Selection(e.text, e.cfi, e.rect))
            SharedEvent.SelectionCleared -> l(ReaderEvent.SelectionCleared)
            is SharedEvent.AnnotationClick -> l(ReaderEvent.AnnotationTap(e.id, e.rect)) // ids are CFIs (see SharedReaderProtocol.annotations)
            is SharedEvent.Failure -> l(ReaderEvent.Error("${e.code}: ${e.detail}"))
            is SharedEvent.Tap -> l(ReaderEvent.Tap(e.x))
            is SharedEvent.SearchResults -> l(ReaderEvent.SearchResults(e.label, e.hits))
            is SharedEvent.SearchProgress -> l(ReaderEvent.SearchProgress(e.progress))
            is SharedEvent.SearchDone -> l(ReaderEvent.SearchDone(e.total, e.capped))
            SharedEvent.RestoreFailed, is SharedEvent.Chapters, is SharedEvent.Located, SharedEvent.Other -> Unit
        }
    }

    private fun sharedSend(message: String) = eval(SharedReaderProtocol.jsHost(message))

    /** Runs JavaScript in the page and passes back its JSON result. For instrumentation tests. */
    @androidx.annotation.VisibleForTesting
    internal fun evaluateForTest(js: String, onResult: (String) -> Unit) {
        val wv = webView ?: return
        wv.post { wv.evaluateJavascript(js) { onResult(it) } }
    }

    /** Sends one frame-protocol message (JSON object) to the shared engine. */
    fun sendShared(message: String) = sharedSend(message)

    /**
     * Opens a book in the shared engine (EPUB, FB2 or PDF). Ranges are fetched by the host page from [SharedBookResponder];
     * the position restores by [cfi], or by [fraction] once the book is loaded when only a fraction is known.
     */
    fun openShared(params: OpenParams, context: Context, kind: String, pageIndex: Int? = null, x: Double? = null, y: Double? = null) {
        val r = responder ?: return
        r.ref = params.ref
        val size = r.size()
        if (size <= 0) {
            listener?.invoke(ReaderEvent.Error("Book file is empty or unreadable"))
            return
        }
        pendingFraction = if (params.cfi == null) params.fraction else null
        sharedSend(SharedReaderProtocol.open(kind, size, refName(params.ref), params.cfi, pageIndex, x, y))
        if (kind != "pdf") sharedSend(SharedReaderProtocol.style(params.settings))
    }

    /** A bundled reading font's faces (ADR-0091), as bytes over the channel. */
    fun setFont(id: String, faces: List<FontFace>) = sharedSend(SharedReaderProtocol.fonts(id, faces))

    /**
     * Streams the book into foliate. Safe to call off the main thread (it reads the file and
     * evaluates JS via WebView.post); the screen calls it only after the bridge signals ready.
     */
    fun open(params: OpenParams, context: Context) = runOpen(params, context)

    fun goTo(target: String) = if (shared) sharedSend(SharedReaderProtocol.gotoCfiOrHref(target)) else command(buildJsonObject { put("type", "goTo"); put("target", target) }.toString())
    fun goToFraction(value: Double) = if (shared) sharedSend(SharedReaderProtocol.gotoFraction(value)) else command(buildJsonObject { put("type", "goToFraction"); put("value", value) }.toString())
    fun next() = if (shared) sharedSend(SharedReaderProtocol.nav(true)) else command(buildJsonObject { put("type", "next") }.toString())
    fun prev() = if (shared) sharedSend(SharedReaderProtocol.nav(false)) else command(buildJsonObject { put("type", "prev") }.toString())

    /** Replace the set of highlights drawn in the page. Only CFI-anchored, resolvable ones are drawn. */
    fun setAnnotations(items: List<BookAnnotation>) {
        if (shared) return sharedSend(SharedReaderProtocol.annotations(items))
        val arr = kotlinx.serialization.json.buildJsonArray {
            for (a in items) {
                val cfi = a.cfi ?: continue
                if (a.positionStatus == "failed") continue
                add(buildJsonObject { put("cfi", cfi); put("color", a.color); put("style", a.style) })
            }
        }
        command(buildJsonObject { put("type", "setAnnotations"); put("items", arr) }.toString())
    }

    fun search(query: String) = if (shared) sharedSend(SharedReaderProtocol.search(query)) else command(buildJsonObject { put("type", "search"); put("query", query) }.toString())

    fun clearSearch() = if (shared) sharedSend(SharedReaderProtocol.clearSearch()) else command(buildJsonObject { put("type", "clearSearch") }.toString())

    fun clearSelection() = if (shared) sharedSend(SharedReaderProtocol.clearSelection()) else command(buildJsonObject { put("type", "clearSelection") }.toString())

    fun applyStyles(settings: ReaderSettings) {
        if (shared) return sharedSend(SharedReaderProtocol.style(settings))
        val cmd = buildJsonObject {
            put("type", "applyStyles")
            put("settings", ReaderBridge.json.encodeToJsonElement(ReaderSettings.serializer(), settings))
        }
        command(cmd.toString())
    }

    // The `window.__readerCommand &&` guard inside the JS no-ops if the bridge isn't ready yet.
    private fun command(json: String) = eval(ReaderBridge.jsCommand(json))

    // Reads and encodes the file one CHUNK_BYTES slice at a time so peak memory stays bounded by
    // the chunk size instead of the whole file (a naive readBytes()+encodeToString() on a 90MB
    // EPUB peaks at ~450MB and reliably OOMs on default heap sizes).
    private fun runOpen(params: OpenParams, context: Context) {
        val meta = OpenMeta(params.format, params.cfi, params.fraction, params.settings)
        val metaJson = ReaderBridge.json.encodeToString(OpenMeta.serializer(), meta)
        eval(ReaderBridge.jsBegin(metaJson))

        params.ref.openInputStream(context).use { input ->
            val buffer = ByteArray(CHUNK_BYTES)
            while (true) {
                var filled = 0
                while (filled < CHUNK_BYTES) {
                    val n = input.read(buffer, filled, CHUNK_BYTES - filled)
                    if (n < 0) break
                    filled += n
                }
                if (filled == 0) break
                eval(ReaderBridge.jsChunk(Base64.encodeToString(buffer, 0, filled, Base64.NO_WRAP)))
                if (filled < CHUNK_BYTES) break
            }
        }
        eval(ReaderBridge.jsCommit())
    }

    private fun eval(js: String) {
        val wv = webView ?: return
        wv.post { if (webView === wv) wv.evaluateJavascript(js, null) }
    }
}

private fun refName(ref: com.litara.core.storage.LocalRef): String = when (ref) {
    is com.litara.core.storage.LocalRef.PlainFile -> ref.file.name
    is com.litara.core.storage.LocalRef.ContentDoc -> ref.uri.lastPathSegment.orEmpty()
}.takeLast(80)

/**
 * WebView that suppresses the system Copy/Select-all toolbar. The page shows its own highlight
 * toolbar instead; the native selection handles are unaffected.
 */
private class ReaderNativeWebView(context: Context) : WebView(context) {
    override fun startActionMode(callback: android.view.ActionMode.Callback?, type: Int): android.view.ActionMode? =
        super.startActionMode(callback?.let { EmptyActionModeCallback(it) }, type)
}

private class EmptyActionModeCallback(private val delegate: android.view.ActionMode.Callback) :
    android.view.ActionMode.Callback2() {
    override fun onCreateActionMode(mode: android.view.ActionMode, menu: android.view.Menu): Boolean {
        delegate.onCreateActionMode(mode, menu)
        menu.clear()
        return true
    }

    override fun onPrepareActionMode(mode: android.view.ActionMode, menu: android.view.Menu): Boolean {
        delegate.onPrepareActionMode(mode, menu)
        menu.clear()
        return true
    }

    override fun onActionItemClicked(mode: android.view.ActionMode, item: android.view.MenuItem) = false

    override fun onDestroyActionMode(mode: android.view.ActionMode) = delegate.onDestroyActionMode(mode)

    override fun onGetContentRect(mode: android.view.ActionMode, view: android.view.View, outRect: android.graphics.Rect) {
        if (delegate is android.view.ActionMode.Callback2) delegate.onGetContentRect(mode, view, outRect)
        else super.onGetContentRect(mode, view, outRect)
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ReaderWebView(
    controller: ReaderController,
    modifier: Modifier = Modifier,
    /** ADR-0093: load the host page for the shared web engine instead of the legacy reader. */
    shared: Boolean = false,
    onRendererGone: () -> Unit,
) {
    val destroyedViews = androidx.compose.runtime.remember { mutableSetOf<WebView>() }
    AndroidView(
        modifier = modifier,
        factory = { context ->
            val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                .build()

            ReaderNativeWebView(context).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                isVerticalScrollBarEnabled = false
                isHorizontalScrollBarEnabled = false

                webViewClient = object : WebViewClientCompat() {
                    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                        Log.e("LitaraWebView", "Local reader renderer gone: crashed=${detail.didCrash()}, " +
                            "priority=${detail.rendererPriorityAtExit()}, provider=${WebView.getCurrentWebViewPackage()?.versionName}")
                        controller.detach(view)
                        destroyedViews.add(view)
                        (view.parent as? ViewGroup)?.removeView(view)
                        view.destroy()
                        onRendererGone()
                        return true
                    }

                    override fun shouldInterceptRequest(
                        view: WebView,
                        request: WebResourceRequest,
                    ): WebResourceResponse? {
                        val book = controller.responder
                        if (shared && book != null && book.matches(request.url.path)) return book.respond(request.url.path ?: "")
                        return assetLoader.shouldInterceptRequest(request.url)
                    }
                }

                if (shared) {
                    if (com.litara.BuildConfig.DEBUG) webChromeClient = object : android.webkit.WebChromeClient() {
                        override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                            Log.d("LitaraSharedReader", "${m.messageLevel()} ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                            return true
                        }
                    }
                    controller.responder = SharedBookResponder(context.applicationContext)
                }

                addJavascriptInterface(
                    object {
                        @JavascriptInterface
                        fun postMessage(message: String) = controller.handleMessage(this@apply, message)
                    },
                    "AndroidReaderBridge",
                )

                controller.attach(this, shared)
                loadUrl(
                    if (shared) "https://appassets.androidplatform.net/assets/reader-shared-host/index.html"
                    else "https://appassets.androidplatform.net/assets/reader/index.html",
                )
            }
        },
        onRelease = { view ->
            controller.detach(view)
            if (!destroyedViews.remove(view)) {
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
            }
        },
    )
}

/** Build OpenParams once the file and initial position are resolved. */
fun openParamsFor(
    ref: LocalRef,
    format: String,
    initial: InitialProgress,
    settings: ReaderSettings,
): OpenParams = OpenParams(ref, format, initial.cfi, initial.fraction, settings)
