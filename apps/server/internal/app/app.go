// Package app composes configuration, database, workers and HTTP.
package app

import (
	"context"
	"fmt"
	"github.com/deranjer/ebooker/apps/server/internal/importer"
	"github.com/deranjer/ebooker/apps/server/internal/ingest"
	"github.com/google/uuid"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/deranjer/ebooker/apps/server/internal/config"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/jobs"
)

// NewInspector builds the ffprobe wrapper from configuration.
func NewInspector(cfg *config.Config) *inspect.Inspector {
	return inspect.New(inspect.Config{
		ProbePath: cfg.FFprobePath, Timeout: cfg.InspectTimeout,
		MaxOutputBytes: cfg.MaxProbeOutput, MediaRoot: cfg.MediaRoot,
	})
}

// WorkerOptions are the knobs the server and tests share.
type WorkerOptions struct {
	Workers          int
	MaxAttempts      int
	JobTimeout       time.Duration
	RescueStuckAfter time.Duration
	RetryBase        time.Duration
	// FetchPollInterval overrides River's job poll interval (tests use a short one).
	FetchPollInterval time.Duration
	// Scanner enables T004 library scanning (scan queue, scheduler tick). Nil leaves it off.
	Scanner     *ingest.Scanner
	Importer    *importer.Service
	ScanWorkers int
}

func WorkerOptionsFrom(cfg *config.Config) WorkerOptions {
	return WorkerOptions{
		Workers: cfg.InspectWorkers, MaxAttempts: cfg.InspectMaxAttempts,
		// Leave headroom over the per-process deadline so ffprobe's own
		// timeout classification wins over River's generic job timeout.
		JobTimeout:       cfg.InspectTimeout + 30*time.Second,
		RescueStuckAfter: cfg.RescueStuckAfter,
	}
}

// NewWorkerClient builds a River client that processes inspection jobs.
func NewWorkerClient(pool *pgxpool.Pool, insp jobs.Inspector, opts WorkerOptions, log *slog.Logger) (*river.Client[pgx.Tx], error) {
	workers := river.NewWorkers()
	river.AddWorker(workers, &jobs.InspectWorker{Pool: pool, Inspector: insp, Logger: log, RetryBase: opts.RetryBase})
	queues := map[string]river.QueueConfig{jobs.QueueInspect: {MaxWorkers: opts.Workers}}
	var periodic []*river.PeriodicJob
	var client *river.Client[pgx.Tx]
	if opts.Scanner != nil {
		n := opts.ScanWorkers
		if n < 1 {
			n = 2
		}
		queues[jobs.QueueScan] = river.QueueConfig{MaxWorkers: n}
		queues[jobs.QueueImport] = river.QueueConfig{MaxWorkers: 1}
		pe := &lateEnqueuer{}
		river.AddWorker(workers, &jobs.ScanWorker{Scanner: opts.Scanner, Logger: log})
		river.AddWorker(workers, &jobs.SchedulerWorker{Pool: pool, Enq: pe, Logger: log})
		if opts.Importer != nil {
			river.AddWorker(workers, &jobs.ImportWorker{Importer: opts.Importer, Logger: log})
		}
		periodic = append(periodic, jobs.ScanPeriodic())
		defer func() { pe.client = client }()
	}
	cfg := &river.Config{
		Logger:                      log,
		Workers:                     workers,
		Queues:                      queues,
		PeriodicJobs:                periodic,
		MaxAttempts:                 opts.MaxAttempts,
		JobTimeout:                  opts.JobTimeout,
		RescueStuckJobsAfter:        opts.RescueStuckAfter,
		FetchPollInterval:           opts.FetchPollInterval,
		JobCleanerTimeout:           30 * time.Second,
		CompletedJobRetentionPeriod: 24 * time.Hour,
	}
	var err error
	client, err = river.NewClient(riverpgxv5.New(pool), cfg)
	return client, err
}

// lateEnqueuer resolves the River client after construction (the scheduler worker
// is registered before the client exists).
type lateEnqueuer struct{ client *river.Client[pgx.Tx] }

func (l *lateEnqueuer) EnqueueScan(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	return jobs.RiverEnqueuer{Client: l.client}.EnqueueScan(ctx, tx, id)
}

func (l *lateEnqueuer) EnqueueImport(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	return jobs.RiverEnqueuer{Client: l.client}.EnqueueImport(ctx, tx, id)
}

// NewInsertClient builds an insert-only client (no workers) for submitters
// such as the diagnostic command.
func NewInsertClient(pool *pgxpool.Pool) (*river.Client[pgx.Tx], error) {
	c, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		return nil, fmt.Errorf("create insert client: %w", err)
	}
	return c, nil
}
