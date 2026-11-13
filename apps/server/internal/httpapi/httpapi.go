// Package httpapi exposes only operational endpoints for T001. Catalog, auth
// and progress contracts are intentionally absent.
package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/db"
)

// Prober is what readiness needs from the inspection tool.
type Prober interface {
	Version(ctx context.Context) (string, error)
}

// WorkersRunning reports whether the job client has started.
type WorkersRunning func() bool

type Deps struct {
	// API, when set, mounts the T003 public contract under /api/v1.
	API     *APIDeps
	Pool    *pgxpool.Pool
	Prober  Prober
	Workers WorkersRunning
	Version string
}

type healthOutput struct {
	Body struct {
		Status  string `json:"status" example:"ok"`
		Version string `json:"version"`
	}
}

type readyOutput struct {
	Status int
	Body   ReadyBody
}

// ReadyBody lists each prerequisite check. Messages never contain
// credentials or connection strings.
type ReadyBody struct {
	Ready  bool              `json:"ready"`
	Checks map[string]string `json:"checks"`
}

// Check evaluates readiness. It is exported so tests can call it directly.
func Check(ctx context.Context, d Deps) ReadyBody {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	b := ReadyBody{Ready: true, Checks: map[string]string{}}
	fail := func(name, msg string) { b.Ready = false; b.Checks[name] = msg }

	if err := d.Pool.Ping(ctx); err != nil {
		fail("database", "unreachable")
		// Schema/worker checks need the database; stop here without
		// touching any data. Recovery needs no reset once it returns.
		b.Checks["schema"] = "unknown"
	} else {
		b.Checks["database"] = "ok"
		st, err := db.CheckSchema(ctx, d.Pool)
		switch {
		case err != nil:
			fail("schema", "check failed")
		case !st.Ready():
			fail("schema", "migrations pending (run ctl migrate up)")
		default:
			b.Checks["schema"] = "ok"
		}
	}
	if d.Prober != nil {
		if _, err := d.Prober.Version(ctx); err != nil {
			fail("ffprobe", "unavailable")
		} else {
			b.Checks["ffprobe"] = "ok"
		}
	}
	if d.Workers != nil {
		if d.Workers() {
			b.Checks["workers"] = "ok"
		} else {
			fail("workers", "not running")
		}
	}
	return b
}

// New builds the HTTP handler.
func New(d Deps) http.Handler {
	mux := http.NewServeMux()
	opCfg := huma.DefaultConfig("Litara Server (operational)", "0.0.0-t001")
	opCfg.DocsPath, opCfg.OpenAPIPath, opCfg.SchemasPath = "", "", "" // operational routes are outside the public data contract
	api := humago.New(mux, opCfg)

	huma.Register(api, huma.Operation{
		OperationID: "healthz", Method: http.MethodGet, Path: "/healthz",
		Summary: "Liveness: the process is serving requests",
	}, func(ctx context.Context, _ *struct{}) (*healthOutput, error) {
		out := &healthOutput{}
		out.Body.Status, out.Body.Version = "ok", d.Version
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "readyz", Method: http.MethodGet, Path: "/readyz",
		Summary: "Readiness: database, schema, ffprobe and workers",
	}, func(ctx context.Context, _ *struct{}) (*readyOutput, error) {
		body := Check(ctx, d)
		status := http.StatusOK
		if !body.Ready {
			status = http.StatusServiceUnavailable
		}
		return &readyOutput{Status: status, Body: body}, nil
	})
	if d.API != nil {
		RegisterAPI(mux, *d.API)
	}
	return mux
}
