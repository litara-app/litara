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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/accounts"
	"github.com/deranjer/ebooker/apps/server/internal/catalog"
	"github.com/deranjer/ebooker/apps/server/internal/comics"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
	"github.com/deranjer/ebooker/apps/server/internal/importer"
	"github.com/deranjer/ebooker/apps/server/internal/ingest"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/library"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/progress"
	"github.com/deranjer/ebooker/apps/server/internal/reading"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
	"github.com/deranjer/ebooker/apps/server/internal/writeback"
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
	T       *testing.T
	Pool    *pgxpool.Pool
	Server  *httptest.Server
	Reading *reading.Service
	// Handler is the full application handler (for serving it on another listener).
	Handler  http.Handler
	Fix      *seed.Fixture
	Accounts *accounts.Service
	Catalog  *catalog.Service
	Progress *progress.Service
	Clock    *Clock
	// T004
	Scanner   *ingest.Scanner
	Importer  *importer.Service
	Writeback *writeback.Service
	Queue     *Queue
	Password  string
	Base      string
	Cfg       httpapi.APIConfig
}

// Options tune the environment.
type Options struct {
	Cfg httpapi.APIConfig
	// NoSeed skips fixture creation (bootstrap tests).
	NoSeed bool
	// Web is mounted at "/" for browser end-to-end runs.
	Web http.Handler
	// Comic extraction tuning for tests (zero values use the ADR defaults).
	ComicLimits comics.Limits
	ComicBudget int64
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
	t4insp := inspect.New(inspect.Config{ProbePath: testutil.Tool(t, "ffprobe")})
	e.Scanner = &ingest.Scanner{Pool: pool, Inspector: t4insp, Now: clock.Now}
	e.Importer = &importer.Service{Pool: pool, Inspector: t4insp, Now: clock.Now}
	meta := metadata.New(pool)
	e.Writeback = &writeback.Service{Pool: pool, Inspector: t4insp, Scanner: e.Scanner, Metadata: meta, Writers: map[string]writeback.Writer{}, Now: clock.Now}
	e.Queue = &Queue{}
	e.Reading = reading.New(pool, cat, clock.Now)
	e.Reading.EnableComics(reading.ComicOptions{MediaRoot: o.Cfg.MediaRoot, CacheDir: t.TempDir(), Limits: o.ComicLimits, CacheBudget: o.ComicBudget, Enqueuer: e.Queue})
	h := httpapi.New(httpapi.Deps{Web: o.Web, Pool: pool, Version: "test", API: &httpapi.APIDeps{Accounts: acc, Catalog: cat, Progress: prog, Reading: e.Reading, Library: library.New(pool), Config: o.Cfg,
		Pool: pool, Jobs: e.Queue, Scanner: e.Scanner, Metadata: meta, Enricher: &metadata.Enricher{Service: meta, Providers: map[string]metadata.Provider{}}, Importer: e.Importer, Writeback: e.Writeback}})
	e.Handler = h
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

// Queue records job wake-ups instead of running River, so tests choose when
// queued work executes (and can run it after the request transaction commits).
type Queue struct {
	mu       sync.Mutex
	Scans    []uuid.UUID
	Imports  []uuid.UUID
	Extracts []uuid.UUID
}

func (q *Queue) EnqueueScan(_ context.Context, _ pgx.Tx, id uuid.UUID) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.Scans = append(q.Scans, id)
	return nil
}

func (q *Queue) EnqueueExtract(_ context.Context, _ pgx.Tx, id uuid.UUID) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.Extracts = append(q.Extracts, id)
	return nil
}

// DrainImports returns and clears the queued import plan IDs.
func (q *Queue) DrainImports() []uuid.UUID {
	q.mu.Lock()
	defer q.mu.Unlock()
	ids := q.Imports
	q.Imports = nil
	return ids
}

// DrainExtracts returns and clears the queued comic extraction IDs.
func (q *Queue) DrainExtracts() []uuid.UUID {
	q.mu.Lock()
	defer q.mu.Unlock()
	ids := q.Extracts
	q.Extracts = nil
	return ids
}

func (q *Queue) EnqueueImport(_ context.Context, _ pgx.Tx, id uuid.UUID) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.Imports = append(q.Imports, id)
	return nil
}

// RunQueued executes everything queued so far, as the River workers would.
func (e *Env) RunQueued() {
	e.T.Helper()
	e.Queue.mu.Lock()
	scans, imports, extracts := e.Queue.Scans, e.Queue.Imports, e.Queue.Extracts
	e.Queue.Scans, e.Queue.Imports, e.Queue.Extracts = nil, nil, nil
	e.Queue.mu.Unlock()
	for _, id := range scans {
		if _, err := e.Scanner.Run(context.Background(), id); err != nil {
			e.T.Fatalf("scan %s: %v", id, err)
		}
	}
	for _, id := range extracts {
		if err := e.Reading.RunExtraction(context.Background(), id); err != nil {
			e.T.Fatalf("extract %s: %v", id, err)
		}
	}
	for _, id := range imports {
		if err := e.Importer.Execute(context.Background(), id); err != nil {
			e.T.Fatalf("import %s: %v", id, err)
		}
	}
}
