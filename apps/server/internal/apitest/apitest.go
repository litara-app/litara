// Package apitest builds a real server (PostgreSQL, generated media, the T001
// inspector) behind httptest for integration tests of the T003 contract.
package apitest

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/accounts"
	"github.com/deranjer/ebooker/apps/server/internal/catalog"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/progress"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Clock is a controllable clock shared by every service.
type Clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *Clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *Clock) Advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

// Env is one isolated server + database + fixture.
type Env struct {
	T        *testing.T
	Pool     *pgxpool.Pool
	Server   *httptest.Server
	Fix      *seed.Fixture
	Accounts *accounts.Service
	Catalog  *catalog.Service
	Progress *progress.Service
	Clock    *Clock
	Password string
	Base     string
	Cfg      httpapi.APIConfig
}

// Options tune the environment.
type Options struct {
	Cfg httpapi.APIConfig
	// NoSeed skips fixture creation (bootstrap tests).
	NoSeed bool
}

// New starts the environment; everything is closed at test cleanup.
func New(t *testing.T, opts ...Options) *Env {
	t.Helper()
	var o Options
	if len(opts) > 0 {
		o = opts[0]
	}
	ctx := context.Background()
	pool := testutil.MigratedDatabase(t)
	clock := &Clock{t: time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC)}
	key, _ := accounts.GenerateKey()
	kb, _ := accounts.ParseKey(key)
	o.Cfg.MediaRoot = t.TempDir()
	acc := accounts.New(accounts.Options{Pool: pool, Clock: clock.Now, SecretKey: kb, Argon: accounts.ArgonParams{MemoryKiB: 8, Time: 1, Threads: 1}})
	base := o.Cfg.APIBase()
	cat := catalog.New(pool, base)
	prog := progress.New(pool, cat, clock.Now)

	e := &Env{T: t, Pool: pool, Accounts: acc, Catalog: cat, Progress: prog, Clock: clock, Password: "synthetic-fixture-password", Base: base, Cfg: o.Cfg}
	if !o.NoSeed {
		insp := inspect.New(inspect.Config{ProbePath: testutil.Tool(t, "ffprobe"), MediaRoot: o.Cfg.MediaRoot})
		fix, err := seed.Run(ctx, seed.Options{Pool: pool, Accounts: acc, Inspector: insp, FFmpeg: testutil.Tool(t, "ffmpeg"),
			Dir: o.Cfg.MediaRoot, Password: e.Password})
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
		e.Fix = fix
	}
	h := httpapi.New(httpapi.Deps{Pool: pool, Version: "test", API: &httpapi.APIDeps{Accounts: acc, Catalog: cat, Progress: prog, Config: o.Cfg}})
	e.Server = httptest.NewServer(h)
	t.Cleanup(e.Server.Close)
	return e
}

// Response is a fully read HTTP response.
type Response struct {
	*http.Response
	Body []byte
}

// JSON decodes the body into v.
func (r Response) JSON(t testing.TB, v any) {
	t.Helper()
	if err := json.Unmarshal(r.Body, v); err != nil {
		t.Fatalf("decode %s: %v\nbody: %s", r.Request.URL.Path, err, r.Body)
	}
}

// Code returns the problem code of an error response ("" otherwise).
func (r Response) Code() string {
	var p struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(r.Body, &p)
	return p.Code
}

// Do sends a request. body may be nil, a []byte, or a value to JSON-encode.
func (e *Env) Do(method, path, token string, body any, hdr ...string) Response {
	e.T.Helper()
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case []byte:
		rd = bytes.NewReader(b)
	default:
		raw, err := json.Marshal(b)
		if err != nil {
			e.T.Fatal(err)
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, e.Server.URL+"/api/v1"+path, rd)
	if err != nil {
		e.T.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.T.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return Response{resp, b}
}

// Login signs a fixture user in natively.
func (e *Env) Login(username, device string) wire.TokenPair {
	e.T.Helper()
	r := e.Do("POST", "/auth/native/login", "", wire.Login{Username: username, Password: e.Password, DeviceName: device})
	if r.StatusCode != 200 {
		e.T.Fatalf("login %s: %d %s", username, r.StatusCode, r.Body)
	}
	var tp wire.TokenPair
	r.JSON(e.T, &tp)
	return tp
}

// AddSparseRecording registers a one-file recording backed by a sparse file.
// Test-only: the bytes are not valid audio, so it proves offset arithmetic only.
func (e *Env) AddSparseRecording(ctx context.Context, library uuid.UUID, path string, size int64) {
	e.T.Helper()
	q := sqlcgen.New(e.Pool)
	titleID, recID, fileID, ver := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	dur := int64(3600000)
	must := func(err error) {
		if err != nil {
			e.T.Fatal(err)
		}
	}
	_, err := q.SeedUpsertTitle(ctx, sqlcgen.SeedUpsertTitleParams{ID: titleID, Title: "Sparse Offset Fixture", Authors: []string{"Sparse"}})
	must(err)
	_, err = q.SeedUpsertRecording(ctx, sqlcgen.SeedUpsertRecordingParams{ID: recID, TitleID: titleID, LibraryID: library, Narrators: []string{}, LayoutRevision: uuid.New()})
	must(err)
	must(q.SeedUpsertMediaFile(ctx, fileID))
	must(q.SeedUpsertFileVersion(ctx, sqlcgen.SeedUpsertFileVersionParams{ContentVersion: ver, FileID: fileID, Locator: path, Filename: "sparse.mp3",
		MimeType: "audio/mpeg", SizeBytes: &size, DurationMs: &dur, Available: true, Current: true}))
	must(q.InsertRecordingFile(ctx, sqlcgen.InsertRecordingFileParams{RecordingID: recID, Sequence: 0, FileID: fileID}))
}
