// Package apitest builds a real server (PostgreSQL, generated media, the T001
// inspector) behind httptest for integration tests of the T003 contract.
package apitest

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
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
	"github.com/deranjer/ebooker/apps/server/internal/covers"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/delivery"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
	"github.com/deranjer/ebooker/apps/server/internal/importer"
	"github.com/deranjer/ebooker/apps/server/internal/ingest"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/integrations"
	"github.com/deranjer/ebooker/apps/server/internal/koreader"
	"github.com/deranjer/ebooker/apps/server/internal/library"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/progress"
	"github.com/deranjer/ebooker/apps/server/internal/reading"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/smtptest"
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
	Covers    *covers.Service
	// T006
	Integrations *integrations.Service
	KOReader     *koreader.Service
	Delivery     *delivery.Service
	DQ           *DeliveryQueue
	CA           *smtptest.CA
	Indexer      *koreader.Indexer
	Queue        *Queue
	Password     string
	Base         string
	Cfg          httpapi.APIConfig
}

// Options tune the environment.
type Options struct {
	Cfg httpapi.APIConfig
	// NoSeed skips fixture creation (bootstrap tests).
	NoSeed bool
	// Providers replaces the (empty) metadata provider set, so a test can serve candidates without a network.
	Providers map[string]metadata.Provider
	// ProviderCacheTTL turns the provider search cache on (it follows the controllable Clock).
	ProviderCacheTTL time.Duration
	// Web is mounted at "/" for browser end-to-end runs.
	Web http.Handler
	// Comic extraction tuning for tests (zero values use the ADR defaults).
	ComicLimits comics.Limits
	ComicBudget int64
	// DeliveryHooks injects failures into the send path (tests only).
	DeliveryHooks delivery.SendHooks
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
	// The listener is bound first so absolute OPDS links name the real test origin.
	srv := httptest.NewUnstartedServer(nil)
	if o.Cfg.PublicOrigin == "" {
		o.Cfg.PublicOrigin = "http://" + srv.Listener.Addr().String()
	}
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
	e.Writeback = &writeback.Service{Pool: pool, Inspector: t4insp, Scanner: e.Scanner, Metadata: meta, Writers: writeback.BuiltInWriters(), Now: clock.Now}
	e.Queue = &Queue{}
	e.Integrations = integrations.New(integrations.Options{Pool: pool, Clock: clock.Now, Argon: accounts.ArgonParams{MemoryKiB: 8, Time: 1, Threads: 1},
		FingerprintKey: integrations.DeriveFingerprintKey(kb)})
	e.Reading = reading.New(pool, cat, clock.Now)
	e.Reading.EnableComics(reading.ComicOptions{MediaRoot: o.Cfg.MediaRoot, CacheDir: t.TempDir(), Limits: o.ComicLimits, CacheBudget: o.ComicBudget, Enqueuer: e.Queue})
	e.KOReader = koreader.New(pool, cat, clock.Now)
	e.CA = smtptest.NewCA(t)
	e.DQ = &DeliveryQueue{}
	rawKey := make([]byte, 32)
	_, _ = rand.Read(rawKey)
	ring, _ := delivery.ParseKeyRing("test-key:"+base64.StdEncoding.EncodeToString(rawKey), "test-key")
	e.Delivery = delivery.New(delivery.Options{Pool: pool, Keys: ring, Net: delivery.NetPolicy{AllowLocalTest: true, RootCAs: e.CA.Pool,
		ConnectTimeout: 3 * time.Second, SendTimeout: 10 * time.Second}, Catalog: cat, Integrations: e.Integrations, Sched: e.DQ,
		MediaRoot: o.Cfg.MediaRoot, Clock: clock.Now, Hooks: o.DeliveryHooks})
	e.Covers = covers.New(pool, o.Cfg.MediaRoot, covers.NewFetcher(true), covers.NewSearcher())
	providers := o.Providers
	if providers == nil {
		providers = map[string]metadata.Provider{}
	}
	e.Indexer = &koreader.Indexer{Pool: pool, MediaRoot: o.Cfg.MediaRoot}
	h := httpapi.New(httpapi.Deps{Web: o.Web, Pool: pool, Version: "test", API: &httpapi.APIDeps{Accounts: acc, Catalog: cat, Progress: prog, Reading: e.Reading, Library: library.New(pool), Config: o.Cfg,
		Pool: pool, Jobs: e.Queue, Scanner: e.Scanner, Metadata: meta, Enricher: &metadata.Enricher{Service: meta, Providers: providers, CacheTTL: o.ProviderCacheTTL, Now: clock.Now}, Importer: e.Importer, Writeback: e.Writeback, Covers: e.Covers, Integrations: e.Integrations, KOReader: e.KOReader, Delivery: e.Delivery}})
	e.Handler = h
	srv.Config.Handler = h
	srv.Start()
	e.Server = srv
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

// Proto sends a request to a root-mounted protocol route (OPDS, KOReader): the
// path is used as given, with no /api/v1 prefix. Headers are key/value pairs.
func (e *Env) Proto(method, path string, body []byte, hdr ...string) Response {
	e.T.Helper()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, e.Server.URL+path, rd)
	if err != nil {
		e.T.Fatal(err)
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

// DrainScans returns and clears the queued scan run IDs.
func (q *Queue) DrainScans() []uuid.UUID {
	q.mu.Lock()
	defer q.mu.Unlock()
	ids := q.Scans
	q.Scans = nil
	return ids
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

// DeliveryQueue records scheduled delivery jobs so tests drive the worker
// deterministically with the controllable clock instead of waiting on River.
type DeliveryQueue struct {
	mu    sync.Mutex
	items []scheduled
}

type scheduled struct {
	ID    uuid.UUID
	At    time.Time
	Added time.Time // wall clock, so a pump can wait for the enqueuing request to commit
}

func (q *DeliveryQueue) Schedule(_ context.Context, _ pgx.Tx, id uuid.UUID, at time.Time) error {
	q.mu.Lock()
	q.items = append(q.items, scheduled{ID: id, At: at, Added: time.Now()})
	q.mu.Unlock()
	return nil
}

// Len returns how many jobs are scheduled and not yet run.
func (q *DeliveryQueue) Len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.items)
}

// Count returns how many jobs were scheduled for id.
func (q *DeliveryQueue) Count(id uuid.UUID) int {
	q.mu.Lock()
	defer q.mu.Unlock()
	n := 0
	for _, it := range q.items {
		if it.ID == id {
			n++
		}
	}
	return n
}

// RunDeliveries runs every scheduled job that is due at the test clock once and
// returns how many ran. Jobs scheduled while running are kept for a later call.
func (e *Env) RunDeliveries() int {
	e.T.Helper()
	q := e.DQ
	q.mu.Lock()
	var due, later []scheduled
	for _, it := range q.items {
		if !it.At.After(e.Clock.Now()) {
			due = append(due, it)
		} else {
			later = append(later, it)
		}
	}
	q.items = later
	q.mu.Unlock()
	for _, it := range due {
		if err := e.Delivery.Process(context.Background(), it.ID); err != nil {
			e.T.Fatalf("process delivery %s: %v", it.ID, err)
		}
	}
	return len(due)
}

// ProcessSettledDeliveries runs due delivery jobs that were scheduled at least
// settle ago (wall clock). The job is recorded before the enqueuing request's
// transaction commits, so a pump must give the request time to finish. Errors are
// ignored: this is for long-running servers used by browser tests, which assert on
// the visible state instead.
func (e *Env) ProcessSettledDeliveries(ctx context.Context, settle time.Duration) {
	q := e.DQ
	q.mu.Lock()
	var due, keep []scheduled
	for _, it := range q.items {
		if !it.At.After(e.Clock.Now()) && time.Since(it.Added) >= settle {
			due = append(due, it)
		} else {
			keep = append(keep, it)
		}
	}
	q.items = keep
	q.mu.Unlock()
	for _, it := range due {
		_ = e.Delivery.Process(ctx, it.ID)
	}
}
