package ingest

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/ebookmeta"
)

func inspectEditionStructure(e Entry) string {
	if !strings.HasSuffix(strings.ToLower(e.Rel), ".epub") {
		return ""
	}
	resolved, err := filepath.EvalSymlinks(e.Abs)
	if err != nil || filepath.Clean(resolved) != filepath.Clean(e.Abs) {
		return ""
	}
	f, err := os.Open(e.Abs)
	if err != nil {
		return ""
	}
	defer f.Close()
	before, err := f.Stat()
	if err != nil || !before.Mode().IsRegular() || before.Size() != e.Size || !micro(before.ModTime()).Equal(e.Mtime) {
		return ""
	}
	result := ebookmeta.InspectEPUB(f, e.Size)
	after, err := os.Stat(e.Abs)
	if err != nil || !os.SameFile(before, after) || after.Size() != e.Size || !after.ModTime().Equal(before.ModTime()) {
		return ""
	}
	return result
}

// Backfill existing versions during a healthy scan using that scan's observed
// paths. Unreadable or changing entries can be reassessed on a later scan.
func (s *Scanner) backfillEditionStructures(ctx context.Context, lib uuid.UUID, listing *Listing) error {
	q := sqlcgen.New(s.Pool)
	rows, err := q.ListUnassessedEPUBs(ctx, lib)
	if err != nil || len(rows) == 0 {
		return err
	}
	entries := make(map[string]Entry)
	for _, e := range listing.Media {
		if strings.HasSuffix(strings.ToLower(e.Rel), ".epub") {
			entries[e.Rel] = e
		}
	}
	for _, r := range rows {
		if err := ctx.Err(); err != nil {
			return err
		}
		e, seen := entries[r.RelPath]
		if !seen || e.Abs != r.Locator || e.Size != r.SizeBytes || !e.Mtime.Equal(r.Mtime) {
			continue
		}
		if structure := inspectEditionStructure(e); structure != "" {
			if err := q.RecordEPUBStructure(ctx, sqlcgen.RecordEPUBStructureParams{ContentVersion: r.ContentVersion, Structure: structure}); err != nil {
				return err
			}
		}
	}
	return nil
}
