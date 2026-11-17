package httpapi_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
)

// TestOPDSUnmodifiedClient drives KOReader's own OPDS client code (opdsbrowser.lua and
// opdsparser.lua from a pinned release) under its bundled LuaJIT in a Linux container,
// against this application's real HTTP listener, for both the Atom and the OPDS 2.0
// catalog. Only the UI widgets are replaced by inert stand-ins; parsing, link selection,
// search, pagination and HTTP are the client's. It is skipped unless
// LITARA_REAL_KOREADER_DIR names the extracted KOReader install directory and Docker is
// available. Set LITARA_REAL_OPDS_OUT to write the captured request sequence.
func TestOPDSUnmodifiedClient(t *testing.T) {
	koDir := os.Getenv("LITARA_REAL_KOREADER_DIR")
	if koDir == "" {
		t.Skip("set LITARA_REAL_KOREADER_DIR to an extracted KOReader release (lib/koreader)")
	}
	image := os.Getenv("LITARA_REAL_KOREADER_IMAGE")
	if image == "" {
		image = "golang:1.26"
	}
	driver, err := filepath.Abs(filepath.Join("..", "..", "..", "..", "research", "t006", "opds-real-client", "opds_driver.lua"))
	if err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	origin := fmt.Sprintf("http://host.docker.internal:%d", port)
	o := newOPDSEnv(t, apitest.Options{Cfg: httpapi.APIConfig{PublicOrigin: origin}})

	var mu sync.Mutex
	var seen []string
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Header.Set("X-Forwarded-Proto", "https") // stands in for TLS termination in front of the application
		rec := &statusRecorder{ResponseWriter: w, code: 200}
		o.e.Handler.ServeHTTP(rec, r)
		mu.Lock()
		seen = append(seen, fmt.Sprintf("%s %s -> %d (accept: %s)", r.Method, r.URL.RequestURI(), rec.code, r.Header.Get("Accept")))
		mu.Unlock()
	})
	srv := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	want := map[string]string{} // sha256 -> label
	for label, p := range map[string]string{"vol2": o.epubPath, "zebra": filepath.Join(o.root, "Zeta", "zebra.epub"), "issue1": o.cbzPath} {
		raw, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		s := sha256.Sum256(raw)
		want[hex.EncodeToString(s[:])] = label
	}

	// Every other original on disk (for example the seeded audio files in another granted library).
	onDisk := map[string]bool{}
	addFile := func(p string) {
		if raw, err := os.ReadFile(p); err == nil {
			s := sha256.Sum256(raw)
			onDisk[hex.EncodeToString(s[:])] = true
		}
	}
	_ = filepath.WalkDir(o.e.Cfg.MediaRoot, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			addFile(p)
		}
		return nil
	})
	for _, f := range o.e.Fix.Files {
		addFile(f.Path)
	}

	type dl struct {
		Title  string `json:"title"`
		Href   string `json:"href"`
		Type   string `json:"type"`
		Status int    `json:"status"`
		Bytes  int    `json:"bytes"`
		SHA256 string `json:"sha256"`
	}
	type summary struct {
		Pages      int  `json:"pages"`
		Books      int  `json:"books"`
		Navigation int  `json:"navigation"`
		Searched   bool `json:"searched"`
		SearchHits int  `json:"searchHits"`
	}
	run := func(root string) (out string, sum summary, dls []dl) {
		t.Helper()
		abs := func(p string) string { a, _ := filepath.Abs(p); return a }
		cmd := exec.Command("docker", "run", "--rm", "--add-host=host.docker.internal:host-gateway",
			"-v", abs(koDir)+":/ko:ro", "-v", driver+":/drv/opds_driver.lua:ro", "-w", "/ko", image,
			"./luajit", "/drv/opds_driver.lua", origin+root, o.credA.Username, o.pwA, "Zebra")
		raw, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("opds client run failed: %v\n%s", err, raw)
		}
		out = string(raw)
		for _, l := range strings.Split(out, "\n") {
			switch {
			case strings.HasPrefix(l, "SUMMARY "):
				if err := json.Unmarshal([]byte(strings.TrimPrefix(l, "SUMMARY ")), &sum); err != nil {
					t.Fatalf("summary: %v", err)
				}
			case strings.HasPrefix(l, "DOWNLOAD "):
				var d dl
				if err := json.Unmarshal([]byte(strings.TrimPrefix(l, "DOWNLOAD ")), &d); err != nil {
					t.Fatalf("download line: %v", err)
				}
				dls = append(dls, d)
			}
		}
		return
	}

	var transcript strings.Builder
	for _, f := range []struct{ name, root string }{{"Atom (OPDS 1.2)", "/opds/v1"}, {"OPDS 2.0", "/opds/v2"}} {
		mu.Lock()
		seen = seen[:0]
		mu.Unlock()
		out, sum, dls := run(f.root)
		// Which format the client really used: it asks for OPDS 2.0 first, so a root that answers Atom
		// must still be navigable, and the 2.0 root must be parsed as JSON.
		if sum.Pages < 2 || sum.Navigation < 1 {
			t.Fatalf("%s: the client did not follow navigation: %+v\n%s", f.name, sum, out)
		}
		// KOReader builds "?query=Zebra" from the OPDS 2.0 template "{?q,...}"; the server accepts that alias, so
		// search is filtered in both versions (one match, not every book).
		if !sum.Searched || sum.SearchHits != 1 {
			t.Fatalf("%s: search through the client found nothing: %+v\n%s", f.name, sum, out)
		}
		got := map[string]bool{}
		for _, d := range dls {
			if d.Status != 200 || d.Bytes == 0 {
				t.Fatalf("%s: download failed: %+v", f.name, d)
			}
			if _, ok := want[d.SHA256]; !ok && !onDisk[d.SHA256] {
				t.Fatalf("%s: downloaded bytes are not an original file: %+v", f.name, d)
			}
			if label, ok := want[d.SHA256]; ok {
				got[label] = true
			}
		}
		for _, label := range want {
			if !got[label] {
				t.Fatalf("%s: the client never downloaded the original of %s\n%s", f.name, label, out)
			}
		}
		mu.Lock()
		fmt.Fprintf(&transcript, "== %s ==\n%s\nserver-observed requests:\n%s\n\n", f.name, out, strings.Join(seen, "\n"))
		mu.Unlock()
	}
	if p := os.Getenv("LITARA_REAL_OPDS_OUT"); p != "" {
		body := "KOReader release: " + os.Getenv("LITARA_REAL_KOREADER_VERSION") + "\n\n" + transcript.String()
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
