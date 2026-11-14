package jobs_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/app"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/ingest"
	"github.com/deranjer/ebooker/apps/server/internal/jobs"
	"github.com/deranjer/ebooker/apps/server/internal/library"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// A scan requested through the job system runs, is serialized per library by
// our own unique constraint, and survives being requested while active.
func TestScanRunsThroughRiverAndIsSerializedPerLibrary(t *testing.T) {
	pool := testutil.MigratedDatabase(t)
	ctx := context.Background()
	root := t.TempDir()
	testutil.FFmpeg(t, append(testutil.Sine(1), "-c:a", "libmp3lame", filepath.Join(root, "a.mp3"))...)

	d, err := library.New(pool).Create(ctx, wire.CreateLibrary{Name: "Jobs", Config: wire.LibraryConfig{
		Mode: "index", RootPath: root, ScanIntervalSecs: 900, VerifyIntervalSecs: 86400, StabilitySecs: 1, ProviderOrder: []string{}}})
	if err != nil {
		t.Fatal(err)
	}
	lib := uuid.MustParse(d.Library.ID)

	scanner := &ingest.Scanner{Pool: pool, Inspector: realInspector(t)}
	o := fastOpts(1, 3)
	o.Scanner = scanner
	client := startWorkers(t, pool, realInspector(t), o)
	enq := jobs.RiverEnqueuer{Client: client, MaxAttempts: 3}

	first, created, err := jobs.RequestScan(ctx, pool, enq, lib, "manual")
	if err != nil || !created {
		t.Fatalf("first request: created=%v err=%v", created, err)
	}
	if _, again, err := jobs.RequestScan(ctx, pool, enq, lib, "manual"); err != nil || again {
		t.Fatalf("second request while active must not create a run: created=%v err=%v", again, err)
	}
	q := sqlcgen.New(pool)
	waitRun := func(id uuid.UUID) sqlcgen.ScanRun {
		deadline := time.Now().Add(45 * time.Second)
		for time.Now().Before(deadline) {
			r, err := q.GetScanRun(ctx, id)
			if err != nil {
				t.Fatal(err)
			}
			if r.State == "completed" || r.State == "failed" {
				return r
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatal("scan run did not finish")
		return sqlcgen.ScanRun{}
	}
	if r := waitRun(first.ID); r.State != "completed" || r.Health == nil || *r.Health != "healthy" || r.FilesSeen != 1 {
		t.Fatalf("run: %+v", r)
	}

	// The file is cataloged by the second scan (stability window is 1s here).
	time.Sleep(1200 * time.Millisecond)
	second, created, err := jobs.RequestScan(ctx, pool, enq, lib, "manual")
	if err != nil || !created {
		t.Fatalf("second run: %v %v", created, err)
	}
	waitRun(second.ID)
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM file_observations WHERE library_id=$1`, lib).Scan(&n)
	if n != 1 {
		t.Fatalf("expected 1 cataloged file, got %d", n)
	}
	_ = os.Remove(filepath.Join(root, "a.mp3"))
	_ = app.WorkerOptions{}
}

func TestSchedulerStartsOnlyDueLibraries(t *testing.T) {
	pool := testutil.MigratedDatabase(t)
	ctx := context.Background()
	mk := func(name string) uuid.UUID {
		d, err := library.New(pool).Create(ctx, wire.CreateLibrary{Name: name, Config: wire.LibraryConfig{
			Mode: "index", RootPath: t.TempDir(), ScanIntervalSecs: 900, VerifyIntervalSecs: 86400, StabilitySecs: 30, ProviderOrder: []string{}}})
		if err != nil {
			t.Fatal(err)
		}
		return uuid.MustParse(d.Library.ID)
	}
	a, b := mk("A"), mk("B")
	q := sqlcgen.New(pool)
	now := time.Now().UTC()

	// B was scanned (and verified) a minute ago: not due. A has never run.
	if _, err := q.CreateScanRun(ctx, sqlcgen.CreateScanRunParams{LibraryID: b, Trigger: "verify"}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE scan_runs SET state='completed', completed_at=now()`); err != nil {
		t.Fatal(err)
	}
	due, err := q.ListDueLibraries(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 1 || due[0] != a {
		t.Fatalf("due scans: %v", due)
	}
	// Later than one interval, B is due again; verification is due for A only.
	due, _ = q.ListDueLibraries(ctx, now.Add(16*time.Minute))
	if len(due) != 2 {
		t.Fatalf("after interval: %v", due)
	}
	dv, _ := q.ListDueVerification(ctx, now)
	if len(dv) != 1 || dv[0] != a {
		t.Fatalf("due verification: %v", dv)
	}
}
