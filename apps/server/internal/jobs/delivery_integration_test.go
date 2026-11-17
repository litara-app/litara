package jobs_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/app"
	"github.com/deranjer/ebooker/apps/server/internal/jobs"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
)

type recordingProcessor struct {
	mu    sync.Mutex
	calls map[uuid.UUID]int
	fail  bool
}

func (r *recordingProcessor) Process(_ context.Context, id uuid.UUID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls[id]++
	if r.fail {
		return errors.New("simulated processing failure")
	}
	return nil
}

func (r *recordingProcessor) count(id uuid.UUID) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls[id]
}

// The queue must never retry a submission: only the delivery ledger knows
// whether a message may already have been accepted (ADR-0074).
func TestDeliveryJobsAreNeverRetriedByTheQueue(t *testing.T) {
	pool := testutil.MigratedDatabase(t)
	proc := &recordingProcessor{calls: map[uuid.UUID]int{}, fail: true}
	opts := fastOpts(1, 5) // the global default would allow five attempts
	opts.Delivery = proc
	c, err := app.NewWorkerClient(pool, realInspector(t), opts, quiet)
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Stop(context.Background()) })
	sched := &jobs.RiverDeliveryScheduler{Client: c}

	insert := func(id uuid.UUID, at time.Time) {
		t.Helper()
		if err := pgx.BeginFunc(context.Background(), pool, func(tx pgx.Tx) error { return sched.Schedule(context.Background(), tx, id, at) }); err != nil {
			t.Fatal(err)
		}
	}
	now, later := uuid.New(), uuid.New()
	insert(now, time.Now())
	insert(later, time.Now().Add(2*time.Second))

	waitFor := func(cond func() bool, what string) {
		t.Helper()
		for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
			if cond() {
				return
			}
		}
		t.Fatalf("timed out waiting for %s", what)
	}
	waitFor(func() bool { return proc.count(now) >= 1 }, "the immediate job")
	if proc.count(later) != 0 {
		t.Fatal("a job scheduled for later ran early")
	}
	waitFor(func() bool { return proc.count(later) >= 1 }, "the scheduled job")
	time.Sleep(1500 * time.Millisecond) // long enough for any retry backoff to have fired
	if proc.count(now) != 1 || proc.count(later) != 1 {
		t.Fatalf("a failed job was retried by the queue: now=%d later=%d", proc.count(now), proc.count(later))
	}
	// The job is final, not left pending for another worker.
	var open int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM river_job WHERE kind = 'email_delivery' AND state NOT IN ('discarded', 'completed', 'cancelled')").Scan(&open); err != nil {
		t.Fatal(err)
	}
	if open != 0 {
		t.Fatalf("%d delivery jobs remain open", open)
	}
}
