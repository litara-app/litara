package reading

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"path"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Administrator operations on one edition: title linking and metadata edits.
// Callers have already established administrator authority and a grant on
// EditionLibrary; these functions never touch file bytes or personal state.

var editionFields = []string{"title", "authors", "series_name", "series_index", "language", "tags"}

func validEditionField(f string) bool {
	for _, x := range editionFields {
		if x == f {
			return true
		}
	}
	return false
}

// EditionLibrary returns the library of an edition (404 when unknown).
func (s *Service) EditionLibrary(ctx context.Context, id uuid.UUID) (uuid.UUID, error) {
	ed, err := s.q.GetEditionRow(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, apperr.ErrNotFound
	}
	if err != nil {
		return uuid.Nil, dbErr(err)
	}
	return ed.LibraryID, nil
}

func staleEdition(current int64) *apperr.Error {
	return apperr.New(http.StatusConflict, "stale_revision", "The edition changed since that revision; refetch and retry.").
		With("currentRevision", strconv.FormatInt(current, 10))
}

// MetadataReport returns effective values with provenance and suppressed evidence.
func (s *Service) MetadataReport(ctx context.Context, id uuid.UUID) (wire.T005MetadataReport, error) {
	ed, err := s.q.GetEditionRow(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return wire.T005MetadataReport{}, apperr.ErrNotFound
	}
	if err != nil {
		return wire.T005MetadataReport{}, dbErr(err)
	}
	return s.report(ctx, s.q, ed.ID, ed.Revision)
}

func (s *Service) report(ctx context.Context, q *sqlcgen.Queries, id uuid.UUID, revision int64) (wire.T005MetadataReport, error) {
	out := wire.T005MetadataReport{EditionID: id.String(), Revision: strconv.FormatInt(revision, 10), Fields: []wire.T005MetadataField{}}
	rows, err := q.ListEditionMetadataValues(ctx, id)
	if err != nil {
		return out, dbErr(err)
	}
	vals := make([]metadata.Value, 0, len(rows)+1)
	for _, r := range rows {
		vals = append(vals, metadata.Value{Field: r.Field, Source: r.Source, Raw: r.Value, ProtectedClear: r.ProtectedClear})
	}
	if name, err := q.GetEditionFileName(ctx, id); err == nil { // the file name is the lowest fallback, not embedded evidence
		stem := strings.TrimSuffix(strings.TrimSuffix(name, path.Ext(name)), ".kepub")
		if stem != "" {
			vals = append(vals, metadata.Value{Field: "title", Source: metadata.SourceFilename, Raw: wire.Raw(stem)})
		}
	}
	eff := metadata.Resolve(vals)
	for _, f := range editionFields {
		e, ok := eff[f]
		if !ok {
			continue
		}
		mf := wire.T005MetadataField{Field: f, Source: e.Source, Cleared: e.Cleared, Conflicts: []wire.T005MetadataEvidence{}}
		if !e.Cleared {
			mf.Value = wire.T005MetadataValue{Raw: e.Raw}
		}
		for _, c := range e.Conflicts {
			mf.Conflicts = append(mf.Conflicts, wire.T005MetadataEvidence{Source: c.Source, Value: wire.T005MetadataValue{Raw: c.Raw}})
		}
		out.Fields = append(out.Fields, mf)
	}
	return out, nil
}

// editionValue validates a protected edit and returns its stored JSON (nil for a clear).
func editionValue(field string, w wire.T005MetadataWrite) (json.RawMessage, error) {
	raw := bytes.TrimSpace(w.Value.Raw)
	isNull := len(raw) == 0 || string(raw) == "null"
	if w.Clear {
		if !isNull {
			return nil, apperr.Validation("A clear must send value null.")
		}
		if field == "title" {
			return nil, apperr.Validation("The title cannot be cleared.")
		}
		return nil, nil
	}
	if isNull {
		return nil, apperr.Validation("value must have the field type unless clear is true.")
	}
	switch field {
	case "title", "series_name", "language":
		var v string
		if json.Unmarshal(raw, &v) != nil || strings.TrimSpace(v) == "" || len([]rune(v)) > 4096 {
			return nil, apperr.Validation(field + " must be a non-empty string.")
		}
	case "authors", "tags":
		var v []string
		if json.Unmarshal(raw, &v) != nil || len(v) == 0 || len(v) > 100 {
			return nil, apperr.Validation(field + " must be a non-empty array of up to 100 strings.")
		}
		for _, x := range v {
			if strings.TrimSpace(x) == "" || len([]rune(x)) > 1024 {
				return nil, apperr.Validation(field + " entries must be 1 to 1024 characters.")
			}
		}
	case "series_index":
		var v float64
		if json.Unmarshal(raw, &v) != nil || v < 0 {
			return nil, apperr.Validation("series_index must be a nonnegative number.")
		}
	}
	return json.RawMessage(append([]byte(nil), raw...)), nil
}

