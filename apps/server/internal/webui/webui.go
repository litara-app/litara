// Package webui serves the built web application and the isolated reader
// assets (ADR-0067, ADR-0069). API, health and media paths never fall through
// to HTML.
package webui

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// appCSP applies to the authenticated application document.
const appCSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self'; " +
	"frame-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; " +
	"form-action 'self'; frame-ancestors 'none'"

// readerCSP applies to the renderer document inside the opaque sandbox. It
// forbids inline/eval script and every network origin; book content arrives
// only through the parent's MessageChannel as blob/data URLs.
const readerCSP = "default-src 'none'; script-src 'self'; " +
	"style-src 'self' 'unsafe-inline' blob:; img-src blob: data:; font-src blob: data:; " +
	"media-src blob: data:; frame-src blob: data:; worker-src 'self' blob:; " +
	"connect-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; " +
	"frame-ancestors 'self'"

// SPA navigation prefixes that may fall back to index.html.
var spaPrefixes = []string{"/library", "/titles", "/editions", "/read", "/listen", "/shelves", "/settings", "/admin", "/login"}

// reservedPrefixes never receive HTML, even when missing.
var reservedPrefixes = []string{"/api/", "/healthz", "/readyz", "/reader/", "/assets/"}

// Handler serves root (a built dist directory).
func Handler(root fs.FS) http.Handler {
	files := http.FileServerFS(root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p := path.Clean("/" + r.URL.Path)
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")

		if strings.HasPrefix(p, "/reader/") {
			h.Set("Access-Control-Allow-Origin", "*") // anonymous; never credentialed
			h.Set("Cross-Origin-Resource-Policy", "cross-origin")
			h.Set("Cache-Control", "no-cache")
			if strings.HasSuffix(p, ".html") {
				h.Set("Content-Security-Policy", readerCSP)
			}
			serveExisting(files, root, w, r, p)
			return
		}
		if p == "/" || isSPA(p) {
			h.Set("Content-Security-Policy", appCSP)
			h.Set("X-Frame-Options", "DENY")
			h.Set("Cache-Control", "no-cache")
			http.ServeFileFS(w, r, root, "index.html")
			return
		}
		if strings.HasPrefix(p, "/assets/") {
			h.Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		serveExisting(files, root, w, r, p)
	})
}

func isSPA(p string) bool {
	for _, pre := range spaPrefixes {
		if p == pre || strings.HasPrefix(p, pre+"/") {
			return true
		}
	}
	return false
}

// serveExisting returns 404 (never HTML) unless the exact file exists.
func serveExisting(files http.Handler, root fs.FS, w http.ResponseWriter, r *http.Request, p string) {
	st, err := fs.Stat(root, strings.TrimPrefix(p, "/"))
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	files.ServeHTTP(w, r)
}

// Reserved reports whether a path must never be answered with HTML.
func Reserved(p string) bool {
	for _, pre := range reservedPrefixes {
		if strings.HasPrefix(p, pre) {
			return true
		}
	}
	return false
}
