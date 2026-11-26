package httpapi_test

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func solidPNG(w, h int, c color.NRGBA) []byte {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

// ADR-0086: choosing, fetching, extracting and serving covers, and who may do what.
func TestTitleCovers(t *testing.T) {
	o := newOPDSEnv(t)
	e := o.e
	// An EPUB with a real cover image, scanned into its own title. The administrator is granted the library too, because
	// changing a cover needs an administrator who can see the title.
	red := solidPNG(60, 90, color.NRGBA{R: 200, G: 20, B: 20, A: 255})
	writeZip(t, filepath.Join(o.root, "Covered", "covered.epub"), map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
		"OPS/package.opf": `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Covered Book</dc:title><dc:creator>Cora Cover</dc:creator><dc:language>en</dc:language>` +
			`<dc:identifier>urn:isbn:978-0-306-40615-7</dc:identifier><meta name="cover" content="c"/></metadata><manifest><item id="c" href="cover.png" media-type="image/png"/></manifest></package>`,
		"OPS/cover.png":     string(red),
		"OPS/chapter.xhtml": "<html><body>x</body></html>",
	})
	scanTwice(t, e, o.admin, o.lib)
	if r := e.Do("PUT", "/admin/users/"+e.Fix.AdminID.String()+"/libraries/"+o.lib, o.admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("grant admin: %d %s", r.StatusCode, r.Body)
	}
	find := func(q string) string {
		var l wire.TitleRows
		e.Do("GET", "/titles?libraryId="+o.lib+"&q="+q, o.userA, nil).JSON(t, &l)
		if len(l.Items) != 1 {
			t.Fatalf("%s: %+v", q, l)
		}
		return l.Items[0].ID
	}
	covered, plain := find("covered"), find("zebra")
	cover := func(token, id, medium string, hdr ...string) apitest.Response {
		return e.Do("GET", "/titles/"+id+"/cover?medium="+medium, token, nil, hdr...)
	}

	// The cover inside the file is extracted on first use and served as a bounded JPEG with an ETag; a title without one is a 404.
	r := cover(o.userA, covered, "ebook")
	if r.StatusCode != http.StatusOK || !strings.HasPrefix(r.Header.Get("Content-Type"), "image/jpeg") || r.Header.Get("ETag") == "" {
		t.Fatalf("extracted cover: %d %s %v", r.StatusCode, r.Body, r.Header)
	}
	if _, err := jpeg.Decode(bytes.NewReader(r.Body)); err != nil {
		t.Fatalf("not a jpeg: %v", err)
	}
	etag := r.Header.Get("ETag")
	if again := cover(o.userA, covered, "ebook", "If-None-Match", etag); again.StatusCode != http.StatusNotModified {
		t.Fatalf("revalidation: %d", again.StatusCode)
	}
	if r := cover(o.userA, plain, "ebook"); r.StatusCode != http.StatusNotFound {
		t.Fatalf("a title with no cover: %d", r.StatusCode)
	}
	// Access follows the library grants: user B has none.
	if r := cover(o.userB, covered, "ebook"); r.StatusCode != http.StatusForbidden {
		t.Fatalf("no access: %d", r.StatusCode)
	}
	if r := cover("", covered, "ebook"); r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d", r.StatusCode)
	}

	// Only an administrator changes covers; a member is refused for every route, and nothing changes.
	upload := func(token, id, medium string, body []byte) apitest.Response {
		return e.Do("PUT", "/titles/"+id+"/cover?medium="+medium, token, body, "Content-Type", "image/png")
	}
	green := solidPNG(50, 80, color.NRGBA{R: 10, G: 200, B: 10, A: 255})
	if r := upload(o.userA, covered, "ebook", green); r.StatusCode != http.StatusForbidden {
		t.Fatalf("member upload: %d", r.StatusCode)
	}
	if r := e.Do("POST", "/titles/"+covered+"/cover/regenerate", o.userA, map[string]any{"medium": "ebook"}); r.StatusCode != http.StatusForbidden {
		t.Fatalf("member regenerate: %d", r.StatusCode)
	}
	if r := cover(o.userA, covered, "ebook"); r.Header.Get("ETag") != etag {
		t.Fatal("a refused request changed the cover")
	}

	if r := e.Do("GET", "/titles/"+covered, o.admin, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("admin cannot see the title: %d %s", r.StatusCode, r.Body)
	}
	if r := e.Do("GET", "/titles/"+covered+"/covers", o.admin, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("admin covers info: %d %s", r.StatusCode, r.Body)
	}
	// Upload replaces the cover and bumps the version; hostile uploads are refused and change nothing.
	if r := upload(o.admin, covered, "ebook", green); r.StatusCode != http.StatusOK {
		t.Fatalf("upload: %d %s", r.StatusCode, r.Body)
	}
	after := cover(o.userA, covered, "ebook")
	if after.Header.Get("ETag") == etag || bytes.Equal(after.Body, r.Body) {
		t.Fatal("the uploaded cover did not replace the extracted one")
	}
	for name, body := range map[string][]byte{"svg": []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>`), "html": []byte("<html>"), "text": []byte("hello")} {
		if r := upload(o.admin, covered, "ebook", body); r.StatusCode != http.StatusUnprocessableEntity && r.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s upload: %d", name, r.StatusCode)
		}
	}
	if r := cover(o.userA, covered, "ebook"); r.Header.Get("ETag") != after.Header.Get("ETag") {
		t.Fatal("a refused upload changed the cover")
	}

	// Regenerate returns to the cover inside the file.
	if r := e.Do("POST", "/titles/"+covered+"/cover/regenerate", o.admin, map[string]any{"medium": "ebook"}); r.StatusCode != http.StatusOK {
		t.Fatalf("regenerate: %d %s", r.StatusCode, r.Body)
	}
	var slots wire.TitleCovers
	e.Do("GET", "/titles/"+covered+"/covers", o.admin, nil).JSON(t, &slots)
	if slots.Ebook.Source != "extracted" || slots.Audio.Source != "none" {
		t.Fatalf("slots: %+v", slots)
	}

	// Fetch by URL: the test server is on loopback, which test mode allows; production mode refuses it (see the covers package tests).
	img := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(green) }))
	defer img.Close()
	if r := e.Do("POST", "/titles/"+covered+"/cover/from-url", o.admin, map[string]any{"medium": "ebook", "url": img.URL}); r.StatusCode != http.StatusOK {
		t.Fatalf("from url: %d %s", r.StatusCode, r.Body)
	}
	for _, bad := range []string{"file:///etc/passwd", "ftp://example.com/a.png", "not a url at all"} {
		if r := e.Do("POST", "/titles/"+covered+"/cover/from-url", o.admin, map[string]any{"medium": "ebook", "url": bad}); r.StatusCode != http.StatusUnprocessableEntity && r.StatusCode != http.StatusBadRequest {
			t.Fatalf("%q: %d", bad, r.StatusCode)
		}
	}

	// Writing the cover into the file goes through the reviewed plan; the EPUB writer is off until evidence is recorded.
	var eds wire.Editions
	e.Do("GET", "/editions?titleId="+covered, o.admin, nil).JSON(t, &eds)
	if len(eds.Items) != 1 {
		t.Fatalf("editions: %+v", eds)
	}
	fileID := eds.Items[0].File.ID
	if r := e.Do("POST", "/admin/files/"+fileID+"/cover-writebacks", o.userA, map[string]any{"medium": "ebook"}); r.StatusCode != http.StatusForbidden {
		t.Fatalf("member cover write plan: %d", r.StatusCode)
	}
	if r := e.Do("POST", "/admin/files/"+fileID+"/cover-writebacks", o.admin, map[string]any{"medium": "ebook"}); r.StatusCode != http.StatusConflict || !strings.Contains(string(r.Body), "writer_disabled") {
		t.Fatalf("writer off: %d %s", r.StatusCode, r.Body)
	}
	if r := e.Do("POST", "/admin/files/"+fileID+"/cover-writebacks", o.admin, map[string]any{"medium": "audio"}); r.StatusCode != http.StatusConflict {
		t.Fatalf("audio: %d %s", r.StatusCode, r.Body)
	}

	// Online search is off until an administrator turns it on, and only an administrator can.
	if r := e.Do("GET", "/titles/"+covered+"/cover-search?medium=ebook", o.admin, nil); r.StatusCode != http.StatusConflict {
		t.Fatalf("search while off: %d %s", r.StatusCode, r.Body)
	}
	if r := e.Do("PUT", "/admin/cover-settings", o.userA, map[string]any{"searchEnabled": true}); r.StatusCode != http.StatusForbidden {
		t.Fatalf("member enabled search: %d", r.StatusCode)
	}
	if r := e.Do("PUT", "/admin/cover-settings", o.admin, map[string]any{"searchEnabled": true}); r.StatusCode != http.StatusOK {
		t.Fatalf("enable search: %d %s", r.StatusCode, r.Body)
	}
	sites := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/search.json") {
			_, _ = w.Write([]byte(`{"docs":[{"title":"Covered Book","author_name":["Cora Cover"],"cover_i":7}]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer sites.Close()
	s := e.Covers.Searcher()
	s.OpenLibrary, s.OLCovers, s.ITunes = sites.URL, sites.URL, sites.URL
	var res wire.CoverSearchResults
	rr := e.Do("GET", "/titles/"+covered+"/cover-search?medium=ebook", o.admin, nil)
	if rr.StatusCode != http.StatusOK {
		t.Fatalf("search: %d %s", rr.StatusCode, rr.Body)
	}
	rr.JSON(t, &res)
	if len(res.Items) != 1 || res.Items[0].Provider != "Open Library" {
		t.Fatalf("results: %+v", res)
	}
	if r := e.Do("GET", "/titles/"+covered+"/cover-search?medium=ebook", o.userA, nil); r.StatusCode != http.StatusForbidden {
		t.Fatalf("member search: %d", r.StatusCode)
	}
	// Previews are fetched by the server; a member cannot use them, and a non-image is refused.
	if r := e.Do("GET", "/titles/"+covered+"/cover-preview?url="+img.URL, o.admin, nil); r.StatusCode != http.StatusOK || !strings.HasPrefix(r.Header.Get("Content-Type"), "image/jpeg") {
		t.Fatalf("preview: %d", r.StatusCode)
	}
	if r := e.Do("GET", "/titles/"+covered+"/cover-preview?url="+img.URL, o.userA, nil); r.StatusCode != http.StatusForbidden {
		t.Fatalf("member preview: %d", r.StatusCode)
	}
	if r := e.Do("GET", "/titles/"+covered+"/cover-preview?url=file:///etc/passwd", o.admin, nil); r.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("file preview: %d", r.StatusCode)
	}
}
