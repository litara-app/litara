// Package app composes configuration, database, workers and HTTP.
package app

import (
	"fmt"
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
	cfg := &river.Config{
		Logger:  log,
		Workers: workers,
		Queues: map[string]river.QueueConfig{
			jobs.QueueInspect: {MaxWorkers: opts.Workers},
		},
		MaxAttempts:                 opts.MaxAttempts,
		JobTimeout:                  opts.JobTimeout,
		RescueStuckJobsAfter:        opts.RescueStuckAfter,
		FetchPollInterval:           opts.FetchPollInterval,
		JobCleanerTimeout:           30 * time.Second,
		CompletedJobRetentionPeriod: 24 * time.Hour,
	}
	return river.NewClient(riverpgxv5.New(pool), cfg)
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