// propagate applies effective values to the rows that display them: the edition
// language always, and the title fields only while this edition is the title's
// sole child, so another edition's evidence is never silently overwritten.
func (s *Service) propagate(ctx context.Context, q *sqlcgen.Queries, ed sqlcgen.Edition) error {
	rep, err := s.report(ctx, q, ed.ID, ed.Revision)
	if err != nil {
		return err
	}
	eff := map[string]wire.T005MetadataField{}
	for _, f := range rep.Fields {
		eff[f.Field] = f
	}
	var lang *string
	if f, ok := eff["language"]; ok && !f.Cleared {
		var v string
		if json.Unmarshal(f.Value.Raw, &v) == nil && v != "" {
			lang = &v
		}
	}
	if err := q.SetEditionLanguage(ctx, sqlcgen.SetEditionLanguageParams{ID: ed.ID, Language: lang}); err != nil {
		return err
	}
	n, err := q.CountTitleChildren(ctx, ed.TitleID)
	if err != nil || n != 1 {
		return err
	}
	t, err := q.GetTitleRow(ctx, ed.TitleID)
	if err != nil {
		return err
	}
	name, authors, series, index := t.Title, t.Authors, t.SeriesName, t.SeriesIndex
	if f, ok := eff["title"]; ok && !f.Cleared {
		var v string
		if json.Unmarshal(f.Value.Raw, &v) == nil && v != "" {
			name = v
		}
	}
	if f, ok := eff["authors"]; ok {
		authors = []string{}
		if !f.Cleared {
			_ = json.Unmarshal(f.Value.Raw, &authors)
		}
	}
	if f, ok := eff["series_name"]; ok {
		series = nil
		if !f.Cleared {
			var v string
			if json.Unmarshal(f.Value.Raw, &v) == nil {
				series = &v
			}
		}
	}
	if f, ok := eff["series_index"]; ok {
		index = nil
		if !f.Cleared {
			var v float64
			if json.Unmarshal(f.Value.Raw, &v) == nil {
				index = &v
			}
		}
	}
	return q.UpdateTitleFields(ctx, sqlcgen.UpdateTitleFieldsParams{ID: t.ID, Title: name, Authors: authors, SeriesName: series, SeriesIndex: index})
}

// mutateEdition runs one revisioned, idempotent administrator change.
func (s *Service) mutateEdition(ctx context.Context, a Actor, id, op uuid.UUID, base int64, fp []byte,
	change func(q *sqlcgen.Queries, ed sqlcgen.Edition) (*apperr.Error, error), render func(q *sqlcgen.Queries) ([]byte, error)) ([]byte, error) {
	return s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error {
		_, err := q.LockEdition(ctx, id)
		return err
	}, func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		ed, err := q.LockEdition(ctx, id)
		if err != nil {
			return nil, nil, err
		}
		if base != ed.Revision {
			return nil, staleEdition(ed.Revision), nil
		}
		if d, err := change(q, ed); err != nil || d != nil {
			return nil, d, err
		}
		if err := q.BumpEdition(ctx, id); err != nil {
			return nil, nil, err
		}
		body, err := render(q)
		return body, nil, err
	})
}

func (s *Service) renderReport(ctx context.Context, id uuid.UUID) func(q *sqlcgen.Queries) ([]byte, error) {
	return func(q *sqlcgen.Queries) ([]byte, error) {
		ed, err := q.LockEdition(ctx, id)
		if err != nil {
			return nil, err
		}
		rep, err := s.report(ctx, q, id, ed.Revision)
		return wire.Raw(rep), err
	}
}

func (s *Service) SetEditionMetadata(ctx context.Context, a Actor, id uuid.UUID, field string, w wire.T005MetadataWrite) (wire.T005MetadataReport, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.T005MetadataReport{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.T005MetadataReport{}, err
	}
	if !validEditionField(field) {
		return wire.T005MetadataReport{}, apperr.Validation("Unknown metadata field.")
	}
	raw, err := editionValue(field, w)
	if err != nil {
		return wire.T005MetadataReport{}, err
	}
	if _, err := s.EditionLibrary(ctx, id); err != nil {
		return wire.T005MetadataReport{}, err
	}
	fp := fingerprint(http.MethodPut, "/admin/editions/"+id.String()+"/metadata/"+field, w)
	body, err := s.mutateEdition(ctx, a, id, op, base, fp, func(q *sqlcgen.Queries, ed sqlcgen.Edition) (*apperr.Error, error) {
		if err := q.UpsertEditionMetadataValue(ctx, sqlcgen.UpsertEditionMetadataValueParams{EditionID: id, Field: field, Source: metadata.SourceUser,
			Value: raw, ProtectedClear: raw == nil}); err != nil {
			return nil, err
		}
		return nil, s.propagate(ctx, q, ed)
	}, s.renderReport(ctx, id))
	if err != nil {
		return wire.T005MetadataReport{}, err
	}
	var out wire.T005MetadataReport
	return out, json.Unmarshal(body, &out)
}

