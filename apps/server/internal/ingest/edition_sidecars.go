package ingest

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

// editionSidecarFields are the fields a sidecar may supply for an ebook edition (ADR-0047 ranks them below a protected
// user edit and above the file's own tags).
var editionSidecarFields = []string{"title", "authors", "series_name", "series_index", "language", "tags",
	"publisher", "published", "page_count", "isbn", "description"}

// applyEditionSidecars reads every Litara JSON or OPF sidecar associated with an ebook edition and stores its values as
// that edition's "sidecar" evidence, replacing the previous evidence (a field the sidecar no longer carries is removed).
// Litara JSON outranks OPF. An edition whose sidecar disappeared loses its sidecar evidence. Nothing here writes a file.
func (s *Scanner) applyEditionSidecars(ctx context.Context, lib uuid.UUID) error {
	q := sqlcgen.New(s.Pool)
	assoc, err := q.ListLibraryEditionAssociated(ctx, lib)
	if err != nil {
		return err
	}
	had, err := q.ListEditionsWithSidecarValues(ctx, lib)
	if err != nil {
		return err
	}
	byEd := map[uuid.UUID][]sqlcgen.ListLibraryEditionAssociatedRow{}
	for _, a := range assoc {
		byEd[a.EditionID.UUID] = append(byEd[a.EditionID.UUID], a)
	}
	for _, id := range had {
		if _, ok := byEd[id]; !ok {
			byEd[id] = nil
		}
	}
	if len(byEd) == 0 {
		return nil
	}
	root := ""
	if cfg, err := q.GetLibraryConfig(ctx, lib); err == nil {
		root, _ = filepath.EvalSymlinks(cfg.RootPath)
	}
	for ed, list := range byEd {
		side := metadata.Fields{}
		for _, kind := range []string{"json", "opf"} {
			for _, a := range list {
				if a.Kind != kind {
					continue
				}
				if f, ok := metadata.ReadSidecar(root, a.RelPath, kind); ok {
					for k, v := range f {
						if _, have := side[k]; !have {
							side[k] = v
						}
					}
				}
			}
		}
		if err := s.storeEditionSidecar(ctx, ed, side); err != nil {
			return err
		}
	}
	return nil
}

func (s *Scanner) storeEditionSidecar(ctx context.Context, edition uuid.UUID, side metadata.Fields) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		if _, err := q.LockEdition(ctx, edition); err != nil {
			return err
		}
		rows, err := q.ListEditionMetadataValues(ctx, edition)
		if err != nil {
			return err
		}
		have := map[string][]byte{}
		for _, r := range rows {
			if r.Source == metadata.SourceSidecar {
				have[r.Field] = r.Value
			}
		}
		changed := false
		for _, f := range editionSidecarFields {
			raw, want := side[f]
			old, had := have[f]
			switch {
			case want && had && sameJSON(old, raw):
			case want:
				if err := q.UpsertEditionMetadataValue(ctx, sqlcgen.UpsertEditionMetadataValueParams{EditionID: edition, Field: f, Source: metadata.SourceSidecar, Value: raw}); err != nil {
					return err
				}
				changed = true
			case had:
				if _, err := q.DeleteEditionMetadataValue(ctx, sqlcgen.DeleteEditionMetadataValueParams{EditionID: edition, Field: f, Source: metadata.SourceSidecar}); err != nil {
					return err
				}
				changed = true
			}
		}
		if !changed {
			return nil
		}
		if err := q.BumpEdition(ctx, edition); err != nil {
			return err
		}
		return propagateEdition(ctx, q, edition)
	})
}

func sameJSON(a, b []byte) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return bytes.Equal(a, b)
	}
	ja, _ := json.Marshal(x)
	jb, _ := json.Marshal(y)
	return bytes.Equal(ja, jb)
}

// propagateEdition applies the winning values to the rows that display them: the edition language always, and the title
// fields only while this edition is the title's sole child, so another edition's evidence is never silently overwritten.
// (The administrator path in the reading package does the same after a protected edit.)
func propagateEdition(ctx context.Context, q *sqlcgen.Queries, edition uuid.UUID) error {
	ed, err := q.GetEditionRow(ctx, edition)
	if err != nil {
		return err
	}
	rows, err := q.ListEditionMetadataValues(ctx, edition)
	if err != nil {
		return err
	}
	vals := make([]metadata.Value, 0, len(rows))
	for _, r := range rows {
		vals = append(vals, metadata.Value{Field: r.Field, Source: r.Source, Raw: r.Value, ProtectedClear: r.ProtectedClear})
	}
	eff := metadata.Resolve(vals)
	var lang *string
	if e, ok := eff["language"]; ok && !e.Cleared {
		var v string
		if json.Unmarshal(e.Raw, &v) == nil && v != "" {
			lang = &v
		}
	}
	if err := q.SetEditionLanguage(ctx, sqlcgen.SetEditionLanguageParams{ID: ed.ID, Language: lang}); err != nil {
		return err
	}
	if n, err := q.CountTitleChildren(ctx, ed.TitleID); err != nil || n != 1 {
		return err
	}
	t, err := q.GetTitleRow(ctx, ed.TitleID)
	if err != nil {
		return err
	}
	name := t.Title
	if e, ok := eff["title"]; ok && !e.Cleared {
		var v string
		if json.Unmarshal(e.Raw, &v) == nil && v != "" {
			name = v
		}
	}
	authors := []string{}
	if e, ok := eff["authors"]; ok && !e.Cleared {
		_ = json.Unmarshal(e.Raw, &authors)
	}
	var series *string
	if e, ok := eff["series_name"]; ok && !e.Cleared {
		var v string
		if json.Unmarshal(e.Raw, &v) == nil {
			series = &v
		}
	}
	var index *float64
	if e, ok := eff["series_index"]; ok && !e.Cleared {
		var v float64
		if json.Unmarshal(e.Raw, &v) == nil {
			index = &v
		}
	}
	return q.UpdateTitleFields(ctx, sqlcgen.UpdateTitleFieldsParams{ID: t.ID, Title: name, Authors: authors, SeriesName: series, SeriesIndex: index})
}
