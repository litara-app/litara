// Package testutil provides generated media fixtures and database helpers for
// tests. Fixtures are generated at test time with the bundled ffmpeg; nothing
// binary is committed. See research/backend/fixtures.md for the inventory.
package testutil

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/db"
)

// Tool resolves an executable from LITARA_<NAME>_PATH or PATH. When it is
// missing the test is skipped, unless LITARA_REQUIRE_INTEGRATION=1 (CI), in
// which case it fails so a skipped check cannot pass silently.
func Tool(t testing.TB, name string) string {
	t.Helper()
	if v := os.Getenv("LITARA_" + strings.ToUpper(name) + "_PATH"); v != "" {
		return v
	}
	p, err := exec.LookPath(name)
	if err != nil {
		skipOrFail(t, name+" not found; set LITARA_"+strings.ToUpper(name)+"_PATH")
	}
	return p
}

func skipOrFail(t testing.TB, msg string) {
	t.Helper()
	if os.Getenv("LITARA_REQUIRE_INTEGRATION") == "1" {
		t.Fatal(msg)
	}
	t.Skip(msg)
}

// FFmpeg runs ffmpeg with an argument array to build a fixture.
func FFmpeg(t testing.TB, args ...string) {
	t.Helper()
	full := append([]string{"-v", "error", "-y"}, args...)
	if out, err := exec.Command(Tool(t, "ffmpeg"), full...).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg %v: %v\n%s", args, err, out)
	}
}

// Sine returns lavfi input args for a mono sine of the given seconds.
func Sine(seconds int) []string {
	return []string{"-f", "lavfi", "-i", fmt.Sprintf("sine=frequency=440:duration=%d", seconds)}
}

// AdminURL returns the test database URL or skips/fails per skipOrFail.
func AdminURL(t testing.TB) string {
	t.Helper()
	u := os.Getenv("LITARA_TEST_DATABASE_URL")
	if u == "" {
		skipOrFail(t, "LITARA_TEST_DATABASE_URL not set; real PostgreSQL integration test not run")
	}
	return u
}

var dbSeq atomic.Int64

// NewDatabase creates an isolated empty database and returns a pool to it.
// The database is dropped at cleanup.
func NewDatabase(t testing.TB) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	admin, err := db.Open(ctx, AdminURL(t))
	if err != nil {
		t.Fatalf("connect admin: %v", err)
	}
	var rnd [6]byte
	_, _ = rand.Read(rnd[:])
	name := fmt.Sprintf("litara_t_%s_%d", hex.EncodeToString(rnd[:]), dbSeq.Add(1))
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatalf("create database: %v", err)
	}
	cfg := admin.Config().ConnConfig
	url := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable", cfg.User, cfg.Password, cfg.Host, cfg.Port, name)
	pool, err := db.Open(ctx, url)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		admin.Close()
	})
	return pool
}

// MigratedDatabase is NewDatabase plus full migrations.
func MigratedDatabase(t testing.TB) *pgxpool.Pool {
	t.Helper()
	pool := NewDatabase(t)
	if _, err := db.MigrateUp(context.Background(), pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return pool
}

// Path joins a fixture directory and name.
func Path(dir, name string) string { return filepath.Join(dir, name) }
