package main

import (
	"context"
	"github.com/deranjer/ebooker/apps/server/internal/app"
	"github.com/deranjer/ebooker/apps/server/internal/delivery"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
	"io"
	"log/slog"
	"testing"
	"time"
)

func TestProductionDeliveryGateRegistersRecovery(t *testing.T) {
	pool := testutil.MigratedDatabase(t)
	gate := &deliveryGate{ready: make(chan struct{}), svc: delivery.New(delivery.Options{Pool: pool})}
	close(gate.ready)
	client, err := app.NewWorkerClient(pool, inspect.New(inspect.Config{ProbePath: "ffprobe"}), app.WorkerOptions{Workers: 1, MaxAttempts: 4, JobTimeout: time.Minute, RescueStuckAfter: time.Minute, FetchPollInterval: 100 * time.Millisecond, Delivery: gate}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.StopAndCancel(ctx)
	}()
	n := 0
	for deadline := time.Now().Add(4 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM river_job WHERE kind='email_delivery_recover'").Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			return
		}
	}
	t.Fatalf("production deliveryGate started without any email_delivery_recover job; startup sweep is not registered")
}
