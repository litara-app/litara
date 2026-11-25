// Package webui serves the built web application and, from a separate origin,
// the isolated reader assets (ADR-0067 as amended by ADR-0071, ADR-0069). API,
// health and media paths never fall through to HTML.
package webui

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// Origins names the two browser origins. They must differ by hostname.
type Origins struct {
	App    string // public origin of the application, e.g. https://litara.example
	Reader string // public origin of the reader, e.g. https://reader.litara.example
}

func appCSP(o Origins) string {
	return "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self'; " +
		"frame-src " + o.Reader + "; worker-src 'none'; object-src 'none'; base-uri 'none'; " +
		"form-action 'self'; frame-ancestors 'none'"
}

// readerCSP applies to the renderer document and is inherited by blob section
// frames. It forbids inline/eval script and every network origin; book bytes
// arrive only through the parent's MessageChannel as blob/data URLs. The
// sandbox directive keeps the document sandboxed even if navigated directly.
func readerCSP(o Origins) string {
	return "sandbox allow-scripts allow-same-origin; " +
		"default-src 'none'; script-src 'self'; " +
		"style-src 'self' 'unsafe-inline' blob:; img-src blob: data:; font-src blob: data:; " +
		"media-src blob: data:; frame-src blob: data:; worker-src 'self' blob:; " +
		"connect-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; " +
		"frame-ancestors " + o.App + " " + o.Reader
}

// SPA navigation prefixes that may fall back to index.html.
var spaPrefixes = []string{"/library", "/titles", "/editions", "/read", "/listen", "/shelves", "/settings", "/admin", "/login", "/pending", "/stats"}

// App serves the built application (root is the dist directory). The reader
// directory is not served from this origin.
func App(root fs.FS, o Origins) http.Handler {
	files := http.FileServerFS(root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !readOnly(w, r) {
			return
		}
		p := path.Clean("/" + r.URL.Path)
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")

		switch {
		case p == "/app-config.json":
			h.Set("Content-Type", "application/json")
			h.Set("Cache-Control", "no-cache")
			_ = json.NewEncoder(w).Encode(map[string]string{"readerOrigin": o.Reader})
		case p == "/" || isSPA(p):
			h.Set("Content-Security-Policy", appCSP(o))
			h.Set("X-Frame-Options", "DENY")
			h.Set("Cache-Control", "no-cache")
			http.ServeFileFS(w, r, root, "index.html")
		case strings.HasPrefix(p, "/reader/") || strings.HasPrefix(p, "/api/"):
			http.NotFound(w, r)
		default:
			if strings.HasPrefix(p, "/assets/") {
				h.Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			serveExisting(files, root, w, r, p)
		}
	})
}

// Reader serves only the reader asset directory (root is dist/reader) at the
// reader origin's root. It has no API, cookie, media or fallback routes.
func Reader(root fs.FS, o Origins) http.Handler {
	files := http.FileServerFS(root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !readOnly(w, r) {
			return
		}
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-cache")
		h.Set("Content-Security-Policy", readerCSP(o))
		serveExisting(files, root, w, r, path.Clean("/"+r.URL.Path))
	})
}

func readOnly(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	return true
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
