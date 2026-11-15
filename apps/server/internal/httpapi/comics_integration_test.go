package httpapi_test

import (
	"bytes"
	"image"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/comics"
	"github.com/deranjer/ebooker/apps/server/internal/comics/archivetest"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func pngPage(w, h int) string {
	var b bytes.Buffer
	_ = png.Encode(&b, image.NewGray(image.Rect(0, 0, w, h)))
	return b.String()
}

type comicEnv struct {
	e                   *apitest.Env
	admin, userA, userB string
	lib, root           string
}

func newComicEnv(t *testing.T, opts apitest.Options) *comicEnv {
	t.Helper()
	e := apitest.New(t, opts)
	root, _ := filepath.Abs(filepath.Join(e.Cfg.MediaRoot, "comics"))
	_ = os.MkdirAll(root, 0o755)
	admin := e.Login(seed.AdminName, "cli").AccessToken
	d := setupLibrary(t, e, admin, root)
	if r := e.Do("PUT", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+d.Library.ID, admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d %s", r.StatusCode, r.Body)
	}
	return &comicEnv{e: e, admin: admin, userA: e.Login(seed.UserAName, "phone").AccessToken, userB: e.Login(seed.UserBName, "tablet").AccessToken, lib: d.Library.ID, root: root}
}

// edition returns the single edition whose file name matches, after a scan.
func (c *comicEnv) edition(t *testing.T, label string) wire.T005Edition {
	t.Helper()
	var eds wire.T005Editions
	c.e.Do("GET", "/editions?libraryId="+c.lib+"&size=200", c.userA, nil).JSON(t, &eds)
	for _, x := range eds.Items {
		if x.Label == label {
			return x
		}
	}
	t.Fatalf("no edition labelled %q in %+v", label, eds)
	return wire.T005Edition{}
}

func pagesPath(e wire.T005Edition) string {
	return "/files/" + e.File.ID + "/versions/" + e.File.ContentVersion + "/pages"
}

func extraction(version string) map[string]any {
	return map[string]any{"operationId": uuid.NewString(), "baseRevision": "0", "contentVersion": version}
}

func TestComicPagesExtractionServingAndFailures(t *testing.T) {
	c := newComicEnv(t, apitest.Options{})
	e := c.e
	cbz := filepath.Join(c.root, "Hero", "issue1.cbz")
	zipBytes := writeZip(t, cbz, map[string]string{
		"ComicInfo.xml": "<ComicInfo/>",
		"p/10.png":      pngPage(10, 10), "p/2.png": pngPage(20, 20), "p/1.png": pngPage(30, 30),
	})
	bad := filepath.Join(c.root, "Hero", "evil.cbz")
	writeZip(t, bad, map[string]string{"../escape.png": pngPage(2, 2), "1.png": pngPage(2, 2)})
	// Real RAR5 and 7z archives (written by archivetest), and a damaged RAR that must fail visibly.
	cbr := filepath.Join(c.root, "Hero", "issue2.cbr")
	if err := archivetest.WriteRAR5(cbr, []archivetest.RarEntry{{Name: "p/2.png", Data: []byte(pngPage(20, 20))}, {Name: "p/1.png", Data: []byte(pngPage(30, 30))}}); err != nil {
		t.Fatal(err)
	}
	cb7 := filepath.Join(c.root, "Hero", "issue3.cb7")
	if err := archivetest.WriteSevenZip(cb7, []archivetest.SevenEntry{{Name: "p/10.png", Data: []byte(pngPage(10, 10))}, {Name: "p/2.png", Data: []byte(pngPage(20, 20))}}, archivetest.SevenOpts{EncodeHeader: true}); err != nil {
		t.Fatal(err)
	}
	broken := filepath.Join(c.root, "Hero", "issue4.cbr")
	if err := os.WriteFile(broken, []byte("Rar!\x1a\x07\x01\x00 this is not a real archive"), 0o644); err != nil {
		t.Fatal(err)
	}
	scanTwice(t, e, c.admin, c.lib)
	byFile := func(path string) wire.T005Edition {
		t.Helper()
		st, _ := os.Stat(path)
		var all wire.T005Editions
		e.Do("GET", "/editions?libraryId="+c.lib+"&size=200", c.userA, nil).JSON(t, &all)
		for _, x := range all.Items {
			if x.File.SizeBytes != nil && *x.File.SizeBytes == st.Size() && x.File.Format == filepath.Ext(path)[1:] {
				return x
			}
		}
		t.Fatalf("no edition for %s", path)
		return wire.T005Edition{}
	}
	good, evil, rar, sevenEd, brokenEd := c.edition(t, "CBZ"), c.edition(t, "CBZ"), byFile(cbr), byFile(cb7), byFile(broken)
	var eds wire.T005Editions
	e.Do("GET", "/editions?libraryId="+c.lib, c.userA, nil).JSON(t, &eds)
	for _, x := range eds.Items {
		if x.File.Format != "cbz" {
			continue
		}
		raw, _ := os.ReadFile(cbz)
		if x.File.SizeBytes != nil && *x.File.SizeBytes == int64(len(raw)) {
			good = x
		} else {
			evil = x
		}
	}

	// Nothing starts a job but POST; GET is read-only.
	if x := e.Do("GET", pagesPath(good), c.userA, nil); x.StatusCode != 404 || x.Code() != "pages_not_prepared" {
		t.Fatalf("manifest before prepare: %d %s", x.StatusCode, x.Body)
	}
	if x := e.Do("GET", pagesPath(good)+"/0", c.userA, nil); x.StatusCode != 404 {
		t.Fatalf("page before prepare: %d", x.StatusCode)
	}
	// Authorization and body checks come first.
	if x := e.Do("POST", pagesPath(good), c.userB, extraction(good.File.ContentVersion)); x.StatusCode != 403 {
		t.Fatalf("ungranted user: %d %s", x.StatusCode, x.Body)
	}
	unknownVersion := uuid.NewString()
	if x := e.Do("POST", "/files/"+uuid.NewString()+"/versions/"+unknownVersion+"/pages", c.userA, extraction(unknownVersion)); x.StatusCode != 404 {
		t.Fatalf("unknown file: %d", x.StatusCode)
	}
	if x := e.Do("POST", pagesPath(good), c.userA, extraction(uuid.NewString())); x.StatusCode != 422 {
		t.Fatalf("mismatched body version: %d %s", x.StatusCode, x.Body)
	}
	if len(e.Queue.Extracts) != 0 {
		t.Fatal("a refused request enqueued work")
	}

	body := extraction(good.File.ContentVersion)
	first := e.Do("POST", pagesPath(good), c.userA, body)
	var m wire.T005PageManifest
	first.JSON(t, &m)
	if first.StatusCode != 202 || m.State != "processing" || len(m.Pages) != 0 {
		t.Fatalf("prepare: %d %s", first.StatusCode, first.Body)
	}
	if again := e.Do("POST", pagesPath(good), c.userA, body); string(again.Body) != string(first.Body) {
		t.Fatalf("operation replay changed: %s", again.Body)
	}
	if x := e.Do("POST", pagesPath(good), c.userA, extraction(good.File.ContentVersion)); x.StatusCode != 202 {
		t.Fatalf("second request: %d", x.StatusCode)
	}
	if len(e.Queue.Extracts) != 1 {
		t.Fatalf("one durable job per file version, got %d", len(e.Queue.Extracts))
	}
	if x := e.Do("GET", pagesPath(good)+"/0", c.userA, nil); x.StatusCode != 409 || x.Code() != "pages_not_ready" {
		t.Fatalf("page while processing: %d %s", x.StatusCode, x.Body)
	}
	e.RunQueued()
	e.Do("GET", pagesPath(good), c.userA, nil).JSON(t, &m)
	if m.State != "ready" || len(m.Pages) != 3 {
		t.Fatalf("manifest: %+v", m)
	}
	// Natural numeric order: 1, 2, 10 (sizes 30, 20, 10).
	if m.Pages[0].Width != 30 || m.Pages[1].Width != 20 || m.Pages[2].Width != 10 || m.Pages[0].MimeType != "image/png" {
		t.Fatalf("order: %+v", m.Pages)
	}
	if again := e.Do("POST", pagesPath(good), c.userA, extraction(good.File.ContentVersion)); again.StatusCode != 202 {
		t.Fatalf("already ready: %d", again.StatusCode)
	} else if again.JSON(t, &m); m.State != "ready" || len(m.Pages) != 3 {
		t.Fatalf("ready is still returned: %+v", m)
	}
	if len(e.Queue.Extracts) != 0 {
		t.Fatal("a ready manifest was re-extracted")
	}

	// Pages are served exact, private and validated; HEAD has no body.
	pg := e.Do("GET", pagesPath(good)+"/0", c.userA, nil)
	if pg.StatusCode != 200 || pg.Header.Get("Content-Type") != "image/png" || pg.Header.Get("Cache-Control") != "private, no-store" ||
		pg.Header.Get("ETag") == "" || pg.Header.Get("Content-Length") == "" {
		t.Fatalf("page: %d %v", pg.StatusCode, pg.Header)
	}
	if _, err := png.Decode(bytes.NewReader(pg.Body)); err != nil {
		t.Fatalf("served page is not a PNG: %v", err)
	}
	if h := e.Do("HEAD", pagesPath(good)+"/0", c.userA, nil); h.StatusCode != 200 || len(h.Body) != 0 || h.Header.Get("ETag") != pg.Header.Get("ETag") {
		t.Fatalf("head: %d %d", h.StatusCode, len(h.Body))
	}
	if x := e.Do("GET", pagesPath(good)+"/3", c.userA, nil); x.StatusCode != 404 {
		t.Fatalf("out of range: %d", x.StatusCode)
	}
	if x := e.Do("GET", pagesPath(good)+"/0", c.userB, nil); x.StatusCode != 403 {
		t.Fatalf("ungranted page read: %d", x.StatusCode)
	}
	if x := e.Do("GET", pagesPath(good)+"/0", "", nil); x.StatusCode != 401 {
		t.Fatalf("anonymous page read: %d", x.StatusCode)
	}
	// Originals are never altered.
	if raw, _ := os.ReadFile(cbz); !bytes.Equal(raw, zipBytes) {
		t.Fatal("extraction changed the original archive")
	}

	// Hostile archive: rejected before publication with a typed reason.
	e.Do("POST", pagesPath(evil), c.userA, extraction(evil.File.ContentVersion))
	e.RunQueued()
	e.Do("GET", pagesPath(evil), c.userA, nil).JSON(t, &m)
	if m.State != "unsupported" || len(m.Pages) != 0 || len(m.Issues) != 1 || m.Issues[0].Code != comics.CodeUnsupported {
		t.Fatalf("hostile manifest: %+v", m)
	}
	if x := e.Do("GET", pagesPath(evil)+"/0", c.userA, nil); x.StatusCode != 409 || x.Code() != comics.CodeUnsupported {
		t.Fatalf("hostile page: %d %s", x.StatusCode, x.Body)
	}
	// CBR and CB7 extract through the same bounded path (ADR-0072); a damaged RAR is explained, not guessed.
	for _, c2 := range []struct {
		ed     wire.T005Edition
		pages  int
		widths []int
	}{{rar, 2, []int{30, 20}}, {sevenEd, 2, []int{20, 10}}} {
		started := e.Do("POST", pagesPath(c2.ed), c.userA, extraction(c2.ed.File.ContentVersion))
		started.JSON(t, &m)
		if started.StatusCode != 202 || m.State != "processing" {
			t.Fatalf("%s prepare: %d %+v", c2.ed.File.Format, started.StatusCode, m)
		}
		e.RunQueued()
		e.Do("GET", pagesPath(c2.ed), c.userA, nil).JSON(t, &m)
		if m.State != "ready" || len(m.Pages) != c2.pages || m.Pages[0].Width != c2.widths[0] || m.Pages[1].Width != c2.widths[1] {
			t.Fatalf("%s manifest: %+v", c2.ed.File.Format, m)
		}
		if pg := e.Do("GET", pagesPath(c2.ed)+"/0", c.userA, nil); pg.StatusCode != 200 || pg.Header.Get("Content-Type") != "image/png" {
			t.Fatalf("%s page: %d", c2.ed.File.Format, pg.StatusCode)
		}
	}
	e.Do("POST", pagesPath(brokenEd), c.userA, extraction(brokenEd.File.ContentVersion))
	e.RunQueued()
	e.Do("GET", pagesPath(brokenEd), c.userA, nil).JSON(t, &m)
	if m.State != "unsupported" || len(m.Pages) != 0 || len(m.Issues) != 1 {
		t.Fatalf("damaged rar: %+v", m)
	}
	// A non-comic file is refused.
	epubPath := filepath.Join(c.root, "Hero", "book.epub")
	epub(t, epubPath, "Not a comic", "X", "978-1-4028-9462-6")
	scanTwice(t, e, c.admin, c.lib)
	var all wire.T005Editions
	e.Do("GET", "/editions?libraryId="+c.lib+"&size=200", c.userA, nil).JSON(t, &all)
	for _, x := range all.Items {
		if x.File.Format == "epub" {
			if y := e.Do("POST", pagesPath(x), c.userA, extraction(x.File.ContentVersion)); y.StatusCode != 422 {
				t.Fatalf("epub pages: %d %s", y.StatusCode, y.Body)
			}
		}
	}

	// Replacing the bytes supersedes the old version: pages and requests for it are 412.
	time.Sleep(10 * time.Millisecond)
	_ = os.WriteFile(cbz, append(append([]byte{}, zipBytes...), 0), 0o644)
	scanTwice(t, e, c.admin, c.lib)
	scanTwice(t, e, c.admin, c.lib)
	if x := e.Do("GET", pagesPath(good)+"/0", c.userA, nil); x.StatusCode != 412 || x.Code() != "content_changed" {
		t.Fatalf("superseded page: %d %s", x.StatusCode, x.Body)
	}
	if x := e.Do("POST", pagesPath(good), c.userA, extraction(good.File.ContentVersion)); x.StatusCode != 412 {
		t.Fatalf("superseded prepare: %d %s", x.StatusCode, x.Body)
	}

	// Revoking the grant stops page reads at once.
	if x := e.Do("DELETE", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+c.lib, c.admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke: %d", x.StatusCode)
	}
	if x := e.Do("GET", pagesPath(evil), c.userA, nil); x.StatusCode != 403 {
		t.Fatalf("after revocation: %d", x.StatusCode)
	}
}

func TestComicLimitsAndCacheBudget(t *testing.T) {
	// Lowered ceilings: at most two pages per archive and a cache budget that fits one small comic.
	pageBytes := int64(len(pngPage(40, 40)))
	c := newComicEnv(t, apitest.Options{ComicLimits: comics.Limits{MaxPages: 2}, ComicBudget: pageBytes*2 + 10})
	e := c.e
	mk := func(name string, pages int) {
		files := map[string]string{}
		for i := 1; i <= pages; i++ {
			files[string(rune('a'+i))+".png"] = pngPage(40, 40)
		}
		writeZip(t, filepath.Join(c.root, "S", name), files)
	}
	mk("big.cbz", 3)
	mk("one.cbz", 2)
	mk("two.cbz", 2)
	scanTwice(t, e, c.admin, c.lib)
	var eds wire.T005Editions
	e.Do("GET", "/editions?libraryId="+c.lib+"&size=200", c.userA, nil).JSON(t, &eds)
	if len(eds.Items) != 3 {
		t.Fatalf("editions: %d", len(eds.Items))
	}
	// The three-page archive is the largest file.
	var big wire.T005Edition
	var small []wire.T005Edition
	for _, x := range eds.Items {
		if big.ID == "" || *x.File.SizeBytes > *big.File.SizeBytes {
			if big.ID != "" {
				small = append(small, big)
			}
			big = x
		} else {
			small = append(small, x)
		}
	}
	if len(small) != 2 {
		t.Fatalf("could not tell the archives apart (%d small)", len(small))
	}
	var m wire.T005PageManifest
	e.Do("POST", pagesPath(big), c.userA, extraction(big.File.ContentVersion))
	e.RunQueued()
	e.Do("GET", pagesPath(big), c.userA, nil).JSON(t, &m)
	if m.State != "unsupported" || m.Issues[0].Code != comics.CodeLimit {
		t.Fatalf("page ceiling: %+v", m)
	}

	a, b := small[0], small[1]
	for _, x := range []wire.T005Edition{a} {
		e.Do("POST", pagesPath(x), c.userA, extraction(x.File.ContentVersion))
	}
	e.RunQueued()
	e.Do("GET", pagesPath(a), c.userA, nil).JSON(t, &m)
	if m.State != "ready" {
		t.Fatalf("first comic: %+v", m)
	}
	// The first entry is still active (just served): the second cannot evict it, so it fails cleanly.
	e.Do("GET", pagesPath(a)+"/0", c.userA, nil)
	e.Do("POST", pagesPath(b), c.userA, extraction(b.File.ContentVersion))
	e.RunQueued()
	e.Do("GET", pagesPath(b), c.userA, nil).JSON(t, &m)
	if m.State != "incomplete" || m.Issues[0].Code != "cache_full" {
		t.Fatalf("active entry protected: %+v", m)
	}
	// Once the first is inactive, least-recently-used eviction makes room and the budget holds.
	if _, err := e.Pool.Exec(t.Context(), "UPDATE comic_extractions SET last_used_at = now() - interval '1 hour'"); err != nil {
		t.Fatal(err)
	}
	e.Do("POST", pagesPath(b), c.userA, extraction(b.File.ContentVersion))
	e.RunQueued()
	e.Do("GET", pagesPath(b), c.userA, nil).JSON(t, &m)
	if m.State != "ready" {
		t.Fatalf("after eviction: %+v", m)
	}
	e.Do("GET", pagesPath(a), c.userA, nil).JSON(t, &m)
	if m.State != "incomplete" || m.Issues[0].Code != "cache_evicted" {
		t.Fatalf("evicted entry: %+v", m)
	}
	if x := e.Do("GET", pagesPath(a)+"/0", c.userA, nil); x.StatusCode != 409 || x.Code() != "pages_not_ready" {
		t.Fatalf("evicted page: %d %s", x.StatusCode, x.Body)
	}
	var total int64
	_ = e.Pool.QueryRow(t.Context(), "SELECT COALESCE(sum(cache_bytes + reserved_bytes), 0) FROM comic_extractions").Scan(&total)
	if total > pageBytes*2+10 {
		t.Fatalf("cache budget exceeded: %d", total)
	}
}
