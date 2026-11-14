package webui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func fsys() fstest.MapFS {
	return fstest.MapFS{
		"index.html":            {Data: []byte("<html>app</html>")},
		"assets/a.js":           {Data: []byte("x")},
		"reader/frame.html":     {Data: []byte("<html>frame</html>")},
		"reader/vendor/mod.mjs": {Data: []byte("export {}")},
	}
}

func get(h http.Handler, method, p string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(method, p, nil))
	return w
}

func TestSPAFallbackRestricted(t *testing.T) {
	h := Handler(fsys())
	for _, p := range []string{"/", "/library", "/titles/abc", "/read/x/y"} {
		w := get(h, "GET", p)
		if w.Code != 200 || !strings.Contains(w.Body.String(), "app") {
			t.Fatalf("%s: %d", p, w.Code)
		}
		if !strings.Contains(w.Header().Get("Content-Security-Policy"), "script-src 'self'") {
			t.Fatalf("%s missing CSP", p)
		}
	}
	for _, p := range []string{"/api/v1/nope", "/healthz", "/readyz", "/assets/missing.js", "/reader/missing.mjs", "/random", "/media/x"} {
		w := get(h, "GET", p)
		if w.Code != 404 || strings.Contains(w.Body.String(), "app") {
			t.Fatalf("%s: %d %q", p, w.Code, w.Body.String())
		}
	}
	if w := get(h, "POST", "/library"); w.Code != 405 {
		t.Fatalf("post: %d", w.Code)
	}
}

func TestReaderHeaders(t *testing.T) {
	h := Handler(fsys())
	w := get(h, "GET", "/reader/frame.html")
	csp := w.Header().Get("Content-Security-Policy")
	for _, bad := range []string{"unsafe-eval", "script-src 'self' 'unsafe-inline'", "http:", "https:", "*"} {
		if strings.Contains(csp, bad) {
			t.Fatalf("reader CSP contains %q: %s", bad, csp)
		}
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "*" || w.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Fatal("reader CORS must be anonymous")
	}
	w = get(h, "GET", "/reader/vendor/mod.mjs")
	if w.Code != 200 || w.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("module: %d", w.Code)
	}
	if get(h, "HEAD", "/reader/frame.html").Body.Len() != 0 {
		t.Fatal("HEAD has body")
	}
}
