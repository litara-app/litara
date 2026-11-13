// Command ctl is the local/internal operations and diagnostic tool. It is not
// exposed over HTTP: inspection of arbitrary filesystem paths stays a
// process-local capability.
//
//	ctl migrate up|status
//	ctl tools
//	ctl inspect [--wait] [--with-worker] [--reinspect] [--timeout 2m] <absolute-path>
//	ctl show <absolute-path>
//	ctl gen-key                        print a new LITARA_SECRET_KEY value
//	ctl openapi                        print the generated OpenAPI document (no database)
//	ctl bootstrap-admin --username U   create the first administrator (password from a prompt or stdin)
//	ctl reset-password --username U    set a new password and revoke that user's sessions
//	ctl seed --dir ABS                 explicit fixture seeding with generated media (never automatic)
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/accounts"
	"github.com/deranjer/ebooker/apps/server/internal/app"
	"github.com/deranjer/ebooker/apps/server/internal/config"
	"github.com/deranjer/ebooker/apps/server/internal/db"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/jobs"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, out io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: ctl migrate up|status | tools | inspect <path> | show <path>")
	}
	if args[0] == "tools" {
		return tools(ctx, out)
	}
	if args[0] == "gen-key" {
		k, err := accounts.GenerateKey()
		if err != nil {
			return err
		}
		fmt.Fprintln(out, k)
		return nil
	}
	if args[0] == "openapi" {
		return openapiCmd(out)
	}
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("invalid configuration:\n%w", err)
	}
	switch args[0] {
	case "migrate":
		return migrate(ctx, cfg, args[1:], out)
	case "inspect":
		return inspectCmd(ctx, cfg, args[1:], out)
	case "show":
		return showCmd(ctx, cfg, args[1:], out)
	case "bootstrap-admin":
		return bootstrapCmd(ctx, cfg, args[1:], out)
	case "reset-password":
		return resetPasswordCmd(ctx, cfg, args[1:], out)
	case "seed":
		return seedCmd(ctx, cfg, args[1:], out)
	}
	return fmt.Errorf("unknown command %q", args[0])
}

func tools(ctx context.Context, out io.Writer) error {
	probe, mpeg := config.ToolPaths()
	for _, bin := range []string{probe, mpeg} {
		b, err := exec.CommandContext(ctx, bin, "-version").Output()
		if err != nil {
			return fmt.Errorf("%s: %w", bin, err)
		}
		line, _, _ := strings.Cut(string(b), "\n")
		fmt.Fprintf(out, "%s: %s\n", bin, line)
	}
	return nil
}

func migrate(ctx context.Context, cfg *config.Config, args []string, out io.Writer) error {
	if len(args) != 1 {
		return errors.New("usage: ctl migrate up|status")
	}
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	switch args[0] {
	case "up":
		applied, err := db.MigrateUp(ctx, pool)
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "application migrations applied: %v\nriver migrations: up to date\n", applied)
		return nil
	case "status":
		st, err := db.CheckSchema(ctx, pool)
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "application: %d of %d\nriver ok: %v %v\n", st.AppVersion, st.AppTarget, st.RiverOK, st.RiverMessages)
		if !st.Ready() {
			return errors.New("schema is not current")
		}
		return nil
	}
	return fmt.Errorf("unknown migrate action %q", args[0])
}

func inspectCmd(ctx context.Context, cfg *config.Config, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("inspect", flag.ContinueOnError)
	wait := fs.Bool("wait", true, "wait for the request to reach a terminal state")
	withWorker := fs.Bool("with-worker", false, "run an in-process worker (otherwise a running server must process the job)")
	reinspect := fs.Bool("reinspect", false, "re-run a terminal request")
	timeout := fs.Duration("timeout", 2*time.Minute, "maximum time to wait")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return errors.New("usage: ctl inspect [flags] <absolute-path>")
	}
	path, err := filepath.Abs(fs.Arg(0))
	if err != nil {
		return err
	}

	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	st, err := db.CheckSchema(ctx, pool)
	if err != nil {
		return err
	}
	if !st.Ready() {
		return errors.New("schema is not current; run `ctl migrate up` first")
	}

	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	insertClient, err := app.NewInsertClient(pool)
	if err != nil {
		return err
	}
	sub := &jobs.Submitter{Pool: pool, Client: insertClient, MaxAttempts: cfg.InspectMaxAttempts}
	res, err := sub.Submit(ctx, path, *reinspect)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "request %s created=%v enqueued=%v state=%s\n", res.Request.ID, res.Created, res.Enqueued, res.Request.State)

	if *withWorker {
		opts := app.WorkerOptionsFrom(cfg)
		client, err := app.NewWorkerClient(pool, app.NewInspector(cfg), opts, log)
		if err != nil {
			return err
		}
		if err := client.Start(ctx); err != nil {
			return err
		}
		defer func() {
			sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_ = client.Stop(sctx)
		}()
	}
	if !*wait {
		return nil
	}
	return waitAndShow(ctx, pool, res.Request.ID, *timeout, out)
}

func waitAndShow(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, timeout time.Duration, out io.Writer) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	q := sqlcgen.New(pool)
	for {
		req, err := q.GetInspectionRequest(ctx, id)
		if err != nil {
			return err
		}
		if req.State == "completed" || req.State == "failed" || req.State == "cancelled" {
			return printRequest(ctx, q, req, out)
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("timed out waiting; request is %s (attempts=%d)", req.State, req.Attempts)
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func showCmd(ctx context.Context, cfg *config.Config, args []string, out io.Writer) error {
	if len(args) != 1 {
		return errors.New("usage: ctl show <absolute-path>")
	}
	path, err := filepath.Abs(args[0])
	if err != nil {
		return err
	}
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	q := sqlcgen.New(pool)
	req, err := q.GetInspectionRequestByKey(ctx, jobs.RequestKey(path))
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("no inspection request for that path")
	}
	if err != nil {
		return err
	}
	return printRequest(ctx, q, req, out)
}

func printRequest(ctx context.Context, q *sqlcgen.Queries, req sqlcgen.InspectionRequest, out io.Writer) error {
	outcome, msg := "", ""
	if req.Outcome != nil {
		outcome = *req.Outcome
	}
	if req.FailureMessage != nil {
		msg = *req.FailureMessage
	}
	fmt.Fprintf(out, "state=%s outcome=%s attempts=%d\n", req.State, outcome, req.Attempts)
	if msg != "" {
		fmt.Fprintf(out, "message: %s\n", msg)
	}
	if req.State != "completed" {
		return nil
	}
	r, err := q.GetInspectionResult(ctx, req.ID)
	if err != nil {
		return err
	}
	var pretty json.RawMessage = r.Result
	b, _ := json.MarshalIndent(pretty, "", "  ")
	fmt.Fprintf(out, "%s\n", b)
	return nil
}
