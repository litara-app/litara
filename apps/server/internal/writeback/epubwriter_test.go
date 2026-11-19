package writeback

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/deranjer/ebooker/apps/server/internal/ebookmeta"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

// These tests need no database: they build real EPUB archives and run the writer against them.

type entry struct {
	name   string
	data   []byte
	method uint16
}

func opfCalibre() string {
	return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Old Title</dc:title>
    <dc:creator opf:role="aut" opf:file-as="Writer, Old">Old Writer</dc:creator>
    <dc:creator opf:role="ill">An Illustrator</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="uid" opf:scheme="ISBN">9780306406157</dc:identifier>
    <dc:publisher>Keep Me Press</dc:publisher>
    <dc:subject>Unknown Subject One</dc:subject>
    <dc:subject>Subject Two</dc:subject>
    <dc:description>A &amp; B description with <![CDATA[ cdata ]]> kept.</dc:description>
    <meta name="cover" content="cover-image"/>
    <meta name="calibre:series" content="Old Series"/>
    <meta name="calibre:series_index" content="2"/>
    <meta name="calibre:custom" content="keep"/>
  </metadata>
  <manifest><item id="cover-image" href="img.png" media-type="image/png"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
  <guide><reference type="cover" href="c1.xhtml"/></guide>
</package>
`
}

func opfEPUB3() string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
	<dc:identifier id="id">urn:uuid:00000000-0000-4000-8000-0000000000c1</dc:identifier>
	<dc:title id="t1">Collection Book</dc:title>
	<meta refines="#t1" property="title-type">main</meta>
	<dc:creator id="a1">First Author</dc:creator>
	<meta refines="#a1" property="role" scheme="marc:relators">aut</meta>
	<dc:language>fr</dc:language>
	<meta property="belongs-to-collection" id="c01">Old Collection</meta>
	<meta refines="#c01" property="collection-type">series</meta>
	<meta refines="#c01" property="group-position">1</meta>
	<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/></spine>
</package>`
}

func opfPlain(title string) string {
	return `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">x</dc:identifier>` + title + `<dc:language>en</dc:language>
</metadata>
<manifest/><spine/>
</package>`
}

