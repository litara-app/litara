package httpapi_test

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/comics/archivetest"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/webui"
)

// novel is a three-chapter EPUB with a navigation document, long enough that
// each chapter spans several pages.
func novel(t *testing.T, p string) { novelTitled(t, p, "The Browser Novel") }

// novelTitled is novel with a chosen title.
func novelTitled(t *testing.T, p, title string) {
	ident := "urn:isbn:978-1-4028-9462-6"
	switch title {
	case "The Browser Novel":
	case "The Pair":
		ident = "urn:isbn:978-3-16-148410-0" // two copies share a strong identifier, so they are two editions of one work
	default:
		ident = "urn:uuid:" + strings.ReplaceAll(title, " ", "-") // other books must not link to the first by identifier
	}
	files := map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
		"OPS/package.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">` +
			`<dc:identifier id="id">` + ident + `</dc:identifier><dc:title>` + title + `</dc:title><dc:creator>Eve Tester</dc:creator><dc:language>en</dc:language></metadata>` +
			`<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>` +
			`<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/></manifest>` +
			`<spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine></package>`,
		"OPS/nav.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>` +
			`<li><a href="c1.xhtml">Chapter One</a></li><li><a href="c2.xhtml">Chapter Two</a></li><li><a href="c3.xhtml">Chapter Three</a></li></ol></nav></body></html>`,
	}
	for i, name := range []string{"One", "Two", "Three"} {
		var b strings.Builder
		fmt.Fprintf(&b, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c%d</title></head><body><h1>Chapter %s</h1>`, i+1, name)
		for j := 0; j < 60; j++ {
			fmt.Fprintf(&b, "<p>Paragraph %d of chapter %s: the quick brown fox jumps over the lazy dog while the reader turns pages in the browser.</p>", j+1, name)
		}
		b.WriteString("</body></html>")
		files[fmt.Sprintf("OPS/c%d.xhtml", i+1)] = b.String()
	}
	writeZip(t, p, files)
}

// comicFixtures writes a three-page CBZ (natural order 1, 2, 10 with distinct solid
// colors), a hostile CBZ and a CBR for the browser end-to-end tests.
func comicFixtures(t *testing.T, dir string) {
	solid := func(c color.RGBA) string {
		img := image.NewRGBA(image.Rect(0, 0, 300, 450))
		draw.Draw(img, img.Bounds(), &image.Uniform{c}, image.Point{}, draw.Src)
		var b bytes.Buffer
		_ = png.Encode(&b, img)
		return b.String()
	}
	writeZip(t, filepath.Join(dir, "test-comic.cbz"), map[string]string{
		"ComicInfo.xml": `<ComicInfo><Title>The Test Comic</Title><Series>Test Series</Series><Number>1</Number><Writer>Cy Panel</Writer></ComicInfo>`,
		"pages/1.png":   solid(color.RGBA{255, 0, 0, 255}), "pages/2.png": solid(color.RGBA{0, 255, 0, 255}), "pages/10.png": solid(color.RGBA{0, 0, 255, 255}),
	})
	writeZip(t, filepath.Join(dir, "hostile.cbz"), map[string]string{
		"ComicInfo.xml": `<ComicInfo><Title>The Hostile Comic</Title></ComicInfo>`,
		"../escape.png": solid(color.RGBA{1, 1, 1, 255}), "1.png": solid(color.RGBA{2, 2, 2, 255}),
	})
	// Real RAR5 (stored) and 7z archives with three colored pages named 1, 2 and 10, and a damaged RAR.
	pages := []archivetest.RarEntry{{Name: "pages/10.png", Data: []byte(solid(color.RGBA{0, 0, 255, 255}))}, {Name: "pages/2.png", Data: []byte(solid(color.RGBA{0, 255, 0, 255}))}, {Name: "pages/1.png", Data: []byte(solid(color.RGBA{255, 0, 0, 255}))}}
	if err := archivetest.WriteRAR5(filepath.Join(dir, "legacy.cbr"), pages); err != nil {
		t.Fatal(err)
	}
	var seven []archivetest.SevenEntry
	for _, e := range pages {
		seven = append(seven, archivetest.SevenEntry{Name: e.Name, Data: e.Data})
	}
	if err := archivetest.WriteSevenZip(filepath.Join(dir, "seven.cb7"), seven, archivetest.SevenOpts{EncodeHeader: true}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "damaged.cbr"), append([]byte{'R', 'a', 'r', '!', 0x1a, 0x07, 0x01, 0x00}, []byte("not a real archive")...), 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestE2EServe boots the real application (API, web UI, separate reader origin)
// on fixed local ports with a seeded ebook for the browser end-to-end tests,
// then waits. It is skipped unless LITARA_E2E_SERVE=1 and is started by
// apps/web/playwright.e2e.config.ts.
func TestE2EServe(t *testing.T) {
	if os.Getenv("LITARA_E2E_SERVE") != "1" {
		t.Skip("set LITARA_E2E_SERVE=1 (used by the Playwright end-to-end config)")
	}
	webDir, err := filepath.Abs(os.Getenv("LITARA_E2E_WEBDIR"))
	if err != nil || os.Getenv("LITARA_E2E_WEBDIR") == "" {
		t.Fatal("LITARA_E2E_WEBDIR must name the built web directory")
	}
	const app, reader = "http://127.0.0.1:8091", "http://localhost:8092"
	origins := webui.Origins{App: app, Reader: reader}
	allowed := []string{app}
	if dev := os.Getenv("LITARA_E2E_DEV_ORIGIN"); dev != "" { // the Vite dev server, for the dev-proxy test
		allowed = append(allowed, dev)
	}
	e := apitest.New(t, apitest.Options{
		Cfg: httpapi.APIConfig{DevInsecureHTTP: true, AllowedOrigins: allowed},
		Web: webui.App(os.DirFS(webDir), origins),
	})
	root, _ := filepath.Abs(filepath.Join(e.Cfg.MediaRoot, "ebooks"))
	_ = os.MkdirAll(root, 0o755)
	admin := e.Login(seed.AdminName, "cli").AccessToken
	d := setupLibrary(t, e, admin, root)
	if r := e.Do("PUT", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+d.Library.ID, admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d %s", r.StatusCode, r.Body)
	}
	// The administrator may manage the seeded audiobook library too (repair scenarios).
	if r := e.Do("PUT", "/admin/users/"+e.Fix.AdminID.String()+"/libraries/"+e.Fix.Lib1.String(), admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("admin grant on the seeded library: %d %s", r.StatusCode, r.Body)
	}
	novel(t, filepath.Join(root, "Eve Tester", "novel.epub"))
	comicFixtures(t, filepath.Join(root, "Hero"))
	novelTitled(t, filepath.Join(root, "Eve Tester", "replaceable.epub"), "The Replaceable") // replaced on disk by the edition-replacement browser test
	// Same title and author in an EPUB (with an identifier) and an FB2 (without one): the FB2 stays a separate,
	// provisional work and raises a grouping review for the administrator.
	novelTitled(t, filepath.Join(root, "Twin", "twin.epub"), "The Twin")
	_ = os.MkdirAll(filepath.Join(root, "Twin"), 0o755)
	if err := os.WriteFile(filepath.Join(root, "Twin", "twin.fb2"), []byte(`<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info>`+
		`<author><first-name>Eve</first-name><last-name>Tester</last-name></author><book-title>The Twin</book-title><lang>en</lang></title-info></description><body><section><p>Twin text.</p></section></body></FictionBook>`), 0o644); err != nil {
		t.Fatal(err)
	}
	// Two editions of one work (same ISBN, title and author), for the explicit-finish sibling check.
	novelTitled(t, filepath.Join(root, "Pair", "pair-a.epub"), "The Pair")
	novelTitled(t, filepath.Join(root, "Pair", "pair-b.epub"), "The Pair")
	pairB, perr := os.ReadFile(filepath.Join(root, "Pair", "pair-b.epub"))
	if perr != nil {
		t.Fatal(perr)
	}
	if err := os.WriteFile(filepath.Join(root, "Pair", "pair-b.epub"), append(pairB, []byte("SECOND-COPY")...), 0o644); err != nil {
		t.Fatal(err)
	}
	// A read-only import source (outside the library root) holding two copies of seeded audio.
	src := filepath.Join(e.Cfg.MediaRoot, "import-source")
	_ = os.MkdirAll(filepath.Join(src, "Imported Author", "Imported Book"), 0o755)
	for i, key := range []string{"r1-f1", "r3-f1"} {
		b, rerr := os.ReadFile(e.Fix.Files[key].Path)
		if rerr != nil {
			t.Fatal(rerr)
		}
		_ = os.WriteFile(filepath.Join(src, "Imported Author", "Imported Book", fmt.Sprintf("part%d.mp3", i+1)), b, 0o644)
	}
	if info := os.Getenv("LITARA_E2E_INFO"); info != "" { // lets the browser tests find server-side paths
		_ = os.MkdirAll(filepath.Dir(info), 0o755)
		_ = os.WriteFile(info, []byte(fmt.Sprintf(`{"importSource": %q, "libraryRoot": %q, "libraryId": %q}`, filepath.ToSlash(src), filepath.ToSlash(root), d.Library.ID)), 0o644)
	}
	if corpus := os.Getenv("LITARA_E2E_CORPUS"); corpus != "" { // generated by scripts/web/generate_format_corpus.py
		err := filepath.WalkDir(corpus, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			rel, _ := filepath.Rel(corpus, p)
			b, rerr := os.ReadFile(p)
			if rerr != nil {
				return rerr
			}
			dst := filepath.Join(root, "Corpus", rel)
			if merr := os.MkdirAll(filepath.Dir(dst), 0o755); merr != nil {
				return merr
			}
			return os.WriteFile(dst, b, 0o644)
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	scanTwice(t, e, admin, d.Library.ID)

	serve := func(addr string, h http.Handler) {
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			t.Fatal(err)
		}
		srv := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second}
		go func() { _ = srv.Serve(ln) }()
		t.Cleanup(func() { _ = srv.Close() })
	}
	sub, err := os.ReadDir(filepath.Join(webDir, "reader"))
	if err != nil || len(sub) == 0 {
		t.Fatalf("web build has no reader directory: %v", err)
	}
	serve("127.0.0.1:8091", e.Handler)
	serve("127.0.0.1:8092", webui.Reader(os.DirFS(filepath.Join(webDir, "reader")), origins))
	// Run queued scans, comic extractions and imports as the River worker would. The test queue records a job the
	// moment a handler enqueues it, which is before that request's transaction commits (River's enqueue only becomes
	// visible on commit). Running a job in that gap would find no row and silently drop it, so each job waits a
	// moment after it is first seen; by then the request has finished.
	const settle = 600 * time.Millisecond
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })
	go func() {
		type job struct {
			kind string
			id   uuid.UUID
		}
		seen := map[job]time.Time{}
		for {
			select {
			case <-stop:
				return
			case <-time.After(200 * time.Millisecond):
				now := time.Now()
				for _, id := range e.Queue.DrainScans() {
					seen[job{"scan", id}] = now
				}
				for _, id := range e.Queue.DrainExtracts() {
					seen[job{"extract", id}] = now
				}
				for _, id := range e.Queue.DrainImports() {
					seen[job{"import", id}] = now
				}
				for j, first := range seen {
					if now.Sub(first) < settle {
						continue
					}
					delete(seen, j)
					switch j.kind {
					case "scan": // the clock moves on so files count as stable
						_, _ = e.Scanner.Run(context.Background(), j.id)
						e.Clock.Advance(time.Minute)
					case "extract":
						if err := e.Reading.RunExtraction(context.Background(), j.id); err != nil {
							fmt.Println("E2E extraction", j.id, "failed:", err)
						}
					case "import":
						_ = e.Importer.Execute(context.Background(), j.id)
					}
				}
			}
		}
	}()
	fmt.Println("E2E READY", app, "user", seed.UserAName, "password", e.Password)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	<-ctx.Done()
}
