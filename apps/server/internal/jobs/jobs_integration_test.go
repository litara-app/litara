package jobs_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/deranjer/ebooker/apps/server/internal/app"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/jobs"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func fastOpts(workers, attempts int) app.WorkerOptions {
	return app.WorkerOptions{
		Workers: workers, MaxAttempts: attempts, JobTimeout: time.Minute,
		RescueStuckAfter: time.Minute, RetryBase: time.Millisecond,
		FetchPollInterval: 100 * time.Millisecond,
	}
}

func realInspector(t *testing.T) *inspect.Inspector {
	return inspect.New(inspect.Config{ProbePath: testutil.Tool(t, "ffprobe"), Timeout: 30 * time.Second})
}

func startWorkers(t *testing.T, pool *pgxpool.Pool, insp jobs.Inspector, o app.WorkerOptions) *river.Client[pgx.Tx] {
	t.Helper()
	c, err := app.NewWorkerClient(pool, insp, o, quiet)
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = c.StopAndCancel(ctx)
	})
	return c
}

func submitter(t *testing.T, pool *pgxpool.Pool, attempts int) *jobs.Submitter {
	t.Helper()
	c, err := app.NewInsertClient(pool)
	if err != nil {
		t.Fatal(err)
	}
	return &jobs.Submitter{Pool: pool, Client: c, MaxAttempts: attempts}
}

func waitState(t *testing.T, pool *pgxpool.Pool, id uuid.UUID, states ...string) sqlcgen.InspectionRequest {
	t.Helper()
	q := sqlcgen.New(pool)
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		r, err := q.GetInspectionRequest(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range states {
			if r.State == s {
				return r
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	r, _ := q.GetInspectionRequest(context.Background(), id)
	t.Fatalf("timed out waiting for %v; state=%s outcome=%v attempts=%d", states, r.State, r.Outcome, r.Attempts)
	return r
}

func fixture(t *testing.T, name string, secs int) string {
	p := filepath.Join(t.TempDir(), name)
	testutil.FFmpeg(t, append(testutil.Sine(secs), "-c:a", "aac", "-f", "ipod", p)...)
	return p
}

func outcome(r sqlcgen.InspectionRequest) string {
	if r.Outcome == nil {
		return ""
	}
	return *r.Outcome
}

func TestDurableSubmissionToPersistedResult(t *testing.T) {
	pool := testutil.MigratedDatabase(t)
	p := fixture(t, "book one.m4b", 3)
	res, err := submitter(t, pool, 3).Submit(context.Background(), p, false)
	if err != nil || !res.Created || !res.Enqueued {
		t.Fatalf("submit: %+v %v", res, err)
	}
	// Persisted before any worker exists: the request survives with no process.
	if res.Request.State != "queued" {
		t.Fatalf("state %s", res.Request.State)
	}
	startWorkers(t, pool, realInspector(t), fastOpts(2, 3))
	r := waitState(t, pool, res.Request.ID, "completed", "failed")
	if r.State != "completed" || outcome(r) != "ok" {
		t.Fatalf("%+v", r)
	}
	row, err := sqlcgen.New(pool).GetInspectionResult(context.Background(), r.ID)
	if err != nil {
		t.Fatal(err)
	}
	var got inspect.Result
	if err := json.Unmarshal(row.Result, &got); err != nil {
		t.Fatal(err)
	}
	if got.Format.DurationMs == nil || *got.Format.DurationMs < 2700 || row.Completeness != "complete" {
		t.Fatalf("result: %+v / %s", got.Format, row.Completeness)
	}
}

func TestSubmitIsAtomicAndIdempotent(t *testing.T) {
	pool := testutil.MigratedDatabase(t)
	p := fixture(t, "dup.m4a", 1)
	sub := submitter(t, pool, 3)

	var wg sync.WaitGroup
	results := make([]*jobs.SubmitResult, 8)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, err := sub.Submit(context.Background(), p, false)
			if err != nil {
				t.Error(err)
				return
			}
			results[i] = r
		}()
	}
	wg.Wait()
	created, enqueued := 0, 0
	for _, r := range results {
		if r == nil {
			t.FailNow()
		}
		if r.Request.ID != results[0].Request.ID {
			t.Fatal("concurrent submissions produced different requests")
		}
		if r.Created {
			created++
		}
		if r.Enqueued {
			enqueued++
		}
	}
	if created != 1 || enqueued != 1 {
		t.Fatalf("created=%d enqueued=%d, want 1/1", created, enqueued)
	}
	var jobsCount, reqCount int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM river_job WHERE kind = 'inspect_file'`).Scan(&jobsCount)
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM inspection_requests`).Scan(&reqCount)
	if jobsCount != 1 || reqCount != 1 {
		t.Fatalf("jobs=%d requests=%d", jobsCount, reqCount)
	}

	startWorkers(t, pool, realInspector(t), fastOpts(2, 3))
	waitState(t, pool, results[0].Request.ID, "completed")
	// Re-submission after completion keeps the one coherent result.
	again, err := sub.Submit(context.Background(), p, false)
	if err != nil || again.Enqueued || again.Request.State != "completed" {
		t.Fatalf("resubmit: %+v %v", again, err)
	}
	var results1 int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM inspection_results`).Scan(&results1)
	if results1 != 1 {
		t.Fatalf("results=%d", results1)
	}
	// Explicit reinspect re-runs the same logical request.
	re, err := sub.Submit(context.Background(), p, true)
	if err != nil || !re.Enqueued || re.Created || re.Request.ID != results[0].Request.ID {
		t.Fatalf("reinspect: %+v %v", re, err)
	}
	waitState(t, pool, re.Request.ID, "completed")
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM inspection_results`).Scan(&results1)
	if results1 != 1 {
		t.Fatalf("results after reinspect=%d", results1)
	}
}

