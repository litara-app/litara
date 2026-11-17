package jobs

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
)

// QueueExtract runs bounded comic page extraction (ADR-0067). The server runs
// at most two at once; the queue and the extractor semaphore agree.
const QueueExtract = "comic_extract"

// ExtractArgs wakes the extractor for one persisted extraction row. Business
// state lives in comic_extractions, never in the queue.
type ExtractArgs struct {
	ExtractionID string `json:"extraction_id"`
}

func (ExtractArgs) Kind() string { return "comic_extract" }

func (r RiverEnqueuer) EnqueueExtract(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	_, err := r.Client.InsertTx(ctx, tx, ExtractArgs{ExtractionID: id.String()}, &river.InsertOpts{Queue: QueueExtract, MaxAttempts: r.MaxAttempts})
	return err
}

// Extractor runs one extraction row to a terminal state.
type Extractor interface {
	RunExtraction(ctx context.Context, id uuid.UUID) error
}

type ExtractWorker struct {
	river.WorkerDefaults[ExtractArgs]
	Extractor Extractor
	Logger    *slog.Logger
}

func (w *ExtractWorker) Work(ctx context.Context, job *river.Job[ExtractArgs]) error {
	id, err := uuid.Parse(job.Args.ExtractionID)
	if err != nil {
		return river.JobCancel(err)
	}
	if err := w.Extractor.RunExtraction(ctx, id); err != nil {
		if ctx.Err() != nil {
			return ctx.Err() // the next process resumes it; the row stays processing
		}
		w.Logger.Warn("comic extraction failed", "id", job.Args.ExtractionID, "error", err)
	}
	return nil
}
