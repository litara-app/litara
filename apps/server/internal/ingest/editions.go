package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"path"
	"reflect"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/ebookmeta"
)

// EditionFormat returns the T005 format name for a file name, or "" when the
// file is not a supported ebook/comic container type (ADR-0065).
func EditionFormat(filename string) string {
	n := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(n, ".kepub.epub"):
		return "kepub"
	case strings.HasSuffix(n, ".epub"):
		return "epub"
	}
	switch strings.TrimPrefix(path.Ext(n), ".") {
	case "mobi", "azw", "azw3", "fb2", "pdf", "cbz", "cbr", "cb7":
		return strings.TrimPrefix(path.Ext(n), ".")
	}
	return ""
}

// SyncEditions gives every stable non-audio file exactly one edition. Titles
// are linked conservatively: only a shared strong identifier with the same
// normalized title and authors reuses an existing title; a title-text match
// alone creates a separate, provisional title plus a review item (ADR-0061).
// Existing editions are never touched, so identity survives moves and
// same-path replacements (the edition follows the file ID).
func (s *Scanner) SyncEditions(ctx context.Context, lib uuid.UUID) error {
	q := sqlcgen.New(s.Pool)
	files, err := q.ListUneditionedEbookFiles(ctx, lib)
	if err != nil {
		return err
	}
	for _, f := range files {
		format := EditionFormat(f.Filename)
		if format == "" {
			continue
		}
		cfg, err := q.GetLibraryConfig(ctx, lib)
		if err != nil {
			return err
		}
		meta, merr := ebookmeta.Read(path.Join(cfg.RootPath, f.RelPath), format)
		if merr != nil && merr != ebookmeta.ErrUnsupported {
			s.log().Warn("embedded metadata unreadable; using file name", "path", f.RelPath, "error", merr)
		}
		if err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
			return s.insertEdition(ctx, sqlcgen.New(tx), lib, f.FileID, f.RelPath, format, meta)
		}); err != nil {
			return err
		}
	}
	return nil
}

// embeddedFields lists the metadata fields a file's own tags actually carry.
func embeddedFields(m ebookmeta.Meta) map[string]any {
	emb := map[string]any{}
	if m.Title != "" {
		emb["title"] = m.Title
	}
	if len(m.Authors) > 0 {
		emb["authors"] = m.Authors
	}
	if m.Series != "" {
		emb["series_name"] = m.Series
	}
	if m.SeriesIndex != nil {
		emb["series_index"] = *m.SeriesIndex
	}
	if m.Language != "" {
		emb["language"] = m.Language
	}
	if m.Publisher != "" {
		emb["publisher"] = m.Publisher
	}
	if m.Published != "" {
		emb["published"] = m.Published
	}
	if m.PageCount != nil {
		emb["page_count"] = *m.PageCount
	}
	if m.Identifier != "" {
		emb["isbn"] = m.Identifier
	}
	if m.Description != "" {
		emb["description"] = m.Description
	}
	return emb
}

// refreshEmbedded re-reads a replaced file's own tags (same file ID, new content version) and brings the edition's
// "embedded" evidence up to date, so a change made in the file itself, including an approved write-back, shows in the
// catalog. Evidence from other sources is never touched. Displayed values are re-resolved by source priority (ADR-0047),
// so an administrator edit or clear and a sidecar still win; the title row only follows while this edition is its sole
// child. An unreadable file keeps the previous evidence.
func (s *Scanner) refreshEmbedded(ctx context.Context, lib, fileID uuid.UUID, rel string) error {
	q := sqlcgen.New(s.Pool)
	ed, err := q.GetEditionByFileID(ctx, fileID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // audio files and files that never became editions
	}
	if err != nil {
		return err
	}
	cfg, err := q.GetLibraryConfig(ctx, lib)
	if err != nil {
		return err
	}
	m, merr := ebookmeta.Read(path.Join(cfg.RootPath, rel), ed.Format)
	if merr != nil || m.Source != "embedded" {
		if merr != nil && merr != ebookmeta.ErrUnsupported {
			s.log().Warn("embedded metadata unreadable after replacement; keeping previous", "path", rel, "error", merr)
		}
		return nil
	}
	emb := embeddedFields(m)
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		if _, err := q.LockEdition(ctx, ed.ID); err != nil {
			return err
		}
		rows, err := q.ListEditionMetadataValues(ctx, ed.ID)
		if err != nil {
			return err
		}
		have := map[string][]byte{}
		for _, r := range rows {
			if r.Source == "embedded" {
				have[r.Field] = r.Value
			}
		}
		changed := false
		for f := range have {
			if _, ok := emb[f]; !ok {
				if _, err := q.DeleteEditionMetadataValue(ctx, sqlcgen.DeleteEditionMetadataValueParams{EditionID: ed.ID, Field: f, Source: "embedded"}); err != nil {
					return err
				}
				changed = true
			}
		}
		for f, v := range emb {
			raw, err := json.Marshal(v)
			if err != nil {
				return err
			}
			var a, b any
			if old, ok := have[f]; ok && json.Unmarshal(old, &a) == nil && json.Unmarshal(raw, &b) == nil && reflect.DeepEqual(a, b) {
				continue
			}
			if err := q.UpsertEditionMetadataValue(ctx, sqlcgen.UpsertEditionMetadataValueParams{EditionID: ed.ID, Field: f, Source: "embedded", Value: raw}); err != nil {
				return err
			}
			changed = true
		}
		if !changed {
			return nil
		}
		if err := q.BumpEdition(ctx, ed.ID); err != nil {
			return err
		}
		// What is displayed follows the usual source priority, so a sidecar still outranks the file's new tags.
		return propagateEdition(ctx, q, ed.ID)
	})
}