// blockingInspector blocks until released or cancelled, counting concurrency.
type blockingInspector struct {
	started chan string
	release chan struct{}
	cur     atomic.Int32
	max     atomic.Int32
	real    jobs.Inspector
}

func (b *blockingInspector) Inspect(ctx context.Context, path string) (*inspect.Result, error) {
	n := b.cur.Add(1)
	defer b.cur.Add(-1)
	for {
		m := b.max.Load()
		if n <= m || b.max.CompareAndSwap(m, n) {
			break
		}
	}
	select {
	case b.started <- path:
	default:
	}
	select {
	case <-b.release:
	case <-ctx.Done():
		return nil, &inspect.Error{Outcome: inspect.OutcomeCancelled, Message: "cancelled"}
	}
	return b.real.Inspect(ctx, path)
}

func TestWorkerConcurrencyBound(t *testing.T) {
	pool := testutil.MigratedDatabase(t)
	insp := &blockingInspector{started: make(chan string, 32), release: make(chan struct{}), real: realInspector(t)}
	sub := submitter(t, pool, 3)
	var ids []uuid.UUID
	dir := t.TempDir()
	for i := 0; i < 8; i++ {
		p := filepath.Join(dir, "f"+string(rune('a'+i))+".m4a")
		testutil.FFmpeg(t, append(testutil.Sine(1), "-c:a", "aac", p)...)
		r, err := sub.Submit(context.Background(), p, false)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, r.Request.ID)
	}
	startWorkers(t, pool, insp, fastOpts(2, 3))
	<-insp.started
	<-insp.started
	time.Sleep(700 * time.Millisecond) // give a buggy implementation time to exceed the bound
	if got := insp.cur.Load(); got != 2 {
		t.Fatalf("concurrent executions = %d, want exactly 2 while 8 are queued", got)
	}
	close(insp.release)
	for _, id := range ids {
		waitState(t, pool, id, "completed")
	}
	if m := insp.max.Load(); m != 2 {
		t.Fatalf("max concurrency observed %d, want 2", m)
	}
}

