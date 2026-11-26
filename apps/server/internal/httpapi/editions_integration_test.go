package httpapi_test

import (
	"archive/zip"
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func writeZip(t *testing.T, p string, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func epub(t *testing.T, p, title, author, isbn string) []byte {
	return writeZip(t, p, map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
		"OPS/package.opf": `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata>` +
			`<dc:title>` + title + `</dc:title><dc:creator>` + author + `</dc:creator><dc:language>en</dc:language>` +
			`<dc:identifier>urn:isbn:` + isbn + `</dc:identifier>` +
			`<meta name="calibre:series" content="Saga"/><meta name="calibre:series_index" content="2"/></metadata></package>`,
		"OPS/chapter.xhtml": "<html><body>x</body></html>",
	})
}

// api strips the /api/v1 prefix that Env.Do adds itself.
func api(p string) string { return strings.TrimPrefix(p, "/api/v1") }

func scanTwice(t *testing.T, e *apitest.Env, admin, lib string) {
	t.Helper()
	for i := 0; i < 2; i++ {
		if r := e.Do("POST", "/admin/libraries/"+lib+"/scans", admin, map[string]any{}); r.StatusCode != http.StatusAccepted {
			t.Fatalf("scan: %d %s", r.StatusCode, r.Body)
		}
		e.RunQueued()
		e.Clock.Advance(time.Minute)
	}
}

// Ebook-only libraries get editions and titles without any recording, are
// visible only through grants, and stream through the existing file endpoint.
func TestEbookEditionsEndToEnd(t *testing.T) {
	e := apitest.New(t)
	// The library root lives under the server media root, which bounds served files.
	root, _ := filepath.Abs(filepath.Join(e.Cfg.MediaRoot, "ebooks"))
	_ = os.MkdirAll(root, 0o755)
	admin := e.Login(seed.AdminName, "cli").AccessToken
	userB := e.Login(seed.UserBName, "tablet").AccessToken
	d := setupLibrary(t, e, admin, root)
	lib := d.Library.ID
	if r := e.Do("PUT", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+lib, admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d %s", r.StatusCode, r.Body)
	}
	userA := e.Login(seed.UserAName, "phone").AccessToken

	book := epub(t, filepath.Join(root, "Saga", "vol2.epub"), "Second Volume", "Ada Author", "978-1-4028-9462-6")
	writeZip(t, filepath.Join(root, "Comics", "issue.cbz"), map[string]string{"ComicInfo.xml": `<ComicInfo><Title>Issue One</Title><Series>Strip</Series><Number>1</Number><Writer>Bo, Cy</Writer><LanguageISO>fr</LanguageISO></ComicInfo>`, "1.png": "x"})
	_ = os.WriteFile(filepath.Join(root, "plain.pdf"), []byte("%PDF-1.4 minimal"), 0o644)
	scanTwice(t, e, admin, lib)

	// Editions: one per file; metadata read from the container, file name otherwise.
	var eds wire.Editions
	e.Do("GET", "/editions?libraryId="+lib, userA, nil).JSON(t, &eds)
	if eds.Total != 3 || len(eds.Items) != 3 {
		t.Fatalf("editions: %+v", eds)
	}
	byFormat := map[string]wire.Edition{}
	for _, ed := range eds.Items {
		byFormat[ed.File.Format] = ed
	}
	ep := byFormat["epub"]
	if ep.Capabilities.Read.State != "supported" || ep.Readiness != "ready" || ep.Language == nil || *ep.Language != "en" {
		t.Fatalf("epub edition: %+v", ep)
	}
	if ep.Completion.Revision != "0" || ep.File.ContentPath == nil || !strings.HasPrefix(*ep.File.ContentPath, "/api/v1/files/") {
		t.Fatalf("epub file: %+v", ep.File)
	}
	if byFormat["cbz"].Capabilities.TextSelection.State != "unsupported" || *byFormat["cbz"].Language != "fr" {
		t.Fatalf("cbz: %+v", byFormat["cbz"])
	}

	// Titles come from metadata; no recording is faked for any of them.
	var titles wire.Titles
	e.Do("GET", "/titles?q=SECOND", userA, nil).JSON(t, &titles)
	if titles.Total != 1 || titles.Items[0].Title != "Second Volume" || titles.Items[0].Authors[0] != "Ada Author" ||
		titles.Items[0].Series[0] != "Saga" || titles.Items[0].EditionCount != 1 || titles.Items[0].RecordingCount != 0 {
		t.Fatalf("titles: %+v", titles)
	}
	var detail wire.TitleDetail
	if r := e.Do("GET", "/titles/"+ep.TitleID, userA, nil); r.StatusCode != 200 {
		t.Fatalf("title: %d %s", r.StatusCode, r.Body)
	} else {
		r.JSON(t, &detail)
	}
	var recs wire.RecordingLinks
	e.Do("GET", "/titles/"+ep.TitleID+"/recordings", userA, nil).JSON(t, &recs)
	if recs.Total != 0 {
		t.Fatalf("faked recordings: %+v", recs)
	}

	// Reader snapshot carries the pinned engine profile and no credentials.
	var rd wire.ReaderSnapshot
	e.Do("GET", "/editions/"+ep.ID+"/reader", userA, nil).JSON(t, &rd)
	if rd.SchemaVersion != 1 || rd.Engine != "foliate" || !strings.HasPrefix(rd.EngineProfile, "foliate-js@") || rd.Position.Revision != "0" {
		t.Fatalf("reader: %+v", rd)
	}

	// Authorization: ungranted user B sees none of it; ids are denied, lists are empty.
	var empty wire.Editions
	e.Do("GET", "/editions", userB, nil).JSON(t, &empty)
	for _, ed := range empty.Items {
		if ed.LibraryID == lib {
			t.Fatalf("leaked edition to ungranted user")
		}
	}
	if r := e.Do("GET", "/editions/"+ep.ID, userB, nil); r.StatusCode != 403 || r.Code() != "library_access_denied" {
		t.Fatalf("ungranted edition: %d %s", r.StatusCode, r.Body)
	}
	if r := e.Do("GET", "/titles/"+ep.TitleID, userB, nil); r.StatusCode != 403 {
		t.Fatalf("ungranted title: %d %s", r.StatusCode, r.Body)
	}
	if r := e.Do("GET", "/titles/00000000-0000-4000-8000-000000000001", userA, nil); r.StatusCode != 404 {
		t.Fatalf("unknown title: %d", r.StatusCode)
	}
	if r := e.Do("GET", "/editions/reader", userA, nil); r.StatusCode == 200 {
		t.Fatalf("bad id accepted")
	}

	// Original bytes via the existing endpoint: granted user streams, others do not.
	got := e.Do("GET", api(*ep.File.ContentPath), userA, nil)
	if got.StatusCode != 200 || !bytes.Equal(got.Body, book) {
		t.Fatalf("content: %d len=%d want %d", got.StatusCode, len(got.Body), len(book))
	}
	rng := e.Do("GET", api(*ep.File.ContentPath), userA, nil, "Range", "bytes=0-3")
	if rng.StatusCode != 206 || !bytes.Equal(rng.Body, book[:4]) {
		t.Fatalf("range: %d %q", rng.StatusCode, rng.Body)
	}
	if r := e.Do("GET", api(*ep.File.ContentPath), userB, nil); r.StatusCode != 403 {
		t.Fatalf("ungranted content: %d", r.StatusCode)
	}
	stale := strings.Replace(api(*ep.File.ContentPath), ep.File.ContentVersion, "00000000-0000-4000-8000-000000000002", 1)
	if r := e.Do("GET", stale, userA, nil); r.StatusCode != 404 {
		t.Fatalf("unknown version: %d", r.StatusCode)
	}

	// Same-path replacement keeps the edition and file identity; the old version
	// is refused with 412 content_changed and the edition exposes the new one.
	time.Sleep(10 * time.Millisecond)
	epub(t, filepath.Join(root, "Saga", "vol2.epub"), "Second Volume", "Ada Author", "978-1-4028-9462-6-changed-bytes"[:17])
	_ = os.WriteFile(filepath.Join(root, "Saga", "vol2.epub"), append(book, []byte("PADDING")...), 0o644)
	scanTwice(t, e, admin, lib)
	scanTwice(t, e, admin, lib)
	var after wire.Edition
	e.Do("GET", "/editions/"+ep.ID, userA, nil).JSON(t, &after)
	if after.ID != ep.ID || after.File.ID != ep.File.ID || after.File.ContentVersion == ep.File.ContentVersion {
		t.Fatalf("replacement identity: before %+v after %+v", ep.File, after.File)
	}
	if r := e.Do("GET", api(*ep.File.ContentPath), userA, nil); r.StatusCode != 412 || r.Code() != "content_changed" {
		t.Fatalf("old version: %d %s", r.StatusCode, r.Body)
	}
	if r := e.Do("GET", api(*after.File.ContentPath), userA, nil); r.StatusCode != 200 {
		t.Fatalf("new version: %d", r.StatusCode)
	}
}
