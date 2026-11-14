package jobs

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/importer"
	"github.com/deranjer/ebooker/apps/server/internal/ingest"
)

// Queue names for T004 work.
const QueueScan = "scan"

// ScanArgs wakes the scanner for one persisted scan run. Business state lives
// in scan_runs, never in the queue (user decision 2026-11-13, ADR-0024).
type ScanArgs struct {
	RunID string `json:"run_id"`
}

func (ScanArgs) Kind() string { return "scan_library" }

// DueArgs asks the scheduler to start scans that are due.
type DueArgs struct{}

func (DueArgs) Kind() string { return "scan_due" }

// Enqueuer is the narrow surface T004 code uses to reach the job system. The
// only implementation today is River; swapping it must not touch callers.
type Enqueuer interface {
	// EnqueueScan inserts the wake-up for runID inside tx, so the run row and
	// its job commit or roll back together.
	EnqueueScan(ctx context.Context, tx pgx.Tx, runID uuid.UUID) error
	// EnqueueImport does the same for an approved import plan.
	EnqueueImport(ctx context.Context, tx pgx.Tx, planID uuid.UUID) error
}

// RiverEnqueuer is the River-backed Enqueuer.
type RiverEnqueuer struct {
	Client      *river.Client[pgx.Tx]
	MaxAttempts int
}

func (r RiverEnqueuer) EnqueueScan(ctx context.Context, tx pgx.Tx, runID uuid.UUID) error {
	_, err := r.Client.InsertTx(ctx, tx, ScanArgs{RunID: runID.String()}, &river.InsertOpts{Queue: QueueScan, MaxAttempts: r.MaxAttempts})
	return err
}

// RequestScan creates a scan run (if none is active for the library) and
// enqueues it atomically. created is false when a run is already active.
func RequestScan(ctx context.Context, pool *pgxpool.Pool, enq Enqueuer, library uuid.UUID, trigger string) (run sqlcgen.ScanRun, created bool, err error) {
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		r, cerr := q.CreateScanRun(ctx, sqlcgen.CreateScanRunParams{LibraryID: library, Trigger: trigger})
		if errors.Is(cerr, pgx.ErrNoRows) {
			return nil // one active scan per library already exists
		}
		if cerr != nil {
			return cerr
		}
		run, created = r, true
		return enq.EnqueueScan(ctx, tx, r.ID)
	})
	return run, created, err
}

// ScanWorker executes one scan run.
type ScanWorker struct {
	river.WorkerDefaults[ScanArgs]
	Scanner *ingest.Scanner
	Logger  *slog.Logger
}

func (w *ScanWorker) Work(ctx context.Context, job *river.Job[ScanArgs]) error {
	id, err := uuid.Parse(job.Args.RunID)
	if err != nil {
		return river.JobCancel(err)
	}
	out, err := w.Scanner.Run(ctx, id)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err() // resumed by the next process; the run stays active
		}
		// Scanner.Run recorded the failure on the run row; the next schedule starts a fresh run.
		w.Logger.Warn("scan failed", "run_id", job.Args.RunID, "error", err)
		return nil
	}
	w.Logger.Info("scan finished", "run_id", job.Args.RunID, "health", out.Health, "seen", out.FilesSeen,
		"added", out.Added, "moved", out.Moved, "replaced", out.Replaced, "pending", out.Pending, "absent", out.Absent)
	return nil
}

// SchedulerWorker starts scans and verification passes that are due.
type SchedulerWorker struct {
	river.WorkerDefaults[DueArgs]
	Pool   *pgxpool.Pool
	Enq    Enqueuer
	Logger *slog.Logger
	Now    func() time.Time
}

func (w *SchedulerWorker) Work(ctx context.Context, _ *river.Job[DueArgs]) error {
	now := time.Now().UTC()
	if w.Now != nil {
		now = w.Now().UTC()
	}
	q := sqlcgen.New(w.Pool)
	due, err := q.ListDueLibraries(ctx, now)
	if err != nil {
		return err
	}
	for _, lib := range due {
		if _, _, err := RequestScan(ctx, w.Pool, w.Enq, lib, "schedule"); err != nil {
			return err
		}
	}
	verify, err := q.ListDueVerification(ctx, now)
	if err != nil {
		return err
	}
	for _, lib := range verify {
		if _, _, err := RequestScan(ctx, w.Pool, w.Enq, lib, "verify"); err != nil {
			return err
		}
	}
	return nil
}

// ScanPeriodic is the once-a-minute scheduler tick.
func ScanPeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(time.Minute),
		func() (river.JobArgs, *river.InsertOpts) {
			return DueArgs{}, &river.InsertOpts{Queue: QueueScan, MaxAttempts: 1}
		},
		&river.PeriodicJobOpts{RunOnStart: true})
}

// QueueImport is the queue for approved import copies.
const QueueImport = "import"

// ImportArgs wakes the importer for one approved plan.
type ImportArgs struct {
	PlanID string `json:"plan_id"`
}

func (ImportArgs) Kind() string { return "import_execute" }

func (r RiverEnqueuer) EnqueueImport(ctx context.Context, tx pgx.Tx, planID uuid.UUID) error {
	_, err := r.Client.InsertTx(ctx, tx, ImportArgs{PlanID: planID.String()}, &river.InsertOpts{Queue: QueueImport, MaxAttempts: r.MaxAttempts})
	return err
}

// ImportWorker copies an approved plan; Execute is resumable, so a retry after a
// crash finishes the remaining items.
type ImportWorker struct {
	river.WorkerDefaults[ImportArgs]
	Importer *importer.Service
	Logger   *slog.Logger
}

func (w *ImportWorker) Work(ctx context.Context, job *river.Job[ImportArgs]) error {
	id, err := uuid.Parse(job.Args.PlanID)
	if err != nil {
		return river.JobCancel(err)
	}
	if err := w.Importer.Execute(ctx, id); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		w.Logger.Warn("import failed", "plan_id", job.Args.PlanID, "error", err)
		return err
	}
	return nil
}
