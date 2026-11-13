// Command server runs the Litara backend: HTTP operational endpoints plus
// bounded durable inspection workers. It does not migrate the database;
// run `ctl migrate up` explicitly first (policy decision pending, see
// research/backend/decisions-needed.md).
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/deranjer/ebooker/apps/server/internal/app"
	"github.com/deranjer/ebooker/apps/server/internal/config"
	"github.com/deranjer/ebooker/apps/server/internal/db"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
)

const version = "0.0.0-t001"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("invalid configuration:\n%w", err)
	}
	log := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: cfg.LogLevel}))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	insp := app.NewInspector(cfg)
	if v, err := insp.Version(ctx); err != nil {
		// Not fatal: readiness reports the tool as unavailable and jobs retry.
		log.Warn("ffprobe not usable at startup", "path", cfg.FFprobePath, "error", err)
	} else {
		log.Info("ffprobe available", "version", v)
	}

	// Refuse to start workers against a schema this binary cannot use.
	st, err := db.CheckSchema(ctx, pool)
	if err != nil {
		return fmt.Errorf("check schema: %w", err)
	}
	if !st.Ready() {
		return fmt.Errorf("database schema is not current (application %d/%d, river ok=%v); run `ctl migrate up`",
			st.AppVersion, st.AppTarget, st.RiverOK)
	}

	client, err := app.NewWorkerClient(pool, insp, app.WorkerOptionsFrom(cfg), log)
	if err != nil {
		return err
	}
	var running atomic.Bool
	if err := client.Start(ctx); err != nil {
		return fmt.Errorf("start workers: %w", err)
	}
	running.Store(true)
	log.Info("workers started", "inspect_workers", cfg.InspectWorkers)

	srv := &http.Server{
		Addr: cfg.HTTPAddr, ReadHeaderTimeout: 10 * time.Second,
		Handler: httpapi.New(httpapi.Deps{Pool: pool, Prober: insp, Workers: running.Load, Version: version}),
	}
	errc := make(chan error, 1)
	go func() {
		log.Info("http listening", "addr", cfg.HTTPAddr)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("http server: %w", err)
		}
	case <-ctx.Done():
		log.Info("shutdown requested")
	}

	// Graceful shutdown: stop accepting HTTP, then let in-flight jobs finish
	// within the timeout; anything unfinished is re-queued by the worker or
	// rescued by River after restart.
	running.Store(false)
	sctx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	_ = srv.Shutdown(sctx)
	if err := client.Stop(sctx); err != nil {
		log.Warn("workers did not stop cleanly; hard-stopping", "error", err)
		_ = client.StopAndCancel(context.Background())
	}
	log.Info("shutdown complete")
	return nil
}