func (s *Service) RemoveEditionMetadata(ctx context.Context, a Actor, id uuid.UUID, field string, w wire.T005MetadataRemove) (wire.T005MetadataReport, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.T005MetadataReport{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.T005MetadataReport{}, err
	}
	if !validEditionField(field) {
		return wire.T005MetadataReport{}, apperr.Validation("Unknown metadata field.")
	}
	if _, err := s.EditionLibrary(ctx, id); err != nil {
		return wire.T005MetadataReport{}, err
	}
	fp := fingerprint(http.MethodDelete, "/admin/editions/"+id.String()+"/metadata/"+field, w)
	body, err := s.mutateEdition(ctx, a, id, op, base, fp, func(q *sqlcgen.Queries, ed sqlcgen.Edition) (*apperr.Error, error) {
		n, err := q.DeleteEditionMetadataValue(ctx, sqlcgen.DeleteEditionMetadataValueParams{EditionID: id, Field: field, Source: metadata.SourceUser})
		if err != nil {
			return nil, err
		}
		if n == 0 {
			return nil, apperr.ErrNotFound // nothing to remove; an error rolls back without a receipt
		}
		return nil, s.propagate(ctx, q, ed)
	}, s.renderReport(ctx, id))
	if err != nil {
		return wire.T005MetadataReport{}, err
	}
	var out wire.T005MetadataReport
	return out, json.Unmarshal(body, &out)
}

// LinkEditionTitle moves an edition to another title of the same library, or
// (titleId null) separates it into a new title built from its effective metadata.
func (s *Service) LinkEditionTitle(ctx context.Context, a Actor, id uuid.UUID, w wire.T005EditionLink) (wire.T005Edition, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.T005Edition{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.T005Edition{}, err
	}
	var target *uuid.UUID
	if w.TitleID != nil {
		t, err := parseUUID("titleId", *w.TitleID)
		if err != nil {
			return wire.T005Edition{}, err
		}
		target = &t
	}
	if _, err := s.EditionLibrary(ctx, id); err != nil {
		return wire.T005Edition{}, err
	}
	fp := fingerprint(http.MethodPut, "/admin/editions/"+id.String()+"/title", w)
	body, err := s.mutateEdition(ctx, a, id, op, base, fp, func(q *sqlcgen.Queries, ed sqlcgen.Edition) (*apperr.Error, error) {
		if target != nil {
			if *target == ed.TitleID {
				return nil, apperr.Validation("The edition is already linked to that title.")
			}
			held, err := q.TitleHeldInLibrary(ctx, sqlcgen.TitleHeldInLibraryParams{TitleID: *target, LibraryID: ed.LibraryID})
			if err != nil {
				return nil, err
			}
			if !held {
				return nil, apperr.Validation("That title is not represented in this edition's library.")
			}
			return nil, q.SetEditionTitle(ctx, sqlcgen.SetEditionTitleParams{ID: id, TitleID: *target})
		}
		if n, err := q.CountTitleChildren(ctx, ed.TitleID); err != nil {
			return nil, err
		} else if n <= 1 {
			return nil, apperr.Validation("The edition is already the only item of its title.")
		}
		rep, err := s.report(ctx, q, id, ed.Revision)
		if err != nil {
			return nil, err
		}
		name, authors := "", []string{}
		var series *string
		var index *float64
		for _, f := range rep.Fields {
			if f.Cleared {
				continue
			}
			switch f.Field {
			case "title":
				_ = json.Unmarshal(f.Value.Raw, &name)
			case "authors":
				_ = json.Unmarshal(f.Value.Raw, &authors)
			case "series_name":
				var v string
				if json.Unmarshal(f.Value.Raw, &v) == nil {
					series = &v
				}
			case "series_index":
				var v float64
				if json.Unmarshal(f.Value.Raw, &v) == nil {
					index = &v
				}
			}
		}
		if name == "" {
			name = "(untitled)"
		}
		nt := uuid.New()
		if err := q.InsertPlainTitle(ctx, sqlcgen.InsertPlainTitleParams{ID: nt, Title: name, Authors: authors, SeriesName: series, SeriesIndex: index}); err != nil {
			return nil, err
		}
		return nil, q.SetEditionTitle(ctx, sqlcgen.SetEditionTitleParams{ID: id, TitleID: nt})
	}, func(q *sqlcgen.Queries) ([]byte, error) {
		e, err := s.cat.EditionTx(ctx, q, a.UserID, id)
		return wire.Raw(e), err
	})
	if err != nil {
		return wire.T005Edition{}, err
	}
	var out wire.T005Edition
	return out, json.Unmarshal(body, &out)
}
