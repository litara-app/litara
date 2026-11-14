package seed

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
)

// ReplaceContent publishes new bytes for an existing file identity: a new
// content version becomes current, the old version is retained but no longer
// served, and the layout revision of every containing recording changes.
// It is a fixture/operator primitive; T004 owns real replacement detection.
func ReplaceContent(ctx context.Context, pool *pgxpool.Pool, ref FileRef, newPath string, size, durationMs int64) (uuid.UUID, error) {
	ver := uuid.New()
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		if err := q.SeedUpsertFileVersion(ctx, sqlcgen.SeedUpsertFileVersionParams{ContentVersion: ver, FileID: ref.ID, Locator: newPath,
			Filename: baseName(newPath), MimeType: ref.MIME, SizeBytes: &size, DurationMs: &durationMs, Available: true, Current: false}); err != nil {
			return err
		}
		if err := q.ClearOtherCurrentVersions(ctx, sqlcgen.ClearOtherCurrentVersionsParams{FileID: ref.ID, ContentVersion: ver}); err != nil {
			return err
		}
		if err := q.SeedUpsertFileVersion(ctx, sqlcgen.SeedUpsertFileVersionParams{ContentVersion: ver, FileID: ref.ID, Locator: newPath,
			Filename: baseName(newPath), MimeType: ref.MIME, SizeBytes: &size, DurationMs: &durationMs, Available: true, Current: true}); err != nil {
			return err
		}
		recs, err := q.ListFileRecordingIDs(ctx, ref.ID)
		if err != nil {
			return err
		}
		for _, r := range recs {
			if err := q.SetLayoutRevision(ctx, sqlcgen.SetLayoutRevisionParams{ID: r, LayoutRevision: uuid.New()}); err != nil {
				return err
			}
		}
		return nil
	})
	return ver, err
}

// Reorder replaces a recording's file order (same members) and bumps its layout revision.
func Reorder(ctx context.Context, pool *pgxpool.Pool, recording uuid.UUID, order []uuid.UUID) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		if err := q.DeleteRecordingFiles(ctx, recording); err != nil {
			return err
		}
		for i, f := range order {
			if err := q.InsertRecordingFile(ctx, sqlcgen.InsertRecordingFileParams{RecordingID: recording, Sequence: int32(i), FileID: f}); err != nil {
				return fmt.Errorf("insert member %d: %w", i, err)
			}
		}
		return q.SetLayoutRevision(ctx, sqlcgen.SetLayoutRevisionParams{ID: recording, LayoutRevision: uuid.New()})
	})
}

func baseName(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' || p[i] == '\\' {
			return p[i+1:]
		}
	}
	return p
}
