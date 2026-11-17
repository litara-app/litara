package jobs

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
)

// QueueDelivery holds email submission jobs.
const QueueDelivery = "delivery"

// DeliveryProcessor runs one submission attempt for a delivery.
type DeliveryProcessor interface {
	Process(ctx context.Context, id uuid.UUID) error
}

// DeliveryArgs is one delivery attempt. It is inserted with MaxAttempts 1:
// the queue must never retry a submission, because only the delivery ledger
// knows whether a message may already have been accepted (ADR-0074).
type DeliveryArgs struct {
	DeliveryID string `json:"deliveryId"`
}

func (DeliveryArgs) Kind() string { return "email_delivery" }

// DeliveryWorker hands the job to the delivery service.
type DeliveryWorker struct {
	river.WorkerDefaults[DeliveryArgs]
	Processor DeliveryProcessor
	Logger    *slog.Logger
}

func (w *DeliveryWorker) Work(ctx context.Context, job *river.Job[DeliveryArgs]) error {
	id, err := uuid.Parse(job.Args.DeliveryID)
	if err != nil {
		return river.JobCancel(err)
	}
	if err := w.Processor.Process(ctx, id); err != nil {
		if w.Logger != nil {
			w.Logger.Error("delivery attempt failed", "delivery_id", id, "error", err.Error())
		}
		return err
	}
	return nil
}

// RiverDeliveryScheduler inserts delivery jobs inside the caller's transaction.
// Client is set after the worker client exists (the worker needs the service).
type RiverDeliveryScheduler struct{ Client *river.Client[pgx.Tx] }

func (r *RiverDeliveryScheduler) Schedule(ctx context.Context, tx pgx.Tx, id uuid.UUID, at time.Time) error {
	opts := &river.InsertOpts{Queue: QueueDelivery, MaxAttempts: 1}
	if at.After(time.Now()) {
		opts.ScheduledAt = at
	}
	_, err := r.Client.InsertTx(ctx, tx, DeliveryArgs{DeliveryID: id.String()}, opts)
	return err
}

// DeliveryRecoverer re-drives deliveries whose own job was lost.
type DeliveryRecoverer interface {
	Recover(ctx context.Context, limit int) (int, error)
}

// DeliveryRecoverArgs is the periodic recovery sweep. Submission jobs run with MaxAttempts 1, so a job that is
// discarded or rescued after a crash is never retried by the queue; this sweep lets the delivery ledger decide
// (resume a due request, or settle an interrupted attempt as outcome_unknown) instead of leaving it stuck.
type DeliveryRecoverArgs struct{}

func (DeliveryRecoverArgs) Kind() string { return "email_delivery_recover" }

// DeliveryRecoverWorker runs one bounded sweep.
type DeliveryRecoverWorker struct {
	river.WorkerDefaults[DeliveryRecoverArgs]
	Recoverer DeliveryRecoverer
	Logger    *slog.Logger
}

func (w *DeliveryRecoverWorker) Work(ctx context.Context, _ *river.Job[DeliveryRecoverArgs]) error {
	n, err := w.Recoverer.Recover(ctx, 25)
	if err != nil {
		return err
	}
	if n > 0 && w.Logger != nil {
		w.Logger.Info("deliveries recovered", "count", n)
	}
	return nil
}

// DeliveryRecoverPeriodic runs one sweep a minute, and once at start.
func DeliveryRecoverPeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(time.Minute),
		func() (river.JobArgs, *river.InsertOpts) {
			return DeliveryRecoverArgs{}, &river.InsertOpts{Queue: QueueDelivery, MaxAttempts: 1}
		},
		&river.PeriodicJobOpts{RunOnStart: true})
}
