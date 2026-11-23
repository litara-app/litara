package com.litara.feature.reader

import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SharedReaderProtocolTest {
    private val p = SharedReaderProtocol

    @Test
    fun `parses the frame's relocate for an ebook and for a pdf`() {
        val e = p.parse("""{"t":"relocate","generation":1,"cfi":"epubcfi(/6/4!/4/2)","fraction":0.25,"page":3,"tocLabel":"One"}""") as SharedEvent.Relocate
        assertEquals("epubcfi(/6/4!/4/2)", e.cfi)
        assertEquals(0.25, e.fraction!!, 0.0)
        assertEquals("One", e.tocLabel)
        assertNull(e.pageIndex)
        val pdf = p.parse("""{"t":"relocate","pageIndex":4,"numPages":7,"x":0,"y":0,"cfi":null,"fraction":0.66}""") as SharedEvent.Relocate
        assertEquals(4, pdf.pageIndex)
        assertEquals(7, pdf.numPages)
        assertNull(pdf.cfi)
    }

    @Test
    fun `converts a frame selection rect to the legacy viewport rect and reads cleared`() {
        val s = p.parse("""{"t":"selection","text":"abc","cfi":"epubcfi(/6/2)","rect":{"x":10,"y":20,"width":30,"height":8}}""") as SharedEvent.Selection
        assertEquals(ViewportRect(10.0, 20.0, 40.0, 28.0), s.rect)
        assertEquals(SharedEvent.SelectionCleared, p.parse("""{"t":"selection","cleared":true}"""))
    }

    @Test
    fun `reads the toc, the loaded message and errors`() {
        val toc = p.parse("""{"t":"toc","items":[{"label":"A","href":"a.xhtml","items":[{"label":"A1","href":"a1.xhtml","items":[]}]}]}""") as SharedEvent.Toc
        assertEquals("A1", toc.items.single().subitems.single().label)
        val l = p.parse("""{"t":"loaded","engine":"foliate","sections":3,"title":"T"}""") as SharedEvent.Loaded
        assertEquals("T", l.title)
        assertEquals(SharedEvent.Failure("unsupported_kind", "x"), p.parse("""{"t":"error","code":"unsupported_kind","detail":"x"}"""))
        assertNull(p.parse("not json"))
    }

    @Test
    fun `builds frame messages`() {
        val open = p.json.parseToJsonElement(p.open("epub", 1234, "b.epub", cfi = "epubcfi(/6/2)")).jsonObject
        assertEquals("open", open["t"]!!.jsonPrimitive.content)
        assertEquals("epubcfi(/6/2)", open["restore"]!!.jsonObject["cfi"]!!.jsonPrimitive.content)
        assertTrue(p.gotoCfiOrHref("epubcfi(/6/2)").contains("\"cfi\""))
        assertTrue(p.gotoCfiOrHref("ch1.xhtml#a").contains("\"href\""))
        assertTrue(p.nav(false).contains("\"prev\""))
    }

    @Test
    fun `maps the legacy settings onto the frame's style`() {
        val s = p.json.parseToJsonElement(p.style(ReaderSettings(fontSize = 24, isDark = false, themeName = "sepia", flow = "scrolled", fontFamily = "Georgia, \"Times New Roman\", serif"))).jsonObject
        assertEquals("150", s["fontPct"]!!.jsonPrimitive.content)
        assertEquals("sepia", s["theme"]!!.jsonPrimitive.content)
        assertEquals("scrolled", s["flow"]!!.jsonPrimitive.content)
        assertEquals("serif", s["font"]!!.jsonPrimitive.content)
        assertEquals("dark", p.json.parseToJsonElement(p.style(ReaderSettings(isDark = true))).jsonObject["theme"]!!.jsonPrimitive.content)
        assertNull(p.json.parseToJsonElement(p.style(ReaderSettings())).jsonObject["font"])
    }

    @Test
    fun `only epub and fb2 use the shared engine in this increment`() {
        assertTrue(p.ebookUsesSharedEngine("EPUB"))
        assertTrue(p.ebookUsesSharedEngine("fb2"))
        for (f in listOf("mobi", "azw3", "kepub", "cbz")) assertFalse(f, p.ebookUsesSharedEngine(f))
    }

    @Test
    fun `parses taps and search messages`() {
        assertEquals(SharedEvent.Tap(0.25, 0.5), p.parse("""{"t":"tap","generation":1,"x":0.25,"y":0.5}"""))
        val r = p.parse("""{"t":"search-results","label":"Chapter 2","items":[{"cfi":"epubcfi(/6/4!/4/2)","pre":"a ","match":"harbour","post":" wall"}]}""") as SharedEvent.SearchResults
        assertEquals(SearchHit("epubcfi(/6/4!/4/2)", "a ", "harbour", " wall"), r.hits.single())
        assertEquals("Chapter 2", r.label)
        assertEquals(SharedEvent.SearchProgress(0.5), p.parse("""{"t":"search-progress","progress":0.5}"""))
        assertEquals(SharedEvent.SearchDone(3, true, false), p.parse("""{"t":"search-done","total":3,"capped":true}"""))
        assertEquals(true, (p.parse("""{"t":"search-done","total":0,"capped":false,"unsupported":true}""") as SharedEvent.SearchDone).unsupported)
    }

    @Test
    fun `sends the text settings and per-highlight appearance`() {
        val s = p.json.parseToJsonElement(p.style(ReaderSettings(lineHeight = 1.8, justify = false, hyphenate = true, maxColumnCount = 1, gap = 0.08, maxInlineSize = 640))).jsonObject
        assertEquals("1.8", s["lineHeight"]!!.jsonPrimitive.content)
        assertEquals("false", s["justify"]!!.jsonPrimitive.content)
        assertEquals("true", s["hyphenate"]!!.jsonPrimitive.content)
        assertEquals("1", s["maxColumns"]!!.jsonPrimitive.content)
        assertEquals(8.0, s["gapPct"]!!.jsonPrimitive.content.toDouble(), 0.001)
        assertEquals("640", s["maxInlineSize"]!!.jsonPrimitive.content)
        assertEquals("#4ade80", p.hexColor("green"))
        assertEquals("#123abc", p.hexColor("#123abc"))
        assertEquals("#facc15", p.hexColor("url(x)"))
        assertEquals("underline", p.drawStyle("underline"))
        assertEquals("highlight", p.drawStyle("whatever"))
        assertEquals("""{"t":"search","query":"a b","max":500}""", p.search("a b"))
    }

    @Test
    fun `parses book slice paths`() {
        assertEquals(0L to 10L, SharedBookResponder.parseSlice("/litara-book/0-10"))
        assertEquals(40648L to 40670L, SharedBookResponder.parseSlice("/litara-book/40648-40670"))
        assertNull(SharedBookResponder.parseSlice("/litara-book/10-10"))
        assertNull(SharedBookResponder.parseSlice("/litara-book/10-3"))
        assertNull(SharedBookResponder.parseSlice("/litara-book/current"))
        assertNull(SharedBookResponder.parseSlice("/assets/reader/index.html"))
        assertNull(SharedBookResponder.parseSlice("/litara-book/../x-9"))
    }
}
