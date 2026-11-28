package com.litara.feature.reader

import android.view.InputDevice
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.litara.core.litara.LRectangle
import com.litara.core.storage.LocalRef
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * ADR-0113: PDF highlight positions from the device WebView must be the ones desktop browsers compute. On every page of the
 * edge-case PDF (rotated, cropped and differently sized pages) this selects the first line of text and draws an area box
 * with real touch events, and compares with scripts/android/reader-locators/fixtures/pdf-rects.json (recorded by
 * scripts/web/reader-protocol/pdf-rects.mjs). It also selects a word by a real long press.
 */
@RunWith(AndroidJUnit4::class)
class PdfHighlightPositionsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val controller = ReaderController()
    private lateinit var scenario: ActivityScenario<ComponentActivity>
    private val books = File(context.filesDir, "pdf-positions-test")
    private val log = CopyOnWriteArrayList<SharedEvent>()
    private var read = 0

    @Before fun start() {
        controller.sharedListener = { log.add(it) }
        scenario = ActivityScenario.launch(ComponentActivity::class.java)
        scenario.onActivity { a ->
            a.setContent { ReaderWebView(controller = controller, shared = true, modifier = Modifier.fillMaxSize(), onRendererGone = {}) }
        }
    }

    @After fun stop() {
        scenario.close()
        books.deleteRecursively()
    }

    private inline fun <reified T : SharedEvent> await(match: (T) -> Boolean = { true }): T {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(40)
        while (System.nanoTime() < deadline) {
            while (read < log.size) {
                val e = log[read++]
                if (e is SharedEvent.Failure) throw AssertionError("engine error ${e.code}: ${e.detail}")
                if (e is T && match(e)) return e
            }
            Thread.sleep(50)
        }
        throw AssertionError("timed out waiting for ${T::class.simpleName}; last: ${log.takeLast(6).map { it.toString().take(160) }}")
    }

    private fun fresh() { read = log.size }

    private fun js(script: String): String {
        val out = LinkedBlockingQueue<String>()
        controller.evaluateForTest(script) { out.add(it) }
        return out.poll(20, TimeUnit.SECONDS) ?: throw AssertionError("script timed out")
    }

    private val doc = "document.getElementById('frame').contentDocument"
    private val firstSpan = "[...$doc.querySelectorAll('.textLayer span')].find(s=>s.textContent.trim().length>1)"

    private fun openFixture() {
        val pdf = File(books.apply { mkdirs() }, "edge.pdf").also { out ->
            instrumentation.context.assets.open("edge.pdf").use { i -> out.outputStream().use { i.copyTo(it) } }
        }
        await<SharedEvent.Ready>()
        controller.openShared(OpenParams(LocalRef.PlainFile(pdf), "pdf", null, null, ReaderSettings(isDark = false)), context, "pdf", pageIndex = 0)
        await<SharedEvent.Loaded>()
    }

    /** A point of the frame (CSS pixels) in screen pixels. */
    private fun screen(x: Float, y: Float): Pair<Float, Float> {
        val origin = IntArray(2)
        scenario.onActivity { a -> findWebView(a.window.decorView)!!.getLocationOnScreen(origin) }
        val d = context.resources.displayMetrics.density
        return origin[0] + x * d to origin[1] + y * d
    }

    private fun findWebView(v: android.view.View): android.webkit.WebView? {
        if (v is android.webkit.WebView) return v
        if (v is android.view.ViewGroup) for (i in 0 until v.childCount) findWebView(v.getChildAt(i))?.let { return it }
        return null
    }

    private fun touch(down: Long, action: Int, at: Pair<Float, Float>) {
        val ev = MotionEvent.obtain(down, android.os.SystemClock.uptimeMillis(), action, at.first, at.second, 0)
        ev.source = InputDevice.SOURCE_TOUCHSCREEN
        instrumentation.sendPointerSync(ev)
        ev.recycle()
    }

    private fun drag(from: Pair<Float, Float>, to: Pair<Float, Float>) {
        val t = android.os.SystemClock.uptimeMillis()
        touch(t, MotionEvent.ACTION_DOWN, from)
        for (i in 1..10) {
            Thread.sleep(16)
            touch(t, MotionEvent.ACTION_MOVE, from.first + (to.first - from.first) * i / 10 to from.second + (to.second - from.second) * i / 10)
        }
        touch(t, MotionEvent.ACTION_UP, to)
    }

    private fun box(expression: String): List<Float> =
        js("(function(){var b=$expression.getBoundingClientRect();return [b.left,b.top,b.width,b.height].join(',')})()")
            .trim('"').split(",").map { it.toFloat() }

    private fun rects(e: kotlinx.serialization.json.JsonElement): List<LRectangle> = (e as JsonArray).map {
        val r = it.jsonObject
        fun n(k: String) = r.getValue(k).jsonPrimitive.double
        LRectangle(n("x"), n("y"), n("width"), n("height"))
    }

    /** The largest differences along and across the boxes; a line of text runs along a box's longer side. */
    private fun difference(a: List<LRectangle>, b: List<LRectangle>): Pair<Double, Double> {
        if (a.size != b.size) return Double.MAX_VALUE to Double.MAX_VALUE
        var along = 0.0
        var across = 0.0
        for ((p, q) in a.zip(b)) {
            val x = maxOf(abs(p.x - q.x), abs(p.width - q.width))
            val y = maxOf(abs(p.y - q.y), abs(p.height - q.height))
            val wide = p.width >= p.height
            along = maxOf(along, if (wide) x else y)
            across = maxOf(across, if (wide) y else x)
        }
        return along to across
    }

    /** The black pixels of the page's text and the selection's box, as left, top, right, bottom fractions of the page. */
    private data class Ink(val ink: List<Double>, val box: List<Double>) {
        fun onTheInk(): Boolean {
            val a = if (ink[2] - ink[0] >= ink[3] - ink[1]) 0 else 1
            val c = 1 - a
            return box[c] <= ink[c] + 0.01 && box[c + 2] >= ink[c + 2] - 0.01 &&
                abs(box[a] - ink[a]) <= 0.025 && abs(box[a + 2] - ink[a + 2]) <= 0.025
        }
    }

    private fun inkAndBox(): Ink {
        val script = "(function(){var d=$doc;var c=d.querySelector('canvas#pdf'),b=c.getBoundingClientRect();" +
            "var s=d.getSelection().getRangeAt(0).getBoundingClientRect();var p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;" +
            "var l=1e9,t=1e9,r=-1,u=-1;for(var y=0;y<c.height;y++)for(var x=0;x<c.width;x++){var i=(y*c.width+x)*4;" +
            "if(p[i+3]>200&&p[i]+p[i+1]+p[i+2]<300){if(x<l)l=x;if(x>r)r=x;if(y<t)t=y;if(y>u)u=y}}" +
            "return [l/c.width,t/c.height,(r+1)/c.width,(u+1)/c.height,(s.left-b.left)/b.width,(s.top-b.top)/b.height," +
            "(s.right-b.left)/b.width,(s.bottom-b.top)/b.height].join(',')})()"
        val v = js(script).trim('"').split(",").map { it.toDouble() }
        // Text that runs off the page is cut off in the pixels, so the box is compared where it is on the page.
        return Ink(v.take(4), v.drop(4).map { it.coerceIn(0.0, 1.0) })
    }

    @Test fun rectanglesMatchTheDesktopBrowser() {
        val expected = Json.parseToJsonElement(
            instrumentation.context.assets.open("pdf-rects.json").bufferedReader().readText(),
        ).jsonObject
        val drag = expected.getValue("drag").jsonObject
        fun fraction(k: String, i: Int) = drag.getValue(k).jsonArray[i].jsonPrimitive.double.toFloat()
        val tolerance = expected.getValue("tolerance").jsonObject
        openFixture()

        val report = StringBuilder()
        val failures = mutableListOf<String>()
        for (page in expected.getValue("pages").jsonArray.map { it.jsonObject }) {
            val index = page.getValue("pageIndex").jsonPrimitive.int
            if (index > 0) {
                fresh()
                controller.sendShared(SharedReaderProtocol.gotoPage(index))
                await<SharedEvent.Relocate> { it.pageIndex == index }
            }
            Thread.sleep(900)

            fun limit(k: String) = tolerance.getValue(k).jsonPrimitive.double
            fun compare(kind: String, want: List<LRectangle>, got: SharedEvent.PdfPick) {
                assertEquals("page of the $kind selection", index, got.pageIndex)
                val (along, across) = difference(want, got.rectangles)
                report.append("page ${index + 1} $kind differs ${"%.5f".format(along)} along, ${"%.5f".format(across)} across\n")
                val ok = if (kind == "area") maxOf(along, across) <= limit("area") else along <= limit("along") && across <= limit("across")
                if (!ok) failures += "page ${index + 1} $kind: want $want got ${got.rectangles}"
            }

            if (page.getValue("word") !is JsonNull) {
                fresh()
                js("(function(){var s=$firstSpan;var r=$doc.createRange();r.selectNodeContents(s);var sel=$doc.getSelection();sel.removeAllRanges();sel.addRange(r)})()")
                compare("text", rects(page.getValue("text")), await<SharedEvent.Selection> { it.pdf != null }.pdf!!)
                // Truth, not only agreement: the selection sits on the text the page actually shows.
                val ink = inkAndBox()
                report.append("page ${index + 1} selection against drawn text: $ink\n")
                if (!ink.onTheInk()) failures += "page ${index + 1}: the selection is not on the drawn text: $ink"
                controller.clearSelection()
                Thread.sleep(500)
            }

            controller.setPdfAreaMode(true)
            // The frame shows a crosshair once area mode is on; a drag sent before that would only scroll.
            val ready = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
            while (js("$doc.querySelector('canvas#pdf').style.cursor") != "\"crosshair\"") {
                if (System.nanoTime() > ready) throw AssertionError("area mode never turned on, page ${index + 1}")
                Thread.sleep(50)
            }
            Thread.sleep(400)
            val (left, top, width, height) = box("$doc.querySelector('canvas#pdf')")
            fresh()
            drag(
                screen(left + width * fraction("from", 0), top + height * fraction("from", 1)),
                screen(left + width * fraction("to", 0), top + height * fraction("to", 1)),
            )
            compare("area", rects(page.getValue("area")), await<SharedEvent.Selection> { it.pdf != null }.pdf!!)
            controller.clearSelection()
            controller.setPdfAreaMode(false)
            Thread.sleep(400)
        }
        android.util.Log.i("PdfPositions", report.toString())
        assertTrue("$failures\n$report", failures.isEmpty())
    }

    @Test fun touchingASavedHighlightReportsIt() {
        openFixture()
        Thread.sleep(1500)
        // A highlight over the first line of text, where the text layer lies above it.
        val (left, top, width, height) = box("($firstSpan)")
        val (pl, pt, pw, ph) = box("$doc.querySelector('canvas#pdf')")
        val over = LRectangle(((left - pl) / pw).toDouble(), ((top - pt) / ph).toDouble(), (width / pw).toDouble(), (height / ph).toDouble())
        controller.setPdfAnnotations(listOf(SharedReaderProtocol.PdfPaint("mine", false, 0, listOf(over), "#4ADE80")))
        Thread.sleep(700)
        fresh()
        val at = screen(left + width * 0.5f, top + height * 0.5f)
        val t = android.os.SystemClock.uptimeMillis()
        touch(t, MotionEvent.ACTION_DOWN, at)
        Thread.sleep(60)
        touch(t, MotionEvent.ACTION_UP, at)
        assertEquals("mine", await<SharedEvent.AnnotationClick>().id)
    }

    @Test fun aLongPressSelectsPdfText() {
        openFixture()
        Thread.sleep(1500)
        val (left, top, width, height) = box("($firstSpan)")
        fresh()
        val at = screen(left + width * 0.25f, top + height * 0.5f)
        val t = android.os.SystemClock.uptimeMillis()
        touch(t, MotionEvent.ACTION_DOWN, at)
        Thread.sleep(900)
        touch(t, MotionEvent.ACTION_UP, at)
        val picked = await<SharedEvent.Selection> { it.pdf != null }
        assertTrue("selected text: '${picked.text}'", picked.text.contains("PAGE"))
        assertEquals(0, picked.pdf!!.pageIndex)
    }
}
