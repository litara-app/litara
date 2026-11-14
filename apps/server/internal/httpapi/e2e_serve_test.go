package httpapi_test

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/webui"
)

// novel is a three-chapter EPUB with a navigation document, long enough that
// each chapter spans several pages.
func novel(t *testing.T, p string) {
	files := map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
		"OPS/package.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">` +
			`<dc:identifier id="id">urn:isbn:978-1-4028-9462-6</dc:identifier><dc:title>The Browser Novel</dc:title><dc:creator>Eve Tester</dc:creator><dc:language>en</dc:language></metadata>` +
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
	e := apitest.New(t, apitest.Options{
		Cfg: httpapi.APIConfig{DevInsecureHTTP: true, AllowedOrigins: []string{app}},
		Web: webui.App(os.DirFS(webDir), origins),
	})
	root, _ := filepath.Abs(filepath.Join(e.Cfg.MediaRoot, "ebooks"))
	_ = os.MkdirAll(root, 0o755)
	admin := e.Login(seed.AdminName, "cli").AccessToken
	d := setupLibrary(t, e, admin, root)
	if r := e.Do("PUT", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+d.Library.ID, admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d %s", r.StatusCode, r.Body)
	}
	novel(t, filepath.Join(root, "Eve Tester", "novel.epub"))
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
	fmt.Println("E2E READY", app, "user", seed.UserAName, "password", e.Password)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	<-ctx.Done()
}
