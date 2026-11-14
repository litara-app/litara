// Package library manages per-library ingestion configuration (T004 milestone 1).
// Management requires an administrator who also holds a grant on the library
// (ADR-0056); an administrator without a grant cannot read or change anything.
package library

import (
	"context"
	"errors"
	"net/http"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/importer"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Known metadata provider identifiers (ADR-0049).
var providers = map[string]bool{"open_library": true, "google_books": true, "audnexus": true}

type Service struct {
	pool *pgxpool.Pool
	q    *sqlcgen.Queries
}

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool, q: sqlcgen.New(pool)} }

// Validate checks a configuration without touching the filesystem.
func Validate(c wire.LibraryConfig) error {
	if c.Mode != "index" && c.Mode != "managed" {
		return apperr.Validation("mode must be index or managed")
	}
	if !filepath.IsAbs(c.RootPath) && !path.IsAbs(c.RootPath) {
		return apperr.Validation("rootPath must be an absolute path")
	}
	if (c.SentinelPath == nil) != (c.SentinelSHA256 == nil) {
		return apperr.Validation("sentinelPath and sentinelSha256 must be set together")
	}
	if c.SentinelPath != nil && !containedRelative(*c.SentinelPath) {
		return apperr.Validation("sentinelPath must be relative and stay inside the root")
	}
	if c.WritebackBackups && (c.BackupRoot == nil || *c.BackupRoot == "") {
		return apperr.Validation("backupRoot is required when writebackBackups is enabled")
	}
	if c.BackupRoot != nil && !filepath.IsAbs(*c.BackupRoot) && !path.IsAbs(*c.BackupRoot) {
		return apperr.Validation("backupRoot must be an absolute path")
	}
	if c.Mode == "index" && c.ImportTemplate != nil {
		return apperr.Validation("importTemplate applies to managed libraries only")
	}
	if c.ImportTemplate != nil {
		if err := importer.ValidateTemplate(*c.ImportTemplate); err != nil {
			return apperr.Validation("importTemplate: " + err.Error())
		}
	}
	if c.ScanIntervalSecs < 60 || c.VerifyIntervalSecs < 3600 || c.StabilitySecs < 1 {
		return apperr.Validation("interval below the minimum")
	}
	for _, p := range c.ProviderOrder {
		if !providers[p] {
			return apperr.Validation("unknown provider " + p)
		}
	}
	return nil
}

