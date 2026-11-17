package httpapi_test

import (
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
)

// TestKOReaderUnmodifiedClient drives KOReader's own, unmodified sync client code
// (plugins/kosync.koplugin/KOSyncClient.lua, util.partialMD5, ffi/sha2 md5) from a pinned
// KOReader release under its bundled LuaJIT in a Linux container, against this application's
// real HTTP listener. It does not run KOReader's UI. It is skipped unless
// LITARA_REAL_KOREADER_DIR names the extracted KOReader install directory (lib/koreader) and
// Docker is available. Set LITARA_REAL_KOREADER_OUT to write the captured request sequence.
func TestKOReaderUnmodifiedClient(t *testing.T) {
	koDir := os.Getenv("LITARA_REAL_KOREADER_DIR")
	if koDir == "" {
		t.Skip("set LITARA_REAL_KOREADER_DIR to an extracted KOReader release (lib/koreader)")
	}
	image := os.Getenv("LITARA_REAL_KOREADER_IMAGE")
	if image == "" {
		image = "golang:1.26"
	}
	driver, err := filepath.Abs(filepath.Join("..", "..", "..", "..", "research", "t006", "koreader-real-client", "kosync_driver.lua"))
	if err != nil {
		t.Fatal(err)
	}
	k := newKOEnv(t)

	// A real listener. The proxy in front stands in for TLS termination (the application requires
	// HTTPS or a forwarded-proto header); the client itself speaks plain HTTP to it.
	var mu sync.Mutex
	var seen []string
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Header.Set("X-Forwarded-Proto", "https")
		rec := &statusRecorder{ResponseWriter: w, code: 200}
		k.e.Handler.ServeHTTP(rec, r)
		mu.Lock()
		seen = append(seen, fmt.Sprintf("%s %s -> %d (auth headers present: user=%t key=%t)", r.Method, r.URL.Path, rec.code,
			r.Header.Get("x-auth-user") != "", r.Header.Get("x-auth-key") != ""))
		mu.Unlock()
	})
	ln, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })
	port := ln.Addr().(*net.TCPAddr).Port
	base := fmt.Sprintf("http://host.docker.internal:%d/1", port)

	bookDir, bookName := filepath.Dir(k.epubPath), filepath.Base(k.epubPath)
	run := func(user, password, device, mode string) string {
		t.Helper()
		abs := func(p string) string { a, _ := filepath.Abs(p); return a }
		cmd := exec.Command("docker", "run", "--rm", "--add-host=host.docker.internal:host-gateway",
			"-v", abs(koDir)+":/ko:ro", "-v", abs(bookDir)+":/books:ro", "-v", driver+":/drv/kosync_driver.lua:ro", "-w", "/ko", image,
			"./luajit", "/drv/kosync_driver.lua", base, user, password, "/books/"+bookName, device, mode)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("koreader client run failed: %v\n%s", err, out)
		}
		return string(out)
	}
	results := func(out string) []string {
		var rs []string
		for _, l := range strings.Split(out, "\n") {
			if strings.HasPrefix(l, "RESULT ") || strings.HasPrefix(l, "DOC ") {
				rs = append(rs, strings.TrimSpace(l))
			}
		}
		return rs
	}

	type step struct {
		Step   string         `json:"step"`
		OK     bool           `json:"ok"`
		Status int            `json:"status"`
		Body   map[string]any `json:"body"`
	}
	parse := func(rs []string) map[string]step {
		m := map[string]step{}
		for _, l := range rs {
			if strings.HasPrefix(l, "RESULT ") {
				var s step
				if err := json.Unmarshal([]byte(strings.TrimPrefix(l, "RESULT ")), &s); err != nil {
					t.Fatalf("unparseable client result %q: %v", l, err)
				}
				m[s.Step] = s
			}
		}
		return m
	}

	// Device one: authorize, read, save, read again.
	out1 := run(k.credA1.Username, k.pwA1, "Real KOReader One", "read-write")
	r1 := results(out1)
	if len(r1) != 5 || r1[0] != "DOC "+k.docs["vol2"] {
		t.Fatalf("KOReader computed a different document ID than the server indexed (%s): %v", k.docs["vol2"], r1)
	}
	m1 := parse(r1)
	if !m1["authorize"].OK || !m1["get_before"].OK || len(m1["get_before"].Body) != 0 || !m1["put"].OK || m1["put"].Status != 200 || !m1["get_after"].OK {
		t.Fatalf("device one sequence: %v", r1)
	}
	if g := m1["get_after"].Body; g["percentage"] != 0.25 || g["device"] != "Real KOReader One" || g["document"] != k.docs["vol2"] {
		t.Fatalf("saved position not returned to the real client: %v", g)
	}

	// Device two saves without reading first: the server retains it instead of overwriting.
	out2 := run(k.credA2.Username, k.pwA2, "Real KOReader Two", "put-only")
	r2 := results(out2)
	joined2 := strings.Join(r2, "\n")
	m2 := parse(r2)
	// KOReader's api.json lists only 200, 202 and 401 as expected statuses, so Spore raises on the 409 and the
	// plugin reports a generic failure with no status or body. That is the client's real behavior and is recorded as
	// a boundary; the 409 itself is established from the server side below.
	if !m2["authorize"].OK || m2["put"].OK {
		t.Fatalf("the real client must report the unsynced second device as a failed save: %v", r2)
	}
	mu.Lock()
	saw409 := false
	for _, l := range seen {
		if strings.HasPrefix(l, "PUT /1/syncs/progress -> 409") {
			saw409 = true
		}
	}
	mu.Unlock()
	if !saw409 {
		t.Fatalf("the server did not answer the second device with 409: %v", seen)
	}
	cs := k.conflicts(t)
	if len(cs) != 1 || cs[0].Resolved || cs[0].Candidate.Device != "Real KOReader Two" {
		t.Fatalf("retained candidate expected: %+v", cs)
	}

	// A wrong key is refused by the real client path as an authorization failure.
	out3 := run(k.credA1.Username, "not-the-password", "Real KOReader One", "put-only")
	if m3 := parse(results(out3)); m3["authorize"].OK {
		t.Fatalf("a wrong key must fail authorization: %s", out3)
	}

	if p := os.Getenv("LITARA_REAL_KOREADER_OUT"); p != "" {
		mu.Lock()
		defer mu.Unlock()
		body := "KOReader release: " + os.Getenv("LITARA_REAL_KOREADER_VERSION") + "\n\n== device one (read-write) ==\n" + strings.Join(r1, "\n") +
			"\n\n== device two (put without reading) ==\n" + joined2 + "\n\n== wrong key ==\n" + strings.Join(results(out3), "\n") +
			"\n\n== server-observed requests ==\n" + strings.Join(seen, "\n") + "\n"
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (s *statusRecorder) WriteHeader(c int) { s.code = c; s.ResponseWriter.WriteHeader(c) }
