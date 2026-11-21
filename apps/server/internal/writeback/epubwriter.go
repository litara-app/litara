package writeback

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"context"
	"crypto/sha256"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/deranjer/ebooker/apps/server/internal/ebookmeta"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

// EPUBWriter writes title, authors and series into an EPUB's package document (ADR-0048/0052). It uses only the Go standard
// library. The package document is edited in place at the byte level (only the elements it manages change) and every other zip
// entry is copied raw, so book content, images, fonts, chapters (the nav/NCX), artwork and unknown metadata are byte-identical
// by construction; Validate re-proves that on the staged file. There is no re-serialisation of XML, no transcoding and no
// conversion. Fields it cannot write (for example narrators) are refused explicitly, never dropped.
type EPUBWriter struct{}

// Format reports the container format this writer handles.
func (EPUBWriter) Format() string { return "epub" }

// MediaInspection is false: an EPUB has no audio streams for the engine's ffprobe comparison; Validate is the fidelity check.
func (EPUBWriter) MediaInspection() bool { return false }

const (
	maxOPFBytes   = 1 << 20
	maxEPUBFiles  = 10000
	dcNS          = "http://purl.org/dc/elements/1.1/"
	calibreSeries = "calibre:series"
	calibreIndex  = "calibre:series_index"
)

// epubChanges is the supported subset of metadata.Fields, using the same field names as the metadata service and the HTTP API:
// title, authors, series_name and series_index. series_name and series_index are separate fields; null clears.
type epubChanges struct {
	title              *string
	authors            []string // nil = unchanged
	nameSet, nameClear bool
	seriesNm           string
	idxSet, idxClear   bool
	seriesIdx          float64
	// Descriptive fields (ADR-0081). A field is untouched unless set or cleared.
	publisher, published, isbn, desc single
	pagesSet, pagesClear             bool
	pages                            int
	// cover is a new cover image as JPEG bytes (ADR-0086), supplied by the engine from the stored cover as cover_image.
	cover []byte
	// addCoverID, set by the writer (never by a caller), adds <meta name="cover"> for a cover it is adding.
	addCoverID string
}

// single is one optional text field: set it to val, or clear it.
type single struct {
	set, clear bool
	val        string
}

func (s single) touched() bool { return s.set || s.clear }

func parseEPUBChanges(f metadata.Fields) (epubChanges, error) {
	var c epubChanges
	for k, raw := range f {
		switch k {
		case "title":
			var s string
			if err := json.Unmarshal(raw, &s); err != nil || strings.TrimSpace(s) == "" {
				return c, errors.New("title must be a non-empty string")
			}
			s = strings.TrimSpace(s)
			c.title = &s
		case "authors":
			var a []string
			if err := json.Unmarshal(raw, &a); err != nil || len(a) == 0 {
				return c, errors.New("authors must be a non-empty list of names")
			}
			for i := range a {
				if a[i] = strings.TrimSpace(a[i]); a[i] == "" {
					return c, errors.New("authors must not contain an empty name")
				}
			}
			c.authors = a
		case "series_name":
			if string(raw) == "null" {
				c.nameClear = true
				continue
			}
			var n string
			if err := json.Unmarshal(raw, &n); err != nil || strings.TrimSpace(n) == "" {
				return c, errors.New("series_name must be null or a non-empty string")
			}
			c.nameSet, c.seriesNm = true, strings.TrimSpace(n)
		case "series_index":
			if string(raw) == "null" {
				c.idxClear = true
				continue
			}
			var v float64
			if err := json.Unmarshal(raw, &v); err != nil || v < 0 {
				return c, errors.New("series_index must be null or a non-negative number")
			}
			c.idxSet, c.seriesIdx = true, v
		case "publisher", "published", "isbn", "description":
			sg, err := parseSingle(k, raw)
			if err != nil {
				return c, err
			}
			switch k {
			case "publisher":
				c.publisher = sg
			case "published":
				c.published = sg
			case "isbn":
				c.isbn = sg
			default:
				c.desc = sg
			}
		case "page_count":
			if string(raw) == "null" {
				c.pagesClear = true
				continue
			}
			var n int
			if err := json.Unmarshal(raw, &n); err != nil || n < 1 || n > 100000 {
				return c, errors.New("page_count must be null or a whole number from 1 to 100000")
			}
			c.pagesSet, c.pages = true, n
		case "cover_image":
			img, err := parseCoverImage(raw)
			if err != nil {
				return c, err
			}
			c.cover = img
		default:
			return c, fmt.Errorf("the EPUB writer does not support the field %q", k)
		}
	}
	if c.title == nil && c.authors == nil && !c.nameSet && !c.nameClear && !c.idxSet && !c.idxClear &&
		!c.publisher.touched() && !c.published.touched() && !c.isbn.touched() && !c.desc.touched() && !c.pagesSet && !c.pagesClear && c.cover == nil {
		return c, errors.New("no supported change")
	}
	if c.nameClear && c.nameSet {
		return c, errors.New("series_name cannot be both set and cleared")
	}
	return c, nil
}

