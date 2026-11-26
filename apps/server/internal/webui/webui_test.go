package webui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

var origins = Origins{App: "http://app.test", Reader: "http://reader.test"}

func appFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":        {Data: []byte("<html>app</html>")},
		"assets/a.js":       {Data: []byte("x")},
		"reader/frame.html": {Data: []byte("frame")},
	}
}

func readerFS() fstest.MapFS {
	return fstest.MapFS{
		"frame.html":     {Data: []byte("<html>frame</html>")},
		"vendor/mod.mjs": {Data: []byte("export {}")},
	}
}

func get(h http.Handler, method, p string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(method, p, nil))
	return w
}

func TestAppFallbackRestrictedAndNoReader(t *testing.T) {
	h := App(appFS(), origins)
	for _, p := range []string{"/", "/library", "/titles/abc", "/read/x/y", "/stats", "/annotations", "/settings/devices", "/pending"} {
		w := get(h, "GET", p)
		if w.Code != 200 || !strings.Contains(w.Body.String(), "app") {
			t.Fatalf("%s: %d", p, w.Code)
		}
		csp := w.Header().Get("Content-Security-Policy")
		if !strings.Contains(csp, "frame-src http://reader.test;") || !strings.Contains(csp, "frame-ancestors 'none'") {
			t.Fatalf("%s CSP: %s", p, csp)
		}
	}
	for _, p := range []string{"/api/v1/nope", "/healthz", "/readyz", "/assets/missing.js", "/reader/frame.html", "/random", "/media/x"} {
		w := get(h, "GET", p)
		if w.Code != 404 || strings.Contains(w.Body.String(), "app") {
			t.Fatalf("%s: %d %q", p, w.Code, w.Body.String())
		}
	}
	if w := get(h, "POST", "/library"); w.Code != 405 {
		t.Fatalf("post: %d", w.Code)
	}
	if w := get(h, "GET", "/app-config.json"); !strings.Contains(w.Body.String(), `"readerOrigin":"http://reader.test"`) {
		t.Fatalf("config: %s", w.Body.String())
	}
}

func TestReaderOrigin(t *testing.T) {
	h := Reader(readerFS(), origins)
	w := get(h, "GET", "/frame.html")
	csp := w.Header().Get("Content-Security-Policy")
	for _, want := range []string{"sandbox allow-scripts allow-same-origin", "default-src 'none'", "frame-ancestors http://app.test http://reader.test", "connect-src blob:"} {
		if !strings.Contains(csp, want) {
			t.Fatalf("reader CSP missing %q: %s", want, csp)
		}
	}
	for _, bad := range []string{"unsafe-eval", "script-src 'self' 'unsafe-inline'", "https:", "*"} {
		if strings.Contains(csp, bad) {
			t.Fatalf("reader CSP contains %q: %s", bad, csp)
		}
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("reader origin must not enable CORS")
	}
	if get(h, "GET", "/vendor/mod.mjs").Code != 200 {
		t.Fatal("module")
	}
	for _, p := range []string{"/", "/library", "/api/v1/me", "/healthz", "/index.html", "/vendor/missing.js", "/../x"} {
		if w := get(h, "GET", p); w.Code != 404 {
			t.Fatalf("%s: %d", p, w.Code)
		}
	}
	if get(h, "HEAD", "/frame.html").Body.Len() != 0 {
		t.Fatal("HEAD body")
	}
	if get(h, "POST", "/frame.html").Code != 405 {
		t.Fatal("post")
	}
}