func TestGracefulInterruptionRequeuesAndResumes(t *testing.T) {
	pool := testutil.MigratedDatabase(t)
	p := fixture(t, "resume.m4b", 2)
	res, err := submitter(t, pool, 5).Submit(context.Background(), p, false)
	if err != nil {
		t.Fatal(err)
	}
	insp := &blockingInspector{started: make(chan string, 4), release: make(chan struct{}), real: realInspector(t)}
	c1, err := app.NewWorkerClient(pool, insp, fastOpts(1, 5), quiet)
	if err != nil {
		t.Fatal(err)
	}
	if err := c1.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	<-insp.started
	waitState(t, pool, res.Request.ID, "running")

	// "Process 1" is stopped hard mid-inspection.
	sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := c1.StopAndCancel(sctx); err != nil {
		t.Fatal(err)
	}
	r, _ := sqlcgen.New(pool).GetInspectionRequest(context.Background(), res.Request.ID)
	if r.State != "queued" || outcome(r) != "cancelled" {
		t.Fatalf("after interrupt state=%s outcome=%s", r.State, outcome(r))
	}

	// "Process 2" resumes the same logical request.
	startWorkers(t, pool, realInspector(t), fastOpts(1, 5))
	done := waitState(t, pool, res.Request.ID, "completed", "failed")
	if done.State != "completed" || done.Attempts < 2 {
		t.Fatalf("%+v", done)
	}
	var n int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM inspection_results`).Scan(&n)
	if n != 1 {
		t.Fatalf("results=%d", n)
	}
}

func TestCrashedRunningJobIsRescued(t *testing.T) {
	pool := testutil.MigratedDatabase(t)
	p := fixture(t, "crash.m4b", 2)
	res, err := submitter(t, pool, 5).Submit(context.Background(), p, false)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	// Simulate a process that was killed (no cleanup) while running the job:
	// River shows it running with an old attempt, and the request is running.
	if _, err := pool.Exec(ctx, `UPDATE river_job SET state='running', attempt=1, attempted_at=now()-interval '1 hour',
		attempted_by=ARRAY['dead-process'] WHERE kind='inspect_file'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE inspection_requests SET state='running', attempts=1, started_at=now()-interval '1 hour'`); err != nil {
		t.Fatal(err)
	}
	o := fastOpts(1, 5)
	o.JobTimeout, o.RescueStuckAfter = 2*time.Second, 3*time.Second // River requires rescue >= job timeout
	startWorkers(t, pool, realInspector(t), o)
	done := waitState(t, pool, res.Request.ID, "completed", "failed")
	if done.State != "completed" || outcome(done) != "ok" {
		t.Fatalf("%+v", done)
	}
}

type scripted struct {
	calls atomic.Int32
	err   error
}

func (s *scripted) Inspect(context.Context, string) (*inspect.Result, error) {
	s.calls.Add(1)
	return nil, s.err
}

func TestRetryPolicyIsOperationSpecific(t *testing.T) {
	pool := testutil.MigratedDatabase(t)
	dir := t.TempDir()
	transient, permanent := filepath.Join(dir, "t.m4a"), filepath.Join(dir, "p.m4a")
	for _, p := range []string{transient, permanent} {
		if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	sub := submitter(t, pool, 3)
	tr, _ := sub.Submit(context.Background(), transient, false)
	pe, _ := sub.Submit(context.Background(), permanent, false)

	insp := &routing{
		transient: &scripted{err: &inspect.Error{Outcome: inspect.OutcomeTimeout, Retryable: true, Message: "slow share"}},
		permanent: &scripted{err: &inspect.Error{Outcome: inspect.OutcomeMalformedMedia, Message: "bad data"}},
		tPath:     transient,
	}
	startWorkers(t, pool, insp, fastOpts(2, 3))

	p := waitState(t, pool, pe.Request.ID, "failed")
	if outcome(p) != "malformed_media" || insp.permanent.calls.Load() != 1 {
		t.Fatalf("permanent failure retried: calls=%d %+v", insp.permanent.calls.Load(), p)
	}
	tt := waitState(t, pool, tr.Request.ID, "failed")
	if outcome(tt) != "timeout" || insp.transient.calls.Load() != 3 || tt.Attempts != 3 {
		t.Fatalf("transient: calls=%d attempts=%d outcome=%s", insp.transient.calls.Load(), tt.Attempts, outcome(tt))
	}
	if tt.FailureMessage == nil || len(*tt.FailureMessage) > 600 {
		t.Fatal("failure message missing or unbounded")
	}
}

type routing struct {
	transient, permanent *scripted
	tPath                string
}

func (r *routing) Inspect(ctx context.Context, path string) (*inspect.Result, error) {
	if path == r.tPath {
		return r.transient.Inspect(ctx, path)
	}
	return r.permanent.Inspect(ctx, path)
}

func TestMissingAndIncompleteOutcomesPersisted(t *testing.T) {
	pool := testutil.MigratedDatabase(t)
	dir := t.TempDir()
	sub := submitter(t, pool, 3)
	missing, _ := sub.Submit(context.Background(), filepath.Join(dir, "gone.mp3"), false)

	// A file with video only: container parses, no audio → inspection-incomplete.
	vid := filepath.Join(dir, "silent.mp4")
	testutil.FFmpeg(t, "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1", "-pix_fmt", "yuv420p", vid)
	inc, _ := sub.Submit(context.Background(), vid, false)

	startWorkers(t, pool, realInspector(t), fastOpts(2, 3))
	m := waitState(t, pool, missing.Request.ID, "failed")
	if outcome(m) != "missing_input" || m.Attempts != 1 {
		t.Fatalf("%+v", m)
	}
	i := waitState(t, pool, inc.Request.ID, "completed")
	if outcome(i) != "incomplete" {
		t.Fatalf("outcome %s", outcome(i))
	}
	row, err := sqlcgen.New(pool).GetInspectionResult(context.Background(), i.ID)
	if err != nil || row.Completeness != "incomplete" {
		t.Fatalf("%+v %v", row, err)
	}
}

func TestSubmitRejectsRelativePath(t *testing.T) {
	pool := testutil.MigratedDatabase(t)
	if _, err := submitter(t, pool, 3).Submit(context.Background(), "rel/path.mp3", false); err == nil {
		t.Fatal("expected error")
	}
	_ = errors.New
}