func (s *Scanner) insertEdition(ctx context.Context, q *sqlcgen.Queries, lib, fileID uuid.UUID, rel, format string, m ebookmeta.Meta) error {
	name := m.Title
	if name == "" {
		name = strings.TrimSuffix(path.Base(rel), path.Ext(rel))
		name = strings.TrimSuffix(name, ".kepub")
	}
	author := ""
	if len(m.Authors) > 0 {
		author = m.Authors[0]
	}
	gk := normText(name) + "|" + normText(author)
	matches, err := q.ListLibraryTitlesByKeyAny(ctx, sqlcgen.ListLibraryTitlesByKeyAnyParams{LibraryID: lib, GroupKey: &gk})
	if err != nil {
		return err
	}
	titleID, link := uuid.Nil, "confirmed"
	if m.Identifier != "" {
		for _, t := range matches {
			if t.Identifier != nil && strings.EqualFold(*t.Identifier, m.Identifier) {
				titleID = t.ID
			}
		}
	}
	if titleID == uuid.Nil {
		titleID = uuid.New()
		authors := m.Authors
		if authors == nil {
			authors = []string{}
		}
		var ident *string
		if m.Identifier != "" {
			ident = &m.Identifier
		}
		var series *string
		if m.Series != "" {
			series = &m.Series
		}
		if err := q.InsertEditionTitle(ctx, sqlcgen.InsertEditionTitleParams{ID: titleID, Title: name, Authors: authors,
			SeriesName: series, SeriesIndex: m.SeriesIndex, GroupKey: &gk, Identifier: ident}); err != nil {
			return err
		}
		if m.Source == "" { // file name only: nothing corroborates the title
			link = "provisional"
		}
		if len(matches) > 0 {
			link = "provisional"
			ids := make([]string, 0, len(matches))
			for _, t := range matches {
				ids = append(ids, t.ID.String())
			}
			if err := s.review(ctx, lib, "grouping", "edition-title:"+fileID.String(), map[string]any{
				"reason":   "same title and authors as an existing title without a shared identifier",
				"newTitle": titleID.String(), "existingTitles": ids}); err != nil {
				return err
			}
		}
	}
	var lang *string
	if m.Language != "" {
		lang = &m.Language
	}
	edID := uuid.New()
	if err := q.InsertEdition(ctx, sqlcgen.InsertEditionParams{ID: edID, TitleID: titleID, LibraryID: lib, FileID: fileID,
		Label: strings.ToUpper(format), Language: lang, Format: format, LinkState: link}); err != nil {
		return err
	}
	if m.Source != "embedded" {
		return nil // the file name is a computed fallback, never stored as embedded evidence
	}
	for f, v := range embeddedFields(m) {
		raw, err := json.Marshal(v)
		if err != nil {
			return err
		}
		if err := q.UpsertEditionMetadataValue(ctx, sqlcgen.UpsertEditionMetadataValueParams{EditionID: edID, Field: f, Source: "embedded", Value: raw}); err != nil {
			return err
		}
	}
	return nil
}
