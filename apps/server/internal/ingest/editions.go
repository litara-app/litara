package ingest

import (
	"context"
	"path"
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
				"reason": "same title and authors as an existing title without a shared identifier",
				"newTitle": titleID.String(), "existingTitles": ids}); err != nil {
				return err
			}
		}
	}
	var lang *string
	if m.Language != "" {
		lang = &m.Language
	}
	return q.InsertEdition(ctx, sqlcgen.InsertEditionParams{ID: uuid.New(), TitleID: titleID, LibraryID: lib, FileID: fileID,
		Label: strings.ToUpper(format), Language: lang, Format: format, LinkState: link})
}
