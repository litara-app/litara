package db_test

import (
	"context"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/db"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
)

func TestFreshInitialization(t *testing.T) {
	ctx := context.Background()
	pool := testutil.NewDatabase(t)

	st, err := db.CheckSchema(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if st.Ready() || st.AppVersion != 0 || st.RiverOK {
		t.Fatalf("empty database must not be ready: %+v", st)
	}

	applied, err := db.MigrateUp(ctx, pool, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(applied) != 2 {
		t.Fatalf("applied %v", applied)
	}
	if st, err = db.CheckSchema(ctx, pool); err != nil || !st.Ready() {
		t.Fatalf("%+v %v", st, err)
	}
	// Idempotent re-run.
	if applied, err = db.MigrateUp(ctx, pool, 0); err != nil || len(applied) != 0 {
		t.Fatalf("second run applied %v err %v", applied, err)
	}
}

func TestNonDestructiveUpgrade(t *testing.T) {
	ctx := context.Background()
	pool := testutil.NewDatabase(t)

	// Old release: application schema v1 only.
	if _, err := db.MigrateUp(ctx, pool, 1); err != nil {
		t.Fatal(err)
	}
	if err := db.MigrateRiver(ctx, pool); err != nil {
		t.Fatal(err)
	}
	st, _ := db.CheckSchema(ctx, pool)
	if st.AppVersion != 1 || st.Ready() {
		t.Fatalf("v1 should be behind: %+v", st)
	}
	var id string
	err := pool.QueryRow(ctx, `INSERT INTO inspection_requests (request_key, source_path, state, outcome, attempts)
		VALUES ('k', '/media/a.m4b', 'failed', 'timeout', 3) RETURNING id::text`).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO inspection_results (request_id, completeness, duration_ms, format_name, result)
		VALUES ($1, 'complete', 1000, 'mp3', '{"keep":true}')`, id); err != nil {
		t.Fatal(err)
	}

	// Upgrade to current.
	if _, err := db.MigrateUp(ctx, pool, 0); err != nil {
		t.Fatal(err)
	}
	if st, _ = db.CheckSchema(ctx, pool); !st.Ready() {
		t.Fatalf("%+v", st)
	}
	var path, outcome string
	var attempts int
	var kept bool
	if err := pool.QueryRow(ctx, `SELECT r.source_path, r.outcome, r.attempts, (x.result->>'keep')::bool
		FROM inspection_requests r JOIN inspection_results x ON x.request_id = r.id WHERE r.id = $1`, id).
		Scan(&path, &outcome, &attempts, &kept); err != nil {
		t.Fatal(err)
	}
	if path != "/media/a.m4b" || outcome != "timeout" || attempts != 3 || !kept {
		t.Fatalf("data changed by upgrade: %s %s %d %v", path, outcome, attempts, kept)
	}
	var toolVersion *string
	if err := pool.QueryRow(ctx, `SELECT tool_version FROM inspection_results WHERE request_id=$1`, id).Scan(&toolVersion); err != nil || toolVersion != nil {
		t.Fatalf("new column should exist and be NULL: %v %v", toolVersion, err)
	}
}
