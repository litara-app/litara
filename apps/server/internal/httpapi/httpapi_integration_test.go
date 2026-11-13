package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/deranjer/ebooker/apps/server/internal/db"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
)

func get(t *testing.T, h http.Handler, path string) (int, httpapi.ReadyBody) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	var b httpapi.ReadyBody
	_ = json.Unmarshal(rec.Body.Bytes(), &b)
	return rec.Code, b
}

func TestReadinessReflectsRealPrerequisites(t *testing.T) {
	ctx := context.Background()
	pool := testutil.NewDatabase(t)
	insp := inspect.New(inspect.Config{ProbePath: testutil.Tool(t, "ffprobe")})
	running := true
	h := httpapi.New(httpapi.Deps{Pool: pool, Prober: insp, Workers: func() bool { return running }, Version: "test"})

	if code, _ := get(t, h, "/healthz"); code != 200 {
		t.Fatalf("healthz %d", code)
	}

	// Unmigrated database: alive but not ready, with an actionable reason.
	code, body := get(t, h, "/readyz")
	if code != http.StatusServiceUnavailable || body.Ready || body.Checks["schema"] == "ok" || body.Checks["database"] != "ok" {
		t.Fatalf("unmigrated: %d %+v", code, body)
	}

	if _, err := db.MigrateUp(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if code, body = get(t, h, "/readyz"); code != 200 || !body.Ready {
		t.Fatalf("migrated: %d %+v", code, body)
	}

	running = false
	if code, body = get(t, h, "/readyz"); code != 503 || body.Checks["workers"] == "ok" {
		t.Fatalf("workers stopped: %d %+v", code, body)
	}
	running = true

	bad := httpapi.New(httpapi.Deps{Pool: pool, Prober: inspect.New(inspect.Config{ProbePath: "/no/such/ffprobe"}), Workers: func() bool { return true }})
	if code, body = get(t, bad, "/readyz"); code != 503 || body.Checks["ffprobe"] == "ok" {
		t.Fatalf("missing ffprobe: %d %+v", code, body)
	}
}

func TestDatabaseOutageThenRecoveryWithoutReset(t *testing.T) {
	ctx := context.Background()
	pool := testutil.MigratedDatabase(t)
	if _, err := pool.Exec(ctx, `INSERT INTO inspection_requests (request_key, source_path) VALUES ('keep','/a')`); err != nil {
		t.Fatal(err)
	}
	h := httpapi.New(httpapi.Deps{Pool: pool})
	if code, _ := get(t, h, "/readyz"); code != 200 {
		t.Fatalf("expected ready, got %d", code)
	}

	// Outage: terminate every other backend, which is how a restart or network
	// drop looks to pooled connections. Readiness must not require any reset
	// to recover, and data must be intact.
	admin := testutil.NewDatabase(t) // separate pool to issue the kill
	_ = admin
	_, _ = pool.Exec(ctx, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
		WHERE datname = current_database() AND pid <> pg_backend_pid()`)

	deadline := time.Now().Add(15 * time.Second)
	for {
		if code, body := get(t, h, "/readyz"); code == 200 && body.Ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("did not become ready again after backend termination")
		}
		time.Sleep(200 * time.Millisecond)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM inspection_requests`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("data after recovery: %d %v", n, err)
	}
}

func TestReadinessWhenDatabaseUnreachable(t *testing.T) {
	// A pool is created lazily, so pointing at a closed port models an outage.
	ctx := context.Background()
	good := testutil.MigratedDatabase(t)
	url := good.Config().ConnString()
	_ = url
	pool, err := db.Open(ctx, testutil.AdminURL(t))
	if err != nil {
		t.Fatal(err)
	}
	pool.Close() // a closed pool fails Ping, like a lost database
	code, body := get(t, httpapi.New(httpapi.Deps{Pool: pool}), "/readyz")
	if code != 503 || body.Checks["database"] != "unreachable" {
		t.Fatalf("%d %+v", code, body)
	}
}
