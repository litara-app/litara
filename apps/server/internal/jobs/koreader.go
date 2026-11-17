package jobs

import (
	"context"
	"log/slog"
	"time"

	"github.com/riverqueue/river"
)

// QueueKOReader holds the bounded KOReader digest indexing sweeps.
const QueueKOReader = "koreader"

// DigestIndexer indexes unindexed current ebook/comic files in a bounded batch.
type DigestIndexer interface {
	IndexPending(ctx context.Context, limit int) (int, error)
}

// KODigestArgs is the periodic sweep job. Indexing is durable (PostgreSQL via
// River) and never runs on an HTTP request path (ADR-0075).
type KODigestArgs struct{}

func (KODigestArgs) Kind() string { return "koreader_digest_sweep" }

// KODigestWorker indexes one bounded batch per run.
type KODigestWorker struct {
	river.WorkerDefaults[KODigestArgs]
	Indexer DigestIndexer
	Logger  *slog.Logger
}

func (w *KODigestWorker) Work(ctx context.Context, _ *river.Job[KODigestArgs]) error {
	n, err := w.Indexer.IndexPending(ctx, 25)
	if err != nil {
		return err
	}
	if n > 0 && w.Logger != nil {
		w.Logger.Info("koreader digests indexed", "files", n)
	}
	return nil
}

// KODigestPeriodic runs one sweep a minute.
func KODigestPeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(time.Minute),
		func() (river.JobArgs, *river.InsertOpts) {
			return KODigestArgs{}, &river.InsertOpts{Queue: QueueKOReader, MaxAttempts: 1}
		},
		&river.PeriodicJobOpts{RunOnStart: true})
}