var (
	publishedRe = regexp.MustCompile(`^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$`)
	isbnRe      = regexp.MustCompile(`^(\d{9}[\dX]|\d{13})$`)
)

func parseSingle(field string, raw json.RawMessage) (single, error) {
	if string(raw) == "null" {
		return single{clear: true}, nil
	}
	var v string
	if err := json.Unmarshal(raw, &v); err != nil || strings.TrimSpace(v) == "" {
		return single{}, fmt.Errorf("%s must be null or a non-empty string", field)
	}
	v = strings.TrimSpace(v)
	switch field {
	case "publisher":
		if len([]rune(v)) > 512 {
			return single{}, errors.New("publisher must be at most 512 characters")
		}
	case "published":
		if !publishedRe.MatchString(v) {
			return single{}, errors.New("published must be YYYY, YYYY-MM or YYYY-MM-DD")
		}
	case "isbn":
		if !isbnRe.MatchString(v) {
			return single{}, errors.New("isbn must be 10 or 13 characters without hyphens")
		}
	case "description":
		if len([]rune(v)) > 8000 {
			return single{}, errors.New("description must be at most 8000 characters")
		}
		if strings.ContainsAny(v, "<>") {
			return single{}, errors.New("a description written to the file cannot contain < or >, because readers would take them for markup")
		}
	}
	return single{set: true, val: v}, nil
}

// isbnText reports whether an identifier's text is an ISBN, and the prefix it is written with.
func isbnText(t string) (prefix string, ok bool) {
	s := strings.TrimSpace(t)
	low := strings.ToLower(s)
	switch {
	case strings.HasPrefix(low, "urn:isbn:"):
		prefix, s = s[:9], s[9:]
	case strings.HasPrefix(low, "isbn:"):
		prefix, s = s[:5], s[5:]
	}
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= '0' && r <= '9', r == 'x':
			b.WriteRune(r)
		case r == '-' || r == ' ':
		default:
			return "", false
		}
	}
	n := b.Len()
	return prefix, n == 10 || n == 13
}

// ---- reading the package document with byte offsets --------------------------------------------------------------

type attr struct{ name, value string } // name is "prefix:local" or "local"

type child struct {
	prefix, local         string
	attrs                 []attr
	start, end            int // whole element in the source
	textStart, textEnd    int // inner span; valid when !selfClosing
	selfClosing, hasChild bool
}

func (c child) qname() string {
	if c.prefix != "" {
		return c.prefix + ":" + c.local
	}
	return c.local
}

func (c child) attr(name string) (string, bool) {
	for _, a := range c.attrs {
		if a.name == name {
			return a.value, true
		}
	}
	return "", false
}

type opfDoc struct {
	src                       []byte
	metaOpenEnd, metaCloseBeg int // inside <metadata>: after its start tag, and where its end tag begins
	metaStart, metaEnd        int // the whole <metadata> element
	children                  []child
	dcPrefix                  string
	indent                    string
}

func parseOPF(src []byte) (*opfDoc, error) {
	if len(src) > maxOPFBytes {
		return nil, errors.New("package document is too large")
	}
	d := xml.NewDecoder(bytes.NewReader(src))
	d.Strict = true
	doc := &opfDoc{src: src, metaOpenEnd: -1}
	type open struct {
		name       xml.Name
		startTokAt int
	}
	var stack []open
	prev := 0
	var cur *child
	dcFound := false
	findDC := func(attrs []xml.Attr) {
		for _, a := range attrs {
			if a.Value != dcNS {
				continue
			}
			if a.Name.Space == "xmlns" {
				doc.dcPrefix, dcFound = a.Name.Local, true
			} else if a.Name.Space == "" && a.Name.Local == "xmlns" {
				doc.dcPrefix, dcFound = "", true
			}
		}
	}
	for {
		tok, err := d.RawToken()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("package document is not well-formed or uses an unsupported encoding: %w", err)
		}
		off := int(d.InputOffset())
		start := prev
		prev = off
		switch t := tok.(type) {
		case xml.StartElement:
			findDC(t.Attr)
			stack = append(stack, open{t.Name, start})
			switch len(stack) {
			case 2:
				if t.Name.Local == "metadata" {
					doc.metaStart, doc.metaOpenEnd = start, off
				}
			case 3:
				if doc.metaOpenEnd >= 0 && stack[1].name.Local == "metadata" {
					c := child{prefix: t.Name.Space, local: t.Name.Local, start: start, textStart: off}
					for _, a := range t.Attr {
						n := a.Name.Local
						if a.Name.Space != "" {
							n = a.Name.Space + ":" + n
						}
						c.attrs = append(c.attrs, attr{n, a.Value})
					}
					cur = &c
				}
			default:
				if len(stack) > 3 && cur != nil {
					cur.hasChild = true
				}
			}
		case xml.EndElement:
			if len(stack) == 0 {
				return nil, errors.New("unbalanced package document")
			}
			top := stack[len(stack)-1]
			switch len(stack) {
			case 3:
				if cur != nil {
					cur.end = off
					cur.selfClosing = off == cur.textStart && start == cur.textStart
					cur.textEnd = start
					doc.children = append(doc.children, *cur)
					cur = nil
				}
			case 2:
				if top.name.Local == "metadata" {
					doc.metaCloseBeg, doc.metaEnd = start, off
				}
			}
			stack = stack[:len(stack)-1]
		}
	}
	if len(stack) != 0 || doc.metaOpenEnd < 0 || doc.metaEnd == 0 {
		return nil, errors.New("package document has no metadata element")
	}
	if !dcFound {
		return nil, errors.New("package document does not declare the Dublin Core namespace")
	}
	// Indentation of the metadata children, for inserted elements.
	if len(doc.children) > 0 {
		before := string(src[doc.metaOpenEnd:doc.children[0].start])
		if i := strings.LastIndex(before, "\n"); i >= 0 {
			doc.indent = before[i+1:]
		}
	}
	return doc, nil
}

