package com.litara.feature.reader

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.litara.core.model.BookAnnotation
import com.litara.core.storage.LocalRef
import java.io.File
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The shared web engine inside the Android reader WebView (ADR-0093), on a device WebView: open, page turn, position restore,
 * a highlight saved by the LEGACY Android engine, text selection, a bundled font, and a PDF. Fixtures are the synthetic books in
 * scripts/android/reader-locators/fixtures. Not covered here: real books, KEPUB/MOBI, Cast/Auto, touch gestures, the full chrome.
 */
@RunWith(AndroidJUnit4::class)
class SharedReaderEngineTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val controller = ReaderController()
    private lateinit var scenario: ActivityScenario<ComponentActivity>

    private fun asset(name: String): File = File(context.cacheDir, name).also { out ->
        instrumentation.context.assets.open(name).use { i -> out.outputStream().use { i.copyTo(it) } }
    }

    @Before fun start() {
        controller.sharedListener = { log.add(it) }
        scenario = ActivityScenario.launch(ComponentActivity::class.java)
        scenario.onActivity { a ->
            a.setContent { ReaderWebView(controller = controller, shared = true, modifier = Modifier.fillMaxSize(), onRendererGone = {}) }
        }
    }

    @After fun stop() = scenario.close()

    // Events are kept in arrival order; an await takes the first unconsumed match, so earlier events (the frame reports the first
    // position before it says "loaded") are not lost to a later wait.
    private val log = java.util.concurrent.CopyOnWriteArrayList<SharedEvent>()
    private val consumed = HashSet<Int>()

    /** Ignore everything received so far (a new open or jump starts a fresh sequence). */
    private fun fresh() { consumed.addAll(0 until log.size) }

    private inline fun <reified T : SharedEvent> await(seconds: Long = 40, match: (T) -> Boolean = { true }): T {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        var seen = 0
        while (System.nanoTime() < deadline) {
            val snapshot = log.toList()
            for (i in snapshot.indices) {
                val e = snapshot[i]
                if (i in consumed) continue
                if (e is T && match(e)) { consumed.add(i); return e }
                if (e is SharedEvent.Failure) throw AssertionError("engine error ${e.code}: ${e.detail}")
            }
            seen = snapshot.size
            Thread.sleep(50)
        }
        throw AssertionError("timed out waiting for ${T::class.simpleName}; saw ${log.size} events, last: ${log.takeLast(8).map { it.toString().take(110) }}")
    }

    private fun js(script: String): String {
        val out = LinkedBlockingQueue<String>()
        controller.evaluateForTest(script) { out.add(it) }
        return out.poll(20, TimeUnit.SECONDS) ?: throw AssertionError("script timed out")
    }

    private fun open(file: File, kind: String, cfi: String? = null, pageIndex: Int? = null) {
        controller.openShared(OpenParams(LocalRef.PlainFile(file), kind, cfi, null, ReaderSettings(isDark = false)), context, kind, pageIndex)
    }

    // The book's live section documents and overlays, through the engine's own API (Foliate's shadow roots are closed).
    private val contents = "document.getElementById('frame').contentDocument.querySelector('foliate-view').renderer.getContents()"

    @Test fun epubOpensPagesRestoresAndHandlesHighlightsSelectionAndFonts() {
        assumeTrue("shared reader assets missing", context.assets.list("reader-shared")?.isNotEmpty() == true)
        val epub = asset("stress.epub")
        await<SharedEvent.Ready>()
        open(epub, "epub")
        val loaded = await<SharedEvent.Loaded>()
        assertEquals("foliate", loaded.engine)
        val first = await<SharedEvent.Relocate> { it.cfi != null && it.fraction != null }
        assertTrue(first.cfi!!.startsWith("epubcfi("))

        // Page turn moves forward.
        controller.next()
        val second = await<SharedEvent.Relocate> { it.cfi != null && it.fraction != null && it.cfi != first.cfi }
        assertTrue("fraction advances", second.fraction!! > first.fraction!!)

        // A position saved by the LEGACY Android engine (see scripts/android/reader-locators/saved-locators.json) opens at its chapter.
        val legacyPosition = "epubcfi(/6/8!/4,/8[c4p3]/11:235,/14/2/3:135)"
        Thread.sleep(800) // the paginator ignores a jump while a page-turn animation is still settling
        fresh()
        controller.goTo(legacyPosition)
        val chapter4 = await<SharedEvent.Relocate> { it.cfi != null && it.cfi!!.contains("/6/8!") }
        assertNotNull(chapter4.tocLabel ?: "no label is fine")

        // Position saving + restore: reopen on the cfi the engine itself reported.
        val saved = chapter4.cfi!!
        fresh()
        open(epub, "epub", cfi = saved)
        await<SharedEvent.Loaded>()
        val restored = await<SharedEvent.Relocate> { it.cfi != null && it.fraction != null }
        assertEquals(chapter4.fraction!!, restored.fraction!!, 0.01)

        // Bookmark path: Kotlin keeps the CFI and calls goTo with it.
        Thread.sleep(800)
        fresh()
        controller.goTo(first.cfi!!)
        val back = await<SharedEvent.Relocate> { it.cfi != null && Math.abs(it.fraction!! - first.fraction!!) < 0.01 }
        assertTrue(back.fraction!! < chapter4.fraction!!)

        // A highlight recorded by the legacy engine resolves in the shared engine and is painted.
        val legacyHighlight = "epubcfi(/6/4!/4/8[c2p3],/11:167,/11:198)"
        Thread.sleep(800)
        fresh()
        controller.goTo(legacyHighlight)
        await<SharedEvent.Relocate> { it.cfi != null && it.cfi!!.contains("/6/4!") }
        val before = js("""($contents).reduce(function(n,c){return n+(c.overlayer?c.overlayer.element.querySelectorAll('rect,path').length:0)},0)""").toInt()
        controller.setAnnotations(listOf(BookAnnotation(id = 1, bookId = 1, cfi = legacyHighlight, color = "yellow", style = "highlight")))
        Thread.sleep(1500)
        val after = js("""($contents).reduce(function(n,c){return n+(c.overlayer?c.overlayer.element.querySelectorAll('rect,path').length:0)},0)""").toInt()
        assertTrue("highlight drawn: svg shapes $before -> $after", after > before)
        // ...and is placed in the book for the timeline.
        controller.sendShared("""{"t":"locate","items":[{"id":"h","cfi":"$legacyHighlight","kind":"highlight"}]}""")
        val located = await<SharedEvent.Located>()
        assertTrue("legacy highlight is located: ${located.positions}", located.positions["h"] != null)

        // A text selection in the page reaches Kotlin with a CFI and a rectangle.
        val picked = js("""(function(){var c=($contents)[0];var p=c.doc.querySelector('p');c.doc.getSelection().selectAllChildren(p);return p?'ok':'none'})()""")
        assertEquals("\"ok\"", picked)
        val sel = await<SharedEvent.Selection>()
        assertTrue(sel.text.isNotBlank())
        assertTrue(sel.cfi!!.startsWith("epubcfi("))
        assertNotNull(sel.rect)
        controller.clearSelection()
        await<SharedEvent.SelectionCleared>()

        // Fonts arrive as bytes over the channel (ADR-0091) and the family becomes available to the book.
        val woff2 = runCatching { instrumentation.context.assets.open("literata-latin-400-normal.woff2").use { it.readBytes() } }.getOrNull()
        assumeTrue("font fixture not copied (run npm ci in apps/web)", woff2 != null)
        controller.setFont("literata", listOf(FontFace(400, "normal", woff2!!)))
        controller.sendShared("""{"t":"style","fontPct":100,"theme":"light","flow":"paginated","font":"literata"}""")
        Thread.sleep(1500)
        val fontOk = js("""(function(){var ok=false;($contents).forEach(function(c){c.doc.fonts.forEach(function(f){if(f.family.indexOf('Litara Literata')>=0)ok=true})});return ok})()""")
        assertEquals("a Litara Literata face is declared in the book", "true", fontOk)
    }

    @Test fun epubSearchTapAndTextSettings() {
        assumeTrue("shared reader assets missing", context.assets.list("reader-shared")?.isNotEmpty() == true)
        await<SharedEvent.Ready>()
        open(asset("stress.epub"), "epub")
        await<SharedEvent.Loaded>()
        await<SharedEvent.Relocate> { it.cfi != null && it.fraction != null }
        Thread.sleep(800)

        // Search: hits with excerpts, then done; the controller maps them to the legacy search events.
        val mapped = LinkedBlockingQueue<ReaderEvent>()
        controller.listener = { mapped.add(it) }
        controller.search("harbour")
        val done = await<SharedEvent.SearchDone> { true }
        assertTrue(done.total > 5)
        val hits = log.filterIsInstance<SharedEvent.SearchResults>().flatMap { it.hits }
        assertEquals(done.total, hits.size)
        assertTrue(hits.all { it.cfi.startsWith("epubcfi(") && it.match.contains("harbour", ignoreCase = true) })
        assertTrue(generateSequence { mapped.poll(2, TimeUnit.SECONDS) }.any { it is ReaderEvent.SearchDone })
        // A search hit opens at its place.
        fresh()
        controller.clearSearch()
        controller.goTo(hits.last().cfi)
        await<SharedEvent.Relocate> { it.cfi != null }

        // A real touch on the page text arrives as a tap with its screen position.
        Thread.sleep(800)
        fresh()
        val dm = context.resources.displayMetrics
        val x = dm.widthPixels * 0.5f
        val y = dm.heightPixels * 0.5f
        val t0 = android.os.SystemClock.uptimeMillis()
        for ((action, at) in listOf(android.view.MotionEvent.ACTION_DOWN to t0, android.view.MotionEvent.ACTION_UP to t0 + 60)) {
            val ev = android.view.MotionEvent.obtain(t0, at, action, x, y, 0)
            ev.source = android.view.InputDevice.SOURCE_TOUCHSCREEN
            instrumentation.sendPointerSync(ev)
            ev.recycle()
        }
        val tap = await<SharedEvent.Tap>()
        assertEquals(0.5, tap.x, 0.1)

        // Text settings reach the book: line height, justification and hyphenation.
        controller.applyStyles(ReaderSettings(isDark = false, lineHeight = 2.0, justify = true, hyphenate = true, maxColumnCount = 1))
        Thread.sleep(1500)
        val typo = js("""(function(){var c=($contents)[0];var p=c.doc.querySelector('p');var cs=c.doc.defaultView.getComputedStyle(p);return JSON.stringify({lh:parseFloat(cs.lineHeight)/parseFloat(cs.fontSize),al:cs.textAlign,hy:cs.hyphens})})()""")
        val t = typo.replace("\\", "")
        assertTrue("typography applied: $typo", t.contains("\"al\":\"justify\"") && t.contains("\"hy\":\"auto\"") && t.contains("\"lh\":2"))

        // Per-highlight colour and style.
        val cfi = "epubcfi(/6/4!/4/8[c2p3],/11:167,/11:198)"
        Thread.sleep(800)
        fresh()
        controller.goTo(cfi)
        await<SharedEvent.Relocate> { it.cfi != null && it.cfi!!.contains("/6/4!") }
        controller.setAnnotations(listOf(BookAnnotation(id = 1, bookId = 1, cfi = cfi, color = "green", style = "underline")))
        Thread.sleep(1500)
        val overlay = js("""JSON.stringify(($contents).map(function(c){return c.overlayer?c.overlayer.element.innerHTML:''}).join('|'))""")
        assertTrue("green drawn: ${overlay.take(200)}", overlay.contains("4ade80", ignoreCase = true))
    }

    @Test fun pdfOpensOnTheSavedPageAndTurns() {
        assumeTrue("shared reader assets missing", context.assets.list("reader-shared")?.isNotEmpty() == true)
        val pdf = asset("edge.pdf")
        await<SharedEvent.Ready>()
        open(pdf, "pdf", pageIndex = 3)
        val loaded = await<SharedEvent.Loaded>()
        assertEquals("pdfjs", loaded.engine)
        assertEquals(7, loaded.pages)
        val at = await<SharedEvent.Relocate> { it.pageIndex != null }
        assertEquals(3, at.pageIndex)
        assertEquals(7, at.numPages)
        controller.next()
        assertEquals(4, await<SharedEvent.Relocate> { it.pageIndex == 4 }.pageIndex)
        controller.sendShared(SharedReaderProtocol.gotoPage(0))
        assertEquals(0, await<SharedEvent.Relocate> { it.pageIndex == 0 }.pageIndex)
    }
}
