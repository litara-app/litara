package jobs

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
)

// CSV import of paper books (ADR-0117). The state is in paper_imports; the job only wakes the worker.

// PaperImportArgs wakes the worker for one applied import.
type PaperImportArgs struct {
	ImportID string `json:"import_id"`
}

func (PaperImportArgs) Kind() string { return "paper_import" }

func (r RiverEnqueuer) EnqueuePaperImport(ctx context.Context, tx pgx.Tx, importID uuid.UUID) error {
	_, err := r.Client.InsertTx(ctx, tx, PaperImportArgs{ImportID: importID.String()}, &river.InsertOpts{Queue: QueueImport, MaxAttempts: r.MaxAttempts})
	return err
}

// PaperImporter applies and expires imports.
type PaperImporter interface {
	RunPaperImport(ctx context.Context, id uuid.UUID) error
	ExpirePaperImports(ctx context.Context) (int64, error)
}

// PaperImportWorker applies an import; each row is applied once, so a retry finishes the rest.
type PaperImportWorker struct {
	river.WorkerDefaults[PaperImportArgs]
	Importer PaperImporter
	Logger   *slog.Logger
}

// Timeout allows a large file more time than the default job limit.
func (w *PaperImportWorker) Timeout(*river.Job[PaperImportArgs]) time.Duration {
	return 30 * time.Minute
}

func (w *PaperImportWorker) Work(ctx context.Context, job *river.Job[PaperImportArgs]) error {
	id, err := uuid.Parse(job.Args.ImportID)
	if err != nil {
		return river.JobCancel(err)
	}
	if err := w.Importer.RunPaperImport(ctx, id); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		w.Logger.Warn("paper import failed", "import_id", job.Args.ImportID, "error", err)
		return err
	}
	return nil
}

// PaperExpiryArgs deletes unapplied imports whose time is up, so their private text goes even if nobody looks.
type PaperExpiryArgs struct{}

func (PaperExpiryArgs) Kind() string { return "paper_import_expiry" }

type PaperExpiryWorker struct {
	river.WorkerDefaults[PaperExpiryArgs]
	Importer PaperImporter
}

func (w *PaperExpiryWorker) Work(ctx context.Context, _ *river.Job[PaperExpiryArgs]) error {
	_, err := w.Importer.ExpirePaperImports(ctx)
	return err
}

// PaperExpiryPeriodic runs the expiry every hour.
func PaperExpiryPeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(time.Hour),
		func() (river.JobArgs, *river.InsertOpts) {
			return PaperExpiryArgs{}, &river.InsertOpts{Queue: QueueImport, MaxAttempts: 1}
		},
		&river.PeriodicJobOpts{RunOnStart: true})
}