func (c child) inner(src []byte) string {
	if c.selfClosing {
		return ""
	}
	return string(src[c.textStart:c.textEnd])
}

// ---- edits --------------------------------------------------------------------------------------------------------

type edit struct {
	start, end int
	text       string
}

func esc(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

func escAttr(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;").Replace(s)
}

func fmtIndex(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func (d *opfDoc) dcName(local string) string {
	if d.dcPrefix == "" {
		return local
	}
	return d.dcPrefix + ":" + local
}

// isPublicationDate is a dc:date that is not the file's last-modified stamp.
func (d *opfDoc) isPublicationDate(c child) bool {
	for _, a := range c.attrs {
		if (a.name == "event" || strings.HasSuffix(a.name, ":event")) && strings.EqualFold(a.value, "modification") {
			return false
		}
	}
	return true
}

func (d *opfDoc) newline() string { return "\n" + d.indent }

func (d *opfDoc) isDC(c child, local string) bool { return c.local == local && c.prefix == d.dcPrefix }

func (d *opfDoc) metaPrefix() string {
	for _, c := range d.children {
		if c.local == "meta" {
			return c.prefix
		}
	}
	return ""
}

func (d *opfDoc) metaName() string {
	if p := d.metaPrefix(); p != "" {
		return p + ":meta"
	}
	return "meta"
}

// rebuild renders a managed meta element with one attribute replaced (self-closing) or its text replaced.
func rebuildMeta(c child, qn string, attrName, attrVal string, text *string) string {
	var b strings.Builder
	b.WriteString("<" + qn)
	for _, a := range c.attrs {
		v := a.value
		if a.name == attrName {
			v = attrVal
		}
		b.WriteString(" " + a.name + "=\"" + escAttr(v) + "\"")
	}
	if text != nil {
		b.WriteString(">" + esc(*text) + "</" + qn + ">")
	} else {
		b.WriteString("/>")
	}
	return b.String()
}

func (d *opfDoc) plan(c epubChanges) ([]edit, error) {
	var edits []edit
	seen := map[int]bool{}
	add := func(e edit) {
		if !seen[e.start] {
			seen[e.start] = true
			edits = append(edits, e)
		}
	}
	remove := func(ch child) { add(edit{ch.start, ch.end, ""}) }
	var inserts []string

	for _, ch := range d.children {
		if ch.hasChild && (d.isDC(ch, "title") || d.isDC(ch, "creator") ||
			(c.publisher.touched() && d.isDC(ch, "publisher")) || (c.published.touched() && d.isDC(ch, "date")) ||
			(c.desc.touched() && d.isDC(ch, "description"))) {
			return nil, fmt.Errorf("unexpected nested markup in %s", ch.qname())
		}
	}

	if c.title != nil {
		var first *child
		for i := range d.children {
			if d.isDC(d.children[i], "title") {
				first = &d.children[i]
				break
			}
		}
		switch {
		case first == nil:
			inserts = append(inserts, "<"+d.dcName("title")+">"+esc(*c.title)+"</"+d.dcName("title")+">")
		case first.selfClosing:
			add(edit{first.start, first.end, rebuildWithText(*first, *c.title)})
		default:
			add(edit{first.textStart, first.textEnd, esc(*c.title)})
		}
	}

	if c.authors != nil {
		var creators []child
		for _, ch := range d.children {
			if d.isDC(ch, "creator") {
				creators = append(creators, ch)
			}
		}
		for i, name := range c.authors {
			if i < len(creators) {
				if creators[i].selfClosing {
					add(edit{creators[i].start, creators[i].end, rebuildWithText(creators[i], name)})
				} else {
					add(edit{creators[i].textStart, creators[i].textEnd, esc(name)})
				}
			}
		}
		for i := len(c.authors); i < len(creators); i++ {
			remove(creators[i])
		}
		// Extra creators go right after the last existing one (or at the end of the metadata block).
		var extra string
		for i := len(creators); i < len(c.authors); i++ {
			extra += d.newline() + "<" + d.dcName("creator") + ">" + esc(c.authors[i]) + "</" + d.dcName("creator") + ">"
		}
		if extra != "" {
			at := d.metaCloseBeg
			if len(creators) > 0 {
				at = creators[len(creators)-1].end
			}
			add(edit{at, at, extra})
		}
	}

	if c.nameSet || c.nameClear || c.idxSet || c.idxClear {
		var calSer, calIdx, coll []child
		for _, ch := range d.children {
			if ch.local != "meta" {
				continue
			}
			if v, _ := ch.attr("name"); v == calibreSeries {
				calSer = append(calSer, ch)
			} else if v == calibreIndex {
				calIdx = append(calIdx, ch)
			} else if p, _ := ch.attr("property"); p == "belongs-to-collection" {
				coll = append(coll, ch)
			}
		}
		positions := func(co child) (pos *child, rest []child) {
			id, ok := co.attr("id")
			if !ok {
				return nil, nil
			}
			for i := range d.children {
				if r, _ := d.children[i].attr("refines"); r == "#"+id {
					if p, _ := d.children[i].attr("property"); p == "group-position" {
						pos = &d.children[i]
					} else if p == "collection-type" {
						rest = append(rest, d.children[i])
					}
				}
			}
			return pos, rest
		}
		mn := d.metaName()
		hasSeries := len(calSer) > 0 || len(coll) > 0
		switch {
		case c.nameClear:
			// No series: its name, index and collection refinements all go (an index without a series is meaningless).
			for _, ch := range append(append([]child{}, calSer...), calIdx...) {
				remove(ch)
			}
			for _, co := range coll {
				remove(co)
				pos, rest := positions(co)
				if pos != nil {
					remove(*pos)
				}
				for _, r := range rest {
					remove(r)
				}
			}
		default:
			if c.nameSet {
				if len(calSer) > 0 {
					add(edit{calSer[0].start, calSer[0].end, rebuildMeta(calSer[0], mn, "content", c.seriesNm, nil)})
					for _, extra := range calSer[1:] {
						remove(extra)
					}
				}
				for _, co := range coll {
					if co.selfClosing {
						return nil, errors.New("collection metadata has no text to replace")
					}
					add(edit{co.textStart, co.textEnd, esc(c.seriesNm)})
				}
				if !hasSeries {
					ins := "<" + mn + " name=\"" + calibreSeries + "\" content=\"" + escAttr(c.seriesNm) + "\"/>"
					if c.idxSet {
						ins += d.newline() + "<" + mn + " name=\"" + calibreIndex + "\" content=\"" + fmtIndex(c.seriesIdx) + "\"/>"
					}
					inserts = append(inserts, ins)
					break
				}
			} else if c.idxSet && !hasSeries {
				return nil, errors.New("series_index needs a series: the file has none and no series_name was given")
			}
			if c.idxSet || c.idxClear {
				if len(calIdx) > 0 {
					if c.idxSet {
						add(edit{calIdx[0].start, calIdx[0].end, rebuildMeta(calIdx[0], mn, "content", fmtIndex(c.seriesIdx), nil)})
						for _, extra := range calIdx[1:] {
							remove(extra)
						}
					} else {
						for _, ch := range calIdx {
							remove(ch)
						}
					}
				} else if c.idxSet && len(calSer) > 0 {
					at := calSer[0].end
					add(edit{at, at, d.newline() + "<" + mn + " name=\"" + calibreIndex + "\" content=\"" + fmtIndex(c.seriesIdx) + "\"/>"})
				}
				for _, co := range coll {
					pos, _ := positions(co)
					switch {
					case pos != nil && c.idxSet && !pos.selfClosing:
						add(edit{pos.textStart, pos.textEnd, esc(fmtIndex(c.seriesIdx))})
					case pos != nil && c.idxClear:
						remove(*pos)
					case pos == nil && c.idxSet:
						if id, ok := co.attr("id"); ok {
							add(edit{co.end, co.end, d.newline() + "<" + mn + " refines=\"#" + escAttr(id) + "\" property=\"group-position\">" + esc(fmtIndex(c.seriesIdx)) + "</" + mn + ">"})
						}
					}
				}
			}
		}
	}

	// A page count lives in a <meta name="litara:page_count"> pair (no vocabulary prefix is needed, as with Calibre's own
	// metas). BookOrbit's bookorbit:page_count is updated alongside it so both agree; a Calibre custom column is read-only.
	if c.pagesSet || c.pagesClear {
		var mine, theirs []child
		for _, ch := range d.children {
			if ch.local != "meta" {
				continue
			}
			n, _ := ch.attr("name")
			p, _ := ch.attr("property")
			switch {
			case n == "litara:page_count" || p == "litara:page_count":
				mine = append(mine, ch)
			case n == "bookorbit:page_count" || p == "bookorbit:page_count":
				theirs = append(theirs, ch)
			case n == "calibre:user_metadata:#pagecount" || n == "calibre:user_metadata:#page_count":
				if c.pagesClear {
					return nil, errors.New("the page count is stored in a Calibre custom column, which this writer does not change")
				}
			}
		}
		set := func(ch child) {
			if p, _ := ch.attr("property"); p != "" {
				if ch.selfClosing {
					return
				}
				add(edit{ch.textStart, ch.textEnd, esc(strconv.Itoa(c.pages))})
			} else {
				add(edit{ch.start, ch.end, rebuildMeta(ch, d.metaName(), "content", strconv.Itoa(c.pages), nil)})
			}
		}
		switch {
		case c.pagesClear:
			for _, ch := range append(append([]child{}, mine...), theirs...) {
				remove(ch)
			}
		default:
			if len(mine) == 0 {
				inserts = append(inserts, "<"+d.metaName()+" name=\"litara:page_count\" content=\""+strconv.Itoa(c.pages)+"\"/>")
			} else {
				set(mine[0])
				for _, extra := range mine[1:] {
					remove(extra)
				}
			}
			for _, ch := range theirs {
				set(ch)
			}
		}
	}

	// Single-valued descriptive elements: replace the first, drop any extras, or add one when the file has none.
	oneOf := func(sg single, local string, pick func(child) bool) {
		if !sg.touched() {
			return
		}
		var found []child
		for _, ch := range d.children {
			if d.isDC(ch, local) && pick(ch) {
				found = append(found, ch)
			}
		}
		switch {
		case sg.clear:
			for _, ch := range found {
				remove(ch)
			}
		case len(found) == 0:
			inserts = append(inserts, "<"+d.dcName(local)+">"+esc(sg.val)+"</"+d.dcName(local)+">")
		default:
			if found[0].selfClosing {
				add(edit{found[0].start, found[0].end, rebuildWithText(found[0], sg.val)})
			} else {
				add(edit{found[0].textStart, found[0].textEnd, esc(sg.val)})
			}
			for _, ch := range found[1:] {
				remove(ch)
			}
		}
	}
	always := func(child) bool { return true }
	oneOf(c.publisher, "publisher", always)
	oneOf(c.desc, "description", always)
	oneOf(c.published, "date", d.isPublicationDate)

	if c.isbn.touched() {
		var found []child
		for _, ch := range d.children {
			if d.isDC(ch, "identifier") && !ch.selfClosing {
				if _, ok := isbnText(ch.inner(d.src)); ok {
					found = append(found, ch)
				}
			}
		}
		switch {
		case c.isbn.clear:
			for _, ch := range found {
				if _, hasID := ch.attr("id"); hasID {
					return nil, errors.New("the ISBN is the book's package identifier, so it cannot be removed from the file")
				}
				remove(ch)
			}
		case len(found) == 0:
			inserts = append(inserts, "<"+d.dcName("identifier")+">urn:isbn:"+esc(c.isbn.val)+"</"+d.dcName("identifier")+">")
		default:
			prefix, _ := isbnText(found[0].inner(d.src))
			add(edit{found[0].textStart, found[0].textEnd, esc(prefix + c.isbn.val)})
			for _, ch := range found[1:] {
				if _, hasID := ch.attr("id"); !hasID {
					remove(ch)
				}
			}
		}
	}

	if c.addCoverID != "" {
		inserts = append(inserts, "<"+d.metaName()+` name="cover" content="`+c.addCoverID+`"/>`)
	}
	if len(inserts) > 0 {
		text := ""
		for _, s := range inserts {
			text += d.newline() + s
		}
		add(edit{d.metaCloseBeg, d.metaCloseBeg, text})
	}
	return edits, nil
}

func rebuildWithText(c child, text string) string {
	var b strings.Builder
	qn := c.qname()
	b.WriteString("<" + qn)
	for _, a := range c.attrs {
		b.WriteString(" " + a.name + "=\"" + escAttr(a.value) + "\"")
	}
	b.WriteString(">" + esc(text) + "</" + qn + ">")
	return b.String()
}

func applyEdits(src []byte, edits []edit) ([]byte, error) {
	sort.SliceStable(edits, func(i, j int) bool {
		if edits[i].start != edits[j].start {
			return edits[i].start > edits[j].start
		}
		return edits[i].end > edits[j].end
	})
	out := append([]byte(nil), src...)
	lastStart := len(src) + 1
	for _, e := range edits {
		if e.end > lastStart {
			return nil, errors.New("overlapping package edits")
		}
		out = append(out[:e.start], append([]byte(e.text), out[e.end:]...)...)
		lastStart = e.start
	}
	return out, nil
}

// ---- container handling ---------------------------------------------------------------------------------------------

type epubFile struct {
	zr      *zip.ReadCloser
	opfName string
	opf     []byte
	opfFile *zip.File
}

func openEPUB(p string) (*epubFile, error) {
	zr, err := zip.OpenReader(p)
	if err != nil {
		return nil, fmt.Errorf("not a readable EPUB archive: %w", err)
	}
	e := &epubFile{zr: zr}
	if len(zr.File) > maxEPUBFiles {
		zr.Close()
		return nil, errors.New("archive has too many entries")
	}
	seen := map[string]bool{}
	for _, f := range zr.File {
		if seen[f.Name] {
			zr.Close()
			return nil, fmt.Errorf("duplicate archive entry %q", f.Name)
		}
		seen[f.Name] = true
		if f.Flags&0x1 != 0 {
			zr.Close()
			return nil, fmt.Errorf("encrypted archive entry %q", f.Name)
		}
	}
	read := func(name string, max int) ([]byte, *zip.File, error) {
		for _, f := range zr.File {
			if f.Name != name {
				continue
			}
			if f.UncompressedSize64 > uint64(max) {
				return nil, nil, fmt.Errorf("%s is too large", name)
			}
			rc, err := f.Open()
			if err != nil {
				return nil, nil, err
			}
			defer rc.Close()
			b, err := io.ReadAll(io.LimitReader(rc, int64(max)+1))
			if err != nil || len(b) > max {
				return nil, nil, fmt.Errorf("%s could not be read within limits", name)
			}
			return b, f, nil
		}
		return nil, nil, fmt.Errorf("%s not found", name)
	}
	cb, _, err := read("META-INF/container.xml", 1<<20)
	if err != nil {
		zr.Close()
		return nil, err
	}
	var c struct {
		Rootfiles []struct {
			FullPath string `xml:"full-path,attr"`
		} `xml:"rootfiles>rootfile"`
	}
	if err := xml.Unmarshal(cb, &c); err != nil || len(c.Rootfiles) == 0 {
		zr.Close()
		return nil, errors.New("container.xml has no rootfile")
	}
	root := path.Clean(c.Rootfiles[0].FullPath)
	if strings.HasPrefix(root, "..") || path.IsAbs(root) {
		zr.Close()
		return nil, errors.New("rootfile path escapes the archive")
	}
	e.opfName = root
	if e.opf, e.opfFile, err = read(root, maxOPFBytes); err != nil {
		zr.Close()
		return nil, err
	}
	if m := e.opfFile.Method; m != zip.Store && m != zip.Deflate {
		zr.Close()
		return nil, fmt.Errorf("package document uses unsupported compression method %d", m)
	}
	return e, nil
}

func (e *epubFile) close() { e.zr.Close() }

// Write stages dst from src with the changes applied. src is only read.
func (EPUBWriter) Write(ctx context.Context, src, dst string, changes metadata.Fields) (err error) {
	ch, err := parseEPUBChanges(changes)
	if err != nil {
		return err
	}
	e, err := openEPUB(src)
	if err != nil {
		return err
	}
	defer e.close()
	doc, err := parseOPF(e.opf)
	if err != nil {
		return err
	}
	var cp coverPlan
	if ch.cover != nil {
		if cp, err = e.planCover(ch.cover); err != nil {
			return err
		}
		if cp.add {
			ch.addCoverID = cp.id
		}
	}
	edits, err := doc.plan(ch)
	if err != nil {
		return err
	}
	newOPF, err := applyEdits(e.opf, edits)
	if err != nil {
		return err
	}
	if cp.add {
		if newOPF, err = cp.applyManifest(newOPF, strings.HasPrefix(packageVersion(e.opf), "3")); err != nil {
			return err
		}
	}
	if _, err := parseOPF(newOPF); err != nil {
		return fmt.Errorf("edited package document is not valid: %w", err)
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			os.Remove(dst)
		}
	}()
	zw := zip.NewWriter(out)
	zw.SetComment(e.zr.Comment)
	for _, f := range e.zr.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		if f.Name != e.opfName && (cp.data == nil || cp.add || f.Name != cp.name) {
			if err := zw.Copy(f); err != nil { // raw copy: same compressed bytes, method, CRC, times and extra fields
				return err
			}
			continue
		}
		data := newOPF
		if f.Name != e.opfName {
			data = cp.data
		}
		if err := replaceEntry(zw, f, data); err != nil {
			return err
		}
	}
	if cp.add {
		h := &zip.FileHeader{Name: cp.name, Method: zip.Store, Modified: e.opfFile.Modified}
		w, err := zw.CreateHeader(h)
		if err != nil {
			return err
		}
		if _, err := w.Write(cp.data); err != nil {
			return err
		}
	}
	if err := zw.Close(); err != nil {
		return err
	}
	return out.Sync()
}

