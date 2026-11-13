// Package db owns the PostgreSQL pool, explicit migrations and schema checks.
package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"

	"github.com/deranjer/ebooker/apps/server/migrations"
)

// Open creates a pgx pool. It does not run migrations.
func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("configure database pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to database: %w", err)
	}
	return pool, nil
}

func gooseProvider(pool *pgxpool.Pool) (*goose.Provider, *sql.DB, error) {
	sqlDB := stdlib.OpenDBFromPool(pool)
	p, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.FS)
	if err != nil {
		return nil, nil, fmt.Errorf("create goose provider: %w", err)
	}
	return p, sqlDB, nil
}

func riverMigrator(pool *pgxpool.Pool) (*rivermigrate.Migrator[pgx.Tx], error) {
	return rivermigrate.New(riverpgxv5.New(pool), nil)
}

// MigrateUp applies pending application migrations, then River's own
// migrations. upTo > 0 limits the application migrations (used by upgrade
// tests); it never runs down migrations.
func MigrateUp(ctx context.Context, pool *pgxpool.Pool, upTo int64) (applied []int64, err error) {
	p, sqlDB, err := gooseProvider(pool)
	if err != nil {
		return nil, err
	}
	defer sqlDB.Close()

	var results []*goose.MigrationResult
	if upTo > 0 {
		results, err = p.UpTo(ctx, upTo)
	} else {
		results, err = p.Up(ctx)
	}
	if err != nil {
		return nil, fmt.Errorf("apply application migrations: %w", err)
	}
	for _, r := range results {
		applied = append(applied, r.Source.Version)
	}

	if upTo > 0 {
		return applied, nil // partial application path skips River on purpose
	}
	m, err := riverMigrator(pool)
	if err != nil {
		return applied, fmt.Errorf("create river migrator: %w", err)
	}
	if _, err := m.Migrate(ctx, rivermigrate.DirectionUp, &rivermigrate.MigrateOpts{}); err != nil {
		return applied, fmt.Errorf("apply river migrations: %w", err)
	}
	return applied, nil
}

// MigrateRiver applies only River's migrations.
func MigrateRiver(ctx context.Context, pool *pgxpool.Pool) error {
	m, err := riverMigrator(pool)
	if err != nil {
		return err
	}
	_, err = m.Migrate(ctx, rivermigrate.DirectionUp, &rivermigrate.MigrateOpts{})
	return err
}

// SchemaStatus reports whether the schema matches what this binary needs.
type SchemaStatus struct {
	AppVersion    int64
	AppTarget     int64
	RiverOK       bool
	RiverMessages []string
}

func (s SchemaStatus) Ready() bool { return s.AppVersion == s.AppTarget && s.RiverOK }

// CheckSchema inspects migration state without changing it.
func CheckSchema(ctx context.Context, pool *pgxpool.Pool) (SchemaStatus, error) {
	var st SchemaStatus
	p, sqlDB, err := gooseProvider(pool)
	if err != nil {
		return st, err
	}
	defer sqlDB.Close()

	// GetVersions fails if the goose table does not exist yet; that means
	// "not migrated", not an infrastructure error, so report version 0.
	cur, target, err := p.GetVersions(ctx)
	if err != nil {
		if exists, qerr := tableExists(ctx, pool, "goose_db_version"); qerr != nil {
			return st, qerr
		} else if exists {
			return st, fmt.Errorf("read application migration version: %w", err)
		}
		cur = 0
		sources := p.ListSources()
		if len(sources) > 0 {
			target = sources[len(sources)-1].Version
		}
	}
	st.AppVersion, st.AppTarget = cur, target

	m, err := riverMigrator(pool)
	if err != nil {
		return st, err
	}
	vr, err := m.Validate(ctx, &rivermigrate.ValidateOpts{})
	if err != nil {
		return st, fmt.Errorf("validate river schema: %w", err)
	}
	st.RiverOK, st.RiverMessages = vr.OK, vr.Messages
	return st, nil
}

func tableExists(ctx context.Context, pool *pgxpool.Pool, name string) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, name).Scan(&ok)
	if err != nil {
		return false, errors.Join(errors.New("check table existence"), err)
	}
	return ok, nil
}

// Status lists application migration state for the ctl command.
func Status(ctx context.Context, pool *pgxpool.Pool) ([]*goose.MigrationStatus, error) {
	p, sqlDB, err := gooseProvider(pool)
	if err != nil {
		return nil, err
	}
	defer sqlDB.Close()
	return p.Status(ctx)
}