func build(t *testing.T, opf string, mutate func(*[]entry)) string {
	t.Helper()
	rng := rand.New(rand.NewSource(7))
	blob := make([]byte, 40_000)
	rng.Read(blob)
	entries := []entry{
		{"mimetype", []byte("application/epub+zip"), zip.Store},
		{"META-INF/container.xml", []byte(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`), zip.Deflate},
		{"OEBPS/content.opf", []byte(opf), zip.Deflate},
		{"OEBPS/nav.xhtml", []byte(`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>`), zip.Deflate},
		{"OEBPS/c1.xhtml", []byte(`<html xmlns="http://www.w3.org/1999/xhtml"><body><p>` + strings.Repeat("Lantern light. ", 400) + `</p></body></html>`), zip.Deflate},
		{"OEBPS/img.png", blob, zip.Store},
		{"OEBPS/font.otf", blob[:10_000], zip.Deflate},
	}
	if mutate != nil {
		mutate(&entries)
	}
	p := filepath.Join(t.TempDir(), "book.epub")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	zw.SetComment("original archive comment")
	for i, e := range entries {
		h := &zip.FileHeader{Name: e.name, Method: e.method, Modified: time.Date(2026, 1, 2, 3, 4, 5+i, 0, time.UTC)}
		w, err := zw.CreateHeader(h)
		if err != nil {
			t.Fatal(err)
		}
		w.Write(e.data)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	f.Close()
	return p
}

func fields(t *testing.T, kv map[string]any) metadata.Fields {
	t.Helper()
	out := metadata.Fields{}
	for k, v := range kv {
		b, _ := json.Marshal(v)
		out[k] = b
	}
	return out
}

func sum(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return fmt.Sprintf("%x", sha256.Sum256(b))
}

func writeAndValidate(t *testing.T, src string, ch metadata.Fields) string {
	t.Helper()
	before := sum(t, src)
	dst := filepath.Join(t.TempDir(), "staged.epub")
	w := EPUBWriter{}
	if err := w.Write(context.Background(), src, dst, ch); err != nil {
		t.Fatalf("write: %v", err)
	}
	if sum(t, src) != before {
		t.Fatal("the source file was modified")
	}
	if err := w.Validate(context.Background(), src, dst, ch); err != nil {
		t.Fatalf("validate: %v", err)
	}
	return dst
}

func readZip(t *testing.T, p string) map[string][]byte {
	t.Helper()
	zr, err := zip.OpenReader(p)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	out := map[string][]byte{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = b
	}
	return out
}

func TestEPUBWriterCalibreStyleKeepsEverythingElse(t *testing.T) {
	src := build(t, opfCalibre(), nil)
	dst := writeAndValidate(t, src, fields(t, map[string]any{
		"title": "New Title", "authors": []string{"New Writer", "Co Writer", "Third Author"}, "series_name": "New Series", "series_index": 3.5,
	}))
	got, err := ebookmeta.Read(dst, "epub")
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "New Title" || strings.Join(got.Authors, "|") != "New Writer|Co Writer|Third Author" || got.Series != "New Series" || got.SeriesIndex == nil || *got.SeriesIndex != 3.5 {
		t.Fatalf("read back: %+v", got)
	}
	if got.Language != "en" || got.Identifier != "9780306406157" {
		t.Fatalf("unrequested fields changed: %+v", got)
	}
	opf := string(readZip(t, dst)["OEBPS/content.opf"])
	for _, keep := range []string{"Keep Me Press", "Unknown Subject One", "Subject Two", `name="cover" content="cover-image"`, `name="calibre:custom" content="keep"`,
		"<![CDATA[ cdata ]]>", `<guide><reference type="cover" href="c1.xhtml"/></guide>`, `opf:scheme="ISBN"`} {
		if !strings.Contains(opf, keep) {
			t.Errorf("lost unrelated markup %q", keep)
		}
	}
	// The original archive properties and every other entry survive byte for byte (Validate checks raw bytes; spot-check here).
	o, n := readZip(t, src), readZip(t, dst)
	for name, b := range o {
		if name != "OEBPS/content.opf" && !bytes.Equal(b, n[name]) {
			t.Errorf("entry %s differs", name)
		}
	}
	zr, _ := zip.OpenReader(dst)
	defer zr.Close()
	if zr.File[0].Name != "mimetype" || zr.File[0].Method != zip.Store || zr.Comment != "original archive comment" {
		t.Errorf("archive structure changed: %q %d %q", zr.File[0].Name, zr.File[0].Method, zr.Comment)
	}
	if len(zr.File[0].Extra) != 0 && zr.File[0].Modified.Second() != 5 {
		t.Errorf("mimetype header changed")
	}
}

func TestEPUBWriterEPUB3CollectionAndRefinements(t *testing.T) {
	src := build(t, opfEPUB3(), nil)
	dst := writeAndValidate(t, src, fields(t, map[string]any{"title": "Renamed", "series_name": "New Collection", "series_index": 2}))
	got, _ := ebookmeta.Read(dst, "epub")
	if got.Title != "Renamed" || got.Series != "New Collection" || got.SeriesIndex == nil || *got.SeriesIndex != 2 || got.Language != "fr" {
		t.Fatalf("%+v", got)
	}
	opf := string(readZip(t, dst)["OEBPS/content.opf"])
	for _, keep := range []string{`id="t1"`, `property="title-type"`, `property="role"`, `dcterms:modified`, `property="collection-type"`} {
		if !strings.Contains(opf, keep) {
			t.Errorf("lost %q", keep)
		}
	}
	// Dropping the index removes the group-position refinement rather than leaving a stale one.
	dst2 := writeAndValidate(t, src, fields(t, map[string]any{"series_name": "Only Name", "series_index": nil}))
	if strings.Contains(string(readZip(t, dst2)["OEBPS/content.opf"]), "group-position") {
		t.Error("stale group-position kept")
	}
}

func TestEPUBWriterInsertsAndClearsSeries(t *testing.T) {
	src := build(t, opfPlain(`<dc:title>T</dc:title>`), nil)
	dst := writeAndValidate(t, src, fields(t, map[string]any{"series_name": "Fresh", "series_index": 1}))
	got, _ := ebookmeta.Read(dst, "epub")
	if got.Series != "Fresh" || got.SeriesIndex == nil || *got.SeriesIndex != 1 || got.Title != "T" {
		t.Fatalf("%+v", got)
	}
	cleared := writeAndValidate(t, dst, fields(t, map[string]any{"series_name": nil}))
	got, _ = ebookmeta.Read(cleared, "epub")
	if got.Series != "" || got.SeriesIndex != nil {
		t.Fatalf("series not cleared: %+v", got)
	}
}

func TestEPUBWriterSelfClosingTitleAndEscaping(t *testing.T) {
	src := build(t, opfPlain(`<dc:title id="x"/>`), nil)
	title := `Tom & Jerry <3 "quotes" & 'apos' ünïcode 🚀`
	dst := writeAndValidate(t, src, fields(t, map[string]any{"title": title, "authors": []string{`A & B <c>`}}))
	got, _ := ebookmeta.Read(dst, "epub")
	if got.Title != title || got.Authors[0] != `A & B <c>` {
		t.Fatalf("%+v", got)
	}
	if !strings.Contains(string(readZip(t, dst)["OEBPS/content.opf"]), `id="x"`) {
		t.Error("title attributes lost")
	}
}

func TestEPUBWriterIsIdempotent(t *testing.T) {
	src := build(t, opfCalibre(), nil)
	ch := fields(t, map[string]any{"title": "Same", "authors": []string{"One"}, "series_name": "S", "series_index": 4})
	a := writeAndValidate(t, src, ch)
	b := writeAndValidate(t, a, ch)
	ao, bo := readZip(t, a)["OEBPS/content.opf"], readZip(t, b)["OEBPS/content.opf"]
	if !bytes.Equal(ao, bo) {
		t.Errorf("applying the same change twice altered the package document:\n%s\n---\n%s", ao, bo)
	}
}

func TestEPUBWriterRefusesWhatItCannotDoWithoutDroppingIt(t *testing.T) {
	withSeries := build(t, opfCalibre(), nil)
	noSeries := build(t, opfPlain(`<dc:title>T</dc:title>`), nil)
	w := EPUBWriter{}
	for name, tc := range map[string]struct {
		src string
		ch  metadata.Fields
	}{
		"narrators":              {withSeries, fields(t, map[string]any{"narrators": []string{"N"}})},
		"empty authors":          {withSeries, fields(t, map[string]any{"authors": []string{}})},
		"blank title":            {withSeries, fields(t, map[string]any{"title": "  "})},
		"empty":                  {withSeries, metadata.Fields{}},
		"series name typo":       {withSeries, fields(t, map[string]any{"series_name": 5})},
		"old series object key":  {withSeries, fields(t, map[string]any{"series": map[string]any{"name": "x"}})},
		"negative index":         {withSeries, fields(t, map[string]any{"series_index": -1})},
		"index without a series": {noSeries, fields(t, map[string]any{"series_index": 2})},
	} {
		dst := filepath.Join(t.TempDir(), "x.epub")
		if err := w.Write(context.Background(), tc.src, dst, tc.ch); err == nil {
			t.Errorf("%s: expected a refusal", name)
		}
		if _, err := os.Stat(dst); err == nil {
			t.Errorf("%s: a refused write left a file behind", name)
		}
	}
}

func TestEPUBWriterRejectsMalformedInputs(t *testing.T) {
	ch := fields(t, map[string]any{"title": "X"})
	w := EPUBWriter{}
	try := func(name, src string) {
		t.Helper()
		dst := filepath.Join(t.TempDir(), "out.epub")
		if err := w.Write(context.Background(), src, dst, ch); err == nil {
			t.Errorf("%s: expected an error", name)
		}
		if _, err := os.Stat(dst); err == nil {
			t.Errorf("%s: a failed write left a file", name)
		}
	}
	notZip := filepath.Join(t.TempDir(), "n.epub")
	os.WriteFile(notZip, []byte("not a zip at all"), 0o600)
	try("not a zip", notZip)
	try("no container", build(t, opfCalibre(), func(e *[]entry) { *e = append((*e)[:1], (*e)[2:]...) }))
	try("rootfile traversal", build(t, opfCalibre(), func(e *[]entry) {
		(*e)[1].data = []byte(`<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="../evil.opf"/></rootfiles></container>`)
	}))
	try("invalid xml", build(t, `<package><metadata><dc:title>oops</metadata></package>`, nil))
	try("declared non-utf8 encoding", build(t, `<?xml version="1.0" encoding="ISO-8859-1"?>`+opfPlain(`<dc:title>x</dc:title>`), nil))
	try("no metadata element", build(t, `<package xmlns="http://www.idpf.org/2007/opf"><manifest/></package>`, nil))
	try("no dc namespace", build(t, `<package xmlns="http://www.idpf.org/2007/opf"><metadata><title>x</title></metadata></package>`, nil))
	try("oversized package document", build(t, opfPlain(`<dc:title>`+strings.Repeat("x", 1<<20)+`</dc:title>`), nil))
	try("duplicate entries", build(t, opfCalibre(), func(e *[]entry) { *e = append(*e, (*e)[3]) }))
	try("nested markup in title", build(t, opfPlain(`<dc:title>a<b>b</b></dc:title>`), nil))
}

func TestEPUBValidateCatchesTampering(t *testing.T) {
	src := build(t, opfCalibre(), nil)
	ch := fields(t, map[string]any{"title": "Valid"})
	good := writeAndValidate(t, src, ch)
	w := EPUBWriter{}

	// 1. Content of another entry changed.
	bad := rewrite(t, good, func(name string, b []byte) []byte {
		if name == "OEBPS/c1.xhtml" {
			return append(b, ' ')
		}
		return b
	})
	if err := w.Validate(context.Background(), src, bad, ch); err == nil {
		t.Error("changed chapter was not detected")
	}
	// 2. Unknown metadata dropped while editing the title.
	bad = rewrite(t, good, func(name string, b []byte) []byte {
		if name == "OEBPS/content.opf" {
			return []byte(strings.Replace(string(b), "<dc:publisher>Keep Me Press</dc:publisher>", "", 1))
		}
		return b
	})
	if err := w.Validate(context.Background(), src, bad, ch); err == nil {
		t.Error("dropped publisher was not detected")
	}
	// 3. Something outside <metadata> altered.
	bad = rewrite(t, good, func(name string, b []byte) []byte {
		if name == "OEBPS/content.opf" {
			return []byte(strings.Replace(string(b), `<spine>`, `<spine toc="x">`, 1))
		}
		return b
	})
	if err := w.Validate(context.Background(), src, bad, ch); err == nil {
		t.Error("an edit outside metadata was not detected")
	}
	// 4. The requested change is missing.
	if err := w.Validate(context.Background(), src, src, ch); err == nil {
		t.Error("a staged file without the change was accepted")
	}
	// 5. A different change than requested.
	if err := w.Validate(context.Background(), src, good, fields(t, map[string]any{"title": "Other"})); err == nil {
		t.Error("a staged file with a different change was accepted")
	}
}

// rewrite re-creates an archive, letting the callback alter entries (used to build tampered staged files).
func rewrite(t *testing.T, src string, f func(name string, b []byte) []byte) string {
	t.Helper()
	zr, err := zip.OpenReader(src)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	dst := filepath.Join(t.TempDir(), "tampered.epub")
	out, _ := os.Create(dst)
	zw := zip.NewWriter(out)
	zw.SetComment(zr.Comment)
	for _, e := range zr.File {
		rc, _ := e.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		h := e.FileHeader
		h.CRC32, h.CompressedSize64, h.UncompressedSize64, h.Extra = 0, 0, 0, nil
		w, err := zw.CreateHeader(&h)
		if err != nil {
			t.Fatal(err)
		}
		w.Write(f(e.Name, b))
	}
	zw.Close()
	out.Close()
	return dst
}

func TestEPUBWriterSeriesNameAndIndexAreIndependent(t *testing.T) {
	src := build(t, opfCalibre(), nil) // series "Old Series", index 2
	nameOnly := writeAndValidate(t, src, fields(t, map[string]any{"series_name": "Renamed Series"}))
	got, _ := ebookmeta.Read(nameOnly, "epub")
	if got.Series != "Renamed Series" || got.SeriesIndex == nil || *got.SeriesIndex != 2 {
		t.Fatalf("changing only the name must keep the index: %+v", got)
	}
	idxOnly := writeAndValidate(t, src, fields(t, map[string]any{"series_index": 9}))
	got, _ = ebookmeta.Read(idxOnly, "epub")
	if got.Series != "Old Series" || got.SeriesIndex == nil || *got.SeriesIndex != 9 {
		t.Fatalf("changing only the index must keep the name: %+v", got)
	}
	cleared := writeAndValidate(t, src, fields(t, map[string]any{"series_index": nil}))
	got, _ = ebookmeta.Read(cleared, "epub")
	if got.Series != "Old Series" || got.SeriesIndex != nil {
		t.Fatalf("clearing the index must keep the name: %+v", got)
	}
	gone := writeAndValidate(t, src, fields(t, map[string]any{"series_name": nil}))
	got, _ = ebookmeta.Read(gone, "epub")
	if got.Series != "" || got.SeriesIndex != nil {
		t.Fatalf("clearing the name removes the series and its index: %+v", got)
	}
}