// replaceEntry writes f's replacement with the same name, method and timestamps; the sizes and CRC are recomputed.
func replaceEntry(zw *zip.Writer, f *zip.File, data []byte) error {
	var buf bytes.Buffer
	if f.Method == zip.Deflate {
		fw, _ := flate.NewWriter(&buf, flate.DefaultCompression)
		fw.Write(data)
		fw.Close()
	} else {
		buf.Write(data)
	}
	h := f.FileHeader
	h.CRC32 = crc32.ChecksumIEEE(data)
	h.UncompressedSize64 = uint64(len(data))
	h.CompressedSize64 = uint64(buf.Len())
	h.Flags &^= 0x8 // sizes are known: no data descriptor
	h.Extra = nil   // a stale zip64 extra field must not describe the old sizes
	w, err := zw.CreateRaw(&h)
	if err != nil {
		return err
	}
	_, err = w.Write(buf.Bytes())
	return err
}

func pageMeta(ch child) bool {
	n, _ := ch.attr("name")
	p, _ := ch.attr("property")
	return n == "litara:page_count" || p == "litara:page_count" || n == "bookorbit:page_count" || p == "bookorbit:page_count"
}

func rawSum(f *zip.File) (string, error) {
	r, err := f.OpenRaw()
	if err != nil {
		return "", err
	}
	h := sha256.New()
	if _, err := io.Copy(h, r); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

// managed marks the metadata children the requested changes may touch.
func (d *opfDoc) managed(c epubChanges) map[int]bool {
	m := map[int]bool{}
	titleDone := false
	nameTouched := c.nameSet || c.nameClear
	idxTouched := c.idxSet || c.idxClear || c.nameClear
	collIDs := map[string]bool{}
	if nameTouched || idxTouched {
		for _, ch := range d.children {
			if p, _ := ch.attr("property"); ch.local == "meta" && p == "belongs-to-collection" {
				if id, ok := ch.attr("id"); ok {
					collIDs[id] = true
				}
			}
		}
	}
	for i, ch := range d.children {
		switch {
		case c.title != nil && !titleDone && d.isDC(ch, "title"):
			m[i], titleDone = true, true
		case c.authors != nil && d.isDC(ch, "creator"):
			m[i] = true
		case c.publisher.touched() && d.isDC(ch, "publisher"), c.desc.touched() && d.isDC(ch, "description"),
			c.published.touched() && d.isDC(ch, "date") && d.isPublicationDate(ch):
			m[i] = true
		case c.isbn.touched() && d.isDC(ch, "identifier") && !ch.selfClosing:
			if _, ok := isbnText(ch.inner(d.src)); ok {
				m[i] = true
			}
		case ch.local == "meta" && (c.pagesSet || c.pagesClear) && pageMeta(ch):
			m[i] = true
		case ch.local == "meta" && c.addCoverID != "" && coverMetaFor(ch, c.addCoverID):
			m[i] = true
		case ch.local == "meta":
			n, _ := ch.attr("name")
			p, _ := ch.attr("property")
			r, _ := ch.attr("refines")
			onColl := strings.HasPrefix(r, "#") && collIDs[r[1:]]
			switch {
			case nameTouched && (n == calibreSeries || p == "belongs-to-collection" || (onColl && p == "collection-type")):
				m[i] = true
			case idxTouched && (n == calibreIndex || (onColl && p == "group-position")):
				m[i] = true
			}
		}
	}
	return m
}

// Validate proves the staged file is the original plus exactly the requested metadata edits.
func (EPUBWriter) Validate(ctx context.Context, orig, staged string, changes metadata.Fields) error {
	ch, err := parseEPUBChanges(changes)
	if err != nil {
		return err
	}
	o, err := openEPUB(orig)
	if err != nil {
		return fmt.Errorf("original: %w", err)
	}
	defer o.close()
	s, err := openEPUB(staged)
	if err != nil {
		return fmt.Errorf("staged: %w", err)
	}
	defer s.close()
	var cp coverPlan
	if ch.cover != nil {
		if cp, err = o.planCover(ch.cover); err != nil {
			return err
		}
		if cp.add {
			ch.addCoverID = cp.id
		}
	}
	wantEntries := len(o.zr.File)
	if cp.add {
		wantEntries++
	}
	if o.opfName != s.opfName || len(s.zr.File) != wantEntries {
		return errors.New("archive layout changed")
	}
	for i, of := range o.zr.File {
		sf := s.zr.File[i]
		if of.Name != sf.Name || of.Method != sf.Method {
			return fmt.Errorf("entry %d changed name or method", i)
		}
		if of.Name == o.opfName {
			continue
		}
		if cp.data != nil && !cp.add && of.Name == cp.name {
			got, err := readEntry(sf, maxCoverBytes)
			if err != nil || !bytes.Equal(got, cp.data) {
				return fmt.Errorf("the cover image %q is not the requested cover", of.Name)
			}
			continue
		}
		if of.CRC32 != sf.CRC32 || of.UncompressedSize64 != sf.UncompressedSize64 {
			return fmt.Errorf("entry %q content changed", of.Name)
		}
		a, err := rawSum(of)
		if err != nil {
			return err
		}
		b, err := rawSum(sf)
		if err != nil {
			return err
		}
		if a != b {
			return fmt.Errorf("entry %q bytes changed", of.Name)
		}
	}
	if cp.add {
		added := s.zr.File[len(s.zr.File)-1]
		got, err := readEntry(added, maxCoverBytes)
		if added.Name != cp.name || err != nil || !bytes.Equal(got, cp.data) {
			return fmt.Errorf("the added cover entry %q is not the requested cover", cp.name)
		}
	}
	if len(o.zr.File) > 0 && o.zr.File[0].Name == "mimetype" && (s.zr.File[0].Name != "mimetype" || s.zr.File[0].Method != zip.Store) {
		return errors.New("mimetype is no longer the first stored entry")
	}
	if o.zr.Comment != s.zr.Comment {
		return errors.New("archive comment changed")
	}
	od, err := parseOPF(o.opf)
	if err != nil {
		return err
	}
	sd, err := parseOPF(s.opf)
	if err != nil {
		return err
	}
	sBefore, sAfter := s.opf[:sd.metaStart], s.opf[sd.metaEnd:]
	if cp.add {
		// The only change outside <metadata> is the one manifest item that was added, exactly as planned.
		switch {
		case bytes.Contains(sAfter, []byte(cp.insert)):
			sAfter = bytes.Replace(sAfter, []byte(cp.insert), nil, 1)
		case bytes.Contains(sBefore, []byte(cp.insert)):
			sBefore = bytes.Replace(sBefore, []byte(cp.insert), nil, 1)
		default:
			return errors.New("the cover manifest item is missing from the package document")
		}
	}
	if !bytes.Equal(o.opf[:od.metaStart], sBefore) || !bytes.Equal(o.opf[od.metaEnd:], sAfter) {
		return errors.New("package document changed outside <metadata>")
	}
	if !bytes.Equal(o.opf[od.metaStart:od.metaOpenEnd], s.opf[sd.metaStart:sd.metaOpenEnd]) {
		return errors.New("the metadata start tag changed")
	}
	om, sm := od.managed(ch), sd.managed(ch)
	var oRest, sRest []string
	for i, c := range od.children {
		if !om[i] {
			oRest = append(oRest, string(o.opf[c.start:c.end]))
		}
	}
	for i, c := range sd.children {
		if !sm[i] {
			sRest = append(sRest, string(s.opf[c.start:c.end]))
		}
	}
	if strings.Join(oRest, "\x00") != strings.Join(sRest, "\x00") {
		return errors.New("metadata that was not requested for change was altered (unknown metadata must be preserved)")
	}
	// The result must read back as requested, with everything else as before.
	want, err := ebookmeta.Read(orig, "epub")
	if err != nil {
		return err
	}
	got, err := ebookmeta.Read(staged, "epub")
	if err != nil {
		return fmt.Errorf("staged file does not read back: %w", err)
	}
	if ch.title != nil {
		want.Title = *ch.title
	}
	if ch.authors != nil {
		want.Authors = ch.authors
	}
	if ch.nameClear {
		want.Series, want.SeriesIndex = "", nil
	}
	if ch.nameSet {
		want.Series = ch.seriesNm
	}
	if ch.idxClear {
		want.SeriesIndex = nil
	}
	if ch.idxSet {
		v := ch.seriesIdx
		want.SeriesIndex = &v
	}
	if ch.publisher.touched() {
		want.Publisher = ch.publisher.val
	}
	if ch.published.touched() {
		want.Published = ch.published.val
	}
	if ch.desc.touched() {
		want.Description = ebookmeta.PlainText(ch.desc.val)
	}
	if ch.pagesSet {
		n := ch.pages
		want.PageCount = &n
	} else if ch.pagesClear {
		want.PageCount = nil
	}
	if (got.PageCount == nil) != (want.PageCount == nil) || (got.PageCount != nil && *got.PageCount != *want.PageCount) {
		return fmt.Errorf("staged page count does not read back as requested: got %v want %v", got.PageCount, want.PageCount)
	}
	if ch.isbn.set {
		want.Identifier = ch.isbn.val
	} else if ch.isbn.clear {
		want.Identifier = ""
	}
	if got.Publisher != want.Publisher || got.Published != want.Published || got.Description != want.Description {
		return fmt.Errorf("staged descriptive metadata does not read back as requested: got %+v want %+v", got, want)
	}
	if got.Title != want.Title || got.Language != want.Language || got.Identifier != want.Identifier || got.Series != want.Series ||
		strings.Join(got.Authors, "\x00") != strings.Join(want.Authors, "\x00") ||
		(got.SeriesIndex == nil) != (want.SeriesIndex == nil) || (got.SeriesIndex != nil && *got.SeriesIndex != *want.SeriesIndex) {
		return fmt.Errorf("staged metadata does not read back as requested: got %+v want %+v", got, want)
	}
	return nil
}

// coverMetaFor reports whether a metadata child is the <meta name="cover"> the writer adds for the given manifest id.
func coverMetaFor(ch child, id string) bool {
	n, _ := ch.attr("name")
	v, _ := ch.attr("content")
	return n == "cover" && v == id
}