// containedRelative reports whether p is a clean relative path with no parent escapes.
func containedRelative(p string) bool {
	if p == "" || strings.ContainsRune(p, 0) || filepath.IsAbs(p) || path.IsAbs(p) || strings.HasPrefix(p, `\`) {
		return false
	}
	clean := path.Clean(strings.ReplaceAll(p, `\`, "/"))
	return clean != "." && clean != ".." && !strings.HasPrefix(clean, "../") && !strings.Contains(clean, ":")
}

// Defaults fills unset numeric fields with the accepted defaults.
func Defaults(c wire.LibraryConfig) wire.LibraryConfig {
	if c.ScanIntervalSecs == 0 {
		c.ScanIntervalSecs = 900
	}
	if c.VerifyIntervalSecs == 0 {
		c.VerifyIntervalSecs = 86400
	}
	if c.StabilitySecs == 0 {
		c.StabilitySecs = 30
	}
	if c.ProviderOrder == nil {
		c.ProviderOrder = []string{}
	}
	return c
}

// Authorize enforces administrator status plus an explicit library grant. A
// missing library and a missing grant are indistinguishable to the caller.
func (s *Service) Authorize(ctx context.Context, userID uuid.UUID, isAdmin bool, libraryID uuid.UUID) error {
	if !isAdmin {
		return apperr.ErrAdminRequired
	}
	ok, err := s.q.HasGrant(ctx, sqlcgen.HasGrantParams{UserID: userID, LibraryID: libraryID})
	if err != nil {
		return apperr.ErrUnavailable
	}
	if !ok {
		return apperr.ErrAccessDenied
	}
	return nil
}

// Create atomically adds a library with its configuration. It grants nobody
// access, including the creating administrator.
func (s *Service) Create(ctx context.Context, in wire.CreateLibrary) (wire.LibraryDetail, error) {
	in.Config = Defaults(in.Config)
	if err := Validate(in.Config); err != nil {
		return wire.LibraryDetail{}, err
	}
	id := uuid.New()
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if _, err := q.InsertLibrary(ctx, sqlcgen.InsertLibraryParams{ID: id, Name: strings.TrimSpace(in.Name)}); err != nil {
			return err
		}
		return s.upsert(ctx, q, id, in.Config)
	})
	if err != nil {
		if strings.Contains(err.Error(), "libraries_name_key") {
			return wire.LibraryDetail{}, apperr.New(http.StatusConflict, "library_name_taken", "A library with this name already exists.")
		}
		return wire.LibraryDetail{}, apperr.ErrUnavailable
	}
	return s.Get(ctx, id)
}

func (s *Service) upsert(ctx context.Context, q *sqlcgen.Queries, id uuid.UUID, c wire.LibraryConfig) error {
	_, err := q.UpsertLibraryConfig(ctx, sqlcgen.UpsertLibraryConfigParams{
		LibraryID: id, Mode: c.Mode, RootPath: c.RootPath, FollowSymlinks: c.FollowSymlinks,
		SentinelPath: c.SentinelPath, SentinelSha256: c.SentinelSHA256,
		ScanIntervalSecs: int32(c.ScanIntervalSecs), VerifyIntervalSecs: int32(c.VerifyIntervalSecs), StabilitySecs: int32(c.StabilitySecs),
		ImportTemplate: c.ImportTemplate, WritebackBackups: c.WritebackBackups, BackupRoot: c.BackupRoot, ProviderOrder: c.ProviderOrder,
	})
	return err
}

// Put replaces the configuration of an existing library.
func (s *Service) Put(ctx context.Context, id uuid.UUID, c wire.LibraryConfig) (wire.LibraryDetail, error) {
	c = Defaults(c)
	if err := Validate(c); err != nil {
		return wire.LibraryDetail{}, err
	}
	if _, err := s.q.GetLibrary(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return wire.LibraryDetail{}, apperr.ErrNotFound
		}
		return wire.LibraryDetail{}, apperr.ErrUnavailable
	}
	if err := s.upsert(ctx, s.q, id, c); err != nil {
		return wire.LibraryDetail{}, apperr.ErrUnavailable
	}
	return s.Get(ctx, id)
}

// Get returns the library, its configuration and the last root health.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (wire.LibraryDetail, error) {
	lib, err := s.q.GetLibrary(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return wire.LibraryDetail{}, apperr.ErrNotFound
		}
		return wire.LibraryDetail{}, apperr.ErrUnavailable
	}
	cfg, err := s.q.GetLibraryConfig(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return wire.LibraryDetail{}, apperr.New(http.StatusNotFound, "library_not_configured", "The library has no ingestion configuration.")
		}
		return wire.LibraryDetail{}, apperr.ErrUnavailable
	}
	h := wire.RootHealth{State: "unknown"}
	if row, err := s.q.GetRootHealth(ctx, id); err == nil {
		t := row.CheckedAt.UTC().Format(time.RFC3339)
		h = wire.RootHealth{State: row.State, Detail: row.Detail, CheckedAt: &t}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return wire.LibraryDetail{}, apperr.ErrUnavailable
	}
	order := cfg.ProviderOrder
	if order == nil {
		order = []string{}
	}
	return wire.LibraryDetail{
		Library: wire.Library{ID: lib.ID.String(), Name: lib.Name},
		Config: wire.LibraryConfig{
			Mode: cfg.Mode, RootPath: cfg.RootPath, FollowSymlinks: cfg.FollowSymlinks,
			SentinelPath: cfg.SentinelPath, SentinelSHA256: cfg.SentinelSha256,
			ScanIntervalSecs: int(cfg.ScanIntervalSecs), VerifyIntervalSecs: int(cfg.VerifyIntervalSecs), StabilitySecs: int(cfg.StabilitySecs),
			ImportTemplate: cfg.ImportTemplate, WritebackBackups: cfg.WritebackBackups, BackupRoot: cfg.BackupRoot, ProviderOrder: order,
		},
		Health: h,
	}, nil
}

// ListIDs returns every configured library (used by background enrichment).
func (s *Service) ListIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `SELECT library_id FROM library_config ORDER BY library_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
