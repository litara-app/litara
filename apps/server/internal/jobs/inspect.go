// Package jobs wires durable River jobs for media inspection.
//
// Semantics (documented in research/backend/design.md):
//   - One logical request per cleaned absolute path (request_key). Submission
//     inserts the request row and the River job in one transaction.
//   - The request row is the source of truth for state/outcome; River provides
//     delivery, retry scheduling and crash rescue.
//   - Permanent outcomes (missing, malformed, unreadable, output limit) are
//     recorded and the job is cancelled so River does not retry them.
//     Transient outcomes (timeout, I/O error, tool failure/unavailable) retry
//     up to the attempt limit, then are recorded as failed.
//   - Completion writes the result and the terminal state in one transaction;
//     repeated executions after completion are no-ops.
package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
)

// QueueInspect is the River queue used for inspection work.
const QueueInspect = "inspect"

// InspectFileArgs identifies the persisted request to execute. The file path
// lives in the row, so the job payload stays small and carries no secrets.
type InspectFileArgs struct {
	RequestID string `json:"request_id"`
}

func (InspectFileArgs) Kind() string { return "inspect_file" }

// Inspector is the subset of inspect.Inspector that the worker needs.
type Inspector interface {
	Inspect(ctx context.Context, path string) (*inspect.Result, error)
}

// InspectWorker executes inspection jobs.
type InspectWorker struct {
	river.WorkerDefaults[InspectFileArgs]

	Pool      *pgxpool.Pool
	Inspector Inspector
	Logger    *slog.Logger
	// RetryBase scales the retry delay: attempt^2 * RetryBase.
	RetryBase time.Duration
}

func (w *InspectWorker) NextRetry(job *river.Job[InspectFileArgs]) time.Time {
	base := w.RetryBase
	if base <= 0 {
		base = 10 * time.Second
	}
	return time.Now().Add(time.Duration(job.Attempt*job.Attempt) * base)
}

func ptr[T any](v T) *T { return &v }

func parseID(s string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(s); err != nil {
		return id, fmt.Errorf("invalid request id %q: %w", s, err)
	}
	return id, nil
}

func (w *InspectWorker) Work(ctx context.Context, job *river.Job[InspectFileArgs]) error {
	id, err := parseID(job.Args.RequestID)
	if err != nil {
		return river.JobCancel(err)
	}
	q := sqlcgen.New(w.Pool)

	req, err := q.MarkInspectionRunning(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		// Already terminal (completed by an earlier execution) or deleted:
		// a repeated execution must not change the logical result.
		w.Logger.Info("inspection already terminal; skipping", "request_id", job.Args.RequestID)
		return nil
	}
	if err != nil {
		return err // database trouble: let River retry
	}

	res, ierr := w.Inspector.Inspect(ctx, req.SourcePath)
	if ierr == nil {
		return w.complete(ctx, id, res)
	}

	outcome, retryable := inspect.OutcomeOf(ierr)
	msg := ierr.Error()

	if outcome == inspect.OutcomeCancelled || ctx.Err() != nil {
		// Shutdown or job cancellation: put the request back so the next
		// process can resume it. Use a detached context; ours is done.
		dctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = sqlcgen.New(w.Pool).MarkInspectionRetry(dctx, sqlcgen.MarkInspectionRetryParams{
			ID: id, Outcome: ptr(string(inspect.OutcomeCancelled)), FailureMessage: ptr("interrupted before completion"),
		})
		return ctx.Err()
	}

	final := !retryable || job.Attempt >= job.MaxAttempts
	w.Logger.Warn("inspection attempt failed",
		"request_id", job.Args.RequestID, "outcome", outcome, "attempt", job.Attempt,
		"max_attempts", job.MaxAttempts, "retryable", retryable, "final", final)
	if final {
		if err := q.MarkInspectionFailed(ctx, sqlcgen.MarkInspectionFailedParams{
			ID: id, Outcome: ptr(string(outcome)), FailureMessage: ptr(msg),
		}); err != nil {
			return err
		}
		return river.JobCancel(ierr) // recorded; do not retry further
	}
	if err := q.MarkInspectionRetry(ctx, sqlcgen.MarkInspectionRetryParams{
		ID: id, Outcome: ptr(string(outcome)), FailureMessage: ptr(msg),
	}); err != nil {
		return err
	}
	return ierr
}

func (w *InspectWorker) complete(ctx context.Context, id pgtype.UUID, res *inspect.Result) error {
	payload, err := json.Marshal(res)
	if err != nil {
		return river.JobCancel(fmt.Errorf("marshal result: %w", err))
	}
	outcome := inspect.OutcomeOK
	if res.Completeness == inspect.Incomplete {
		outcome = inspect.OutcomeIncomplete
	}
	tx, err := w.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	q := sqlcgen.New(tx)

	n, err := q.MarkInspectionCompleted(ctx, sqlcgen.MarkInspectionCompletedParams{ID: id, Outcome: ptr(string(outcome))})
	if err != nil {
		return err
	}
	if n == 0 {
		return nil // another execution already finished it; keep its result
	}
	if err := q.UpsertInspectionResult(ctx, sqlcgen.UpsertInspectionResultParams{
		RequestID: id, Completeness: string(res.Completeness),
		DurationMs: res.Format.DurationMs, FormatName: ptr(res.Format.Name),
		Result: payload, ToolVersion: ptr(res.Tool.Version),
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RequestKey is the deterministic logical identity of an inspection request.
func RequestKey(path string) string {
	sum := sha256.Sum256([]byte(filepath.Clean(path)))
	return hex.EncodeToString(sum[:])
}

// Submitter creates inspection requests and enqueues their jobs atomically.
type Submitter struct {
	Pool        *pgxpool.Pool
	Client      *river.Client[pgx.Tx]
	MaxAttempts int
}

type SubmitResult struct {
	Request  sqlcgen.InspectionRequest
	Created  bool // a new request row was inserted
	Enqueued bool // a job was enqueued by this call
}

// Submit is idempotent per path. Re-submitting returns the existing request
// without enqueueing unless reinspect is set and the request is terminal.
func (s *Submitter) Submit(ctx context.Context, path string, reinspect bool) (*SubmitResult, error) {
	if !filepath.IsAbs(path) {
		return nil, fmt.Errorf("path must be absolute: %q", path)
	}
	path = filepath.Clean(path)

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := sqlcgen.New(tx)

	out := &SubmitResult{}
	req, err := q.InsertInspectionRequest(ctx, sqlcgen.InsertInspectionRequestParams{
		RequestKey: RequestKey(path), SourcePath: path,
	})
	switch {
	case err == nil:
		out.Request, out.Created, out.Enqueued = req, true, true
	case errors.Is(err, pgx.ErrNoRows): // conflict: logical request exists
		existing, gerr := q.GetInspectionRequestByKey(ctx, RequestKey(path))
		if gerr != nil {
			return nil, gerr
		}
		out.Request = existing
		if reinspect {
			if reset, rerr := q.ResetInspectionRequest(ctx, existing.ID); rerr == nil {
				out.Request, out.Enqueued = reset, true
			} else if !errors.Is(rerr, pgx.ErrNoRows) {
				return nil, rerr
			}
		}
	default:
		return nil, err
	}

	if out.Enqueued {
		_, err := s.Client.InsertTx(ctx, tx, InspectFileArgs{RequestID: out.Request.ID.String()}, &river.InsertOpts{
			Queue: QueueInspect, MaxAttempts: s.MaxAttempts,
		})
		if err != nil {
			return nil, fmt.Errorf("enqueue inspection: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}
