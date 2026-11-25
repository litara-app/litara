package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
)

// Service stores per-source values and applies the resolved result.
type Service struct {
	Pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{Pool: pool} }

// subject resolves which row holds a field for a recording.
func subject(rec sqlcgen.GetRecordingRowRow, field string) uuid.UUID {
	if SubjectKind(field) == "recording" {
		return rec.ID
	}
	return rec.TitleID
}

func fromRows(rows []sqlcgen.MetadataValue) []Value {
	var out []Value
	for _, r := range rows {
		out = append(out, Value{Field: r.Field, Source: r.Source, Raw: r.Value, ProtectedClear: r.ProtectedClear, Locked: r.Locked})
	}
	return out
}

// Refresh re-reads embedded tags and associated sidecars for every recording
// in a library, stores them as source values and re-applies the resolved
// result. User values are never touched.
func (s *Service) Refresh(ctx context.Context, lib uuid.UUID) error {
	q := sqlcgen.New(s.Pool)
	recs, err := q.ListLibraryRecordings(ctx, lib)
	if err != nil {
		return err
	}
	var ids []uuid.UUID
	for _, r := range recs {
		ids = append(ids, r.ID)
	}
	members, err := q.ListRecordingMembers(ctx, ids)
	if err != nil {
		return err
	}
	first := map[uuid.UUID][]byte{}
	for _, m := range members {
		if _, ok := first[m.RecordingID]; !ok {
			first[m.RecordingID] = m.Result
		}
	}
	assoc, err := q.ListLibraryAssociated(ctx, lib)
	if err != nil {
		return err
	}
	sidecars := map[uuid.UUID][]sqlcgen.ListLibraryAssociatedRow{}
	for _, a := range assoc {
		sidecars[a.RecordingID.UUID] = append(sidecars[a.RecordingID.UUID], a)
	}
	root := ""
	if cfg, err := q.GetLibraryConfig(ctx, lib); err == nil {
		root, _ = filepath.EvalSymlinks(cfg.RootPath)
	}

	for _, r := range recs {
		var embedded Fields
		if raw := first[r.ID]; len(raw) > 0 {
			var res inspect.Result
			if json.Unmarshal(raw, &res) == nil {
				embedded = FromTags(res.Format.Tags)
			}
		}
		var side Fields
		for _, kind := range []string{"json", "opf"} { // Litara JSON outranks OPF
			for _, a := range sidecars[r.ID] {
				if a.Kind != kind {
					continue
				}
				if f, ok := readSidecar(root, a.RelPath, kind); ok {
					if side == nil {
						side = Fields{}
					}
					for k, v := range f {
						if _, have := side[k]; !have {
							side[k] = v
						}
					}
				}
			}
		}
		rec := sqlcgen.GetRecordingRowRow{ID: r.ID, TitleID: r.TitleID}
		embChanged, err := s.storeSource(ctx, q, rec, SourceEmbedded, embedded)
		if err != nil {
			return err
		}
		sideChanged, err := s.storeSource(ctx, q, rec, SourceSidecar, side)
		if err != nil {
			return err
		}
		if embChanged || sideChanged { // a form loaded before this rescan must not save over what it brought
			if err := q.BumpTitleMetadataRevision(ctx, rec.TitleID); err != nil {
				return err
			}
		}
		if err := s.Apply(ctx, rec.ID); err != nil {
			return err
		}
	}
	return nil
}

// ReadSidecar reads and parses one associated sidecar ("json" for Litara JSON, "opf" for an OPF package) under root.
func ReadSidecar(root, rel, kind string) (Fields, bool) { return readSidecar(root, rel, kind) }

func readSidecar(root, rel, kind string) (Fields, bool) {
	if root == "" {
		return nil, false
	}
	full := filepath.Join(root, filepath.FromSlash(rel))
	if r, err := filepath.Rel(root, full); err != nil || strings.HasPrefix(r, "..") {
		return nil, false
	}
	f, err := os.Open(full)
	if err != nil {
		return nil, false
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxSidecarBytes+1))
	if err != nil {
		return nil, false
	}
	var out Fields
	if kind == "opf" {
		out, err = ParseOPF(data)
	} else {
		out, err = ParseLitaraJSON(data)
	}
	return out, err == nil
}

var allFields = []string{FieldTitle, FieldAuthors, FieldSeriesName, FieldSeriesIndex, FieldNarrators, FieldPublisher, FieldPublished, FieldISBN, FieldDescription}

// storeSource replaces one source's values (a field missing from fields is removed) and reports whether anything
// stored changed.
func (s *Service) storeSource(ctx context.Context, q *sqlcgen.Queries, rec sqlcgen.GetRecordingRowRow, source string, fields Fields) (bool, error) {
	changed := false
	for _, f := range allFields {
		kind, sid := SubjectKind(f), subject(rec, f)
		var n int64
		var err error
		if raw, ok := fields[f]; ok {
			n, err = q.UpsertMetadataValue(ctx, sqlcgen.UpsertMetadataValueParams{SubjectKind: kind, SubjectID: sid, Field: f, Source: source, Value: raw})
		} else {
			n, err = q.DeleteMetadataValue(ctx, sqlcgen.DeleteMetadataValueParams{SubjectKind: kind, SubjectID: sid, Field: f, Source: source})
		}
		if err != nil {
			return false, err
		}
		changed = changed || n > 0
	}
	return changed, nil
}

// Apply writes the resolved values for a recording's title and narrators.
func (s *Service) Apply(ctx context.Context, recordingID uuid.UUID) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error { return applyQ(ctx, sqlcgen.New(tx), recordingID) })
}

// applyQ is Apply inside the caller's transaction.
func applyQ(ctx context.Context, q *sqlcgen.Queries, recordingID uuid.UUID) error {
	{
		rec, err := q.GetRecordingRow(ctx, recordingID)
		if err != nil {
			return err
		}
		title, err := q.GetTitleRow(ctx, rec.TitleID)
		if err != nil {
			return err
		}
		tv, err := q.ListMetadataValues(ctx, sqlcgen.ListMetadataValuesParams{SubjectKind: "title", SubjectID: rec.TitleID})
		if err != nil {
			return err
		}
		eff := Resolve(fromRows(tv))
		name, authors, sname, sidx := title.Title, title.Authors, title.SeriesName, title.SeriesIndex
		if e, ok := eff[FieldTitle]; ok && !e.Cleared {
			var v string
			if json.Unmarshal(e.Raw, &v) == nil && strings.TrimSpace(v) != "" {
				name = v
			}
		}
		if e, ok := eff[FieldAuthors]; ok {
			authors = []string{}
			if !e.Cleared {
				_ = json.Unmarshal(e.Raw, &authors)
			}
		}
		if e, ok := eff[FieldSeriesName]; ok {
			sname = nil
			if !e.Cleared {
				var v string
				if json.Unmarshal(e.Raw, &v) == nil {
					sname = &v
				}
			}
		}
		if e, ok := eff[FieldSeriesIndex]; ok {
			sidx = nil
			if !e.Cleared {
				var v float64
				if json.Unmarshal(e.Raw, &v) == nil {
					sidx = &v
				}
			}
		}
		if err := q.UpdateTitleFields(ctx, sqlcgen.UpdateTitleFieldsParams{ID: title.ID, Title: name, Authors: authors, SeriesName: sname, SeriesIndex: sidx}); err != nil {
			return err
		}
		rv, err := q.ListMetadataValues(ctx, sqlcgen.ListMetadataValuesParams{SubjectKind: "recording", SubjectID: rec.ID})
		if err != nil {
			return err
		}
		if e, ok := Resolve(fromRows(rv))[FieldNarrators]; ok {
			narr := []string{}
			if !e.Cleared {
				_ = json.Unmarshal(e.Raw, &narr)
			}
			return q.UpdateRecordingNarrators(ctx, sqlcgen.UpdateRecordingNarratorsParams{ID: rec.ID, Narrators: narr})
		}
		return nil
	}
}

// EffectiveForTitle resolves a title's stored values (user edits, sidecar, embedded, provider) by precedence.
func EffectiveForTitle(ctx context.Context, q *sqlcgen.Queries, titleID uuid.UUID) (map[string]Effective, error) {
	rows, err := q.ListMetadataValues(ctx, sqlcgen.ListMetadataValuesParams{SubjectKind: "title", SubjectID: titleID})
	if err != nil {
		return nil, err
	}
	return Resolve(fromRows(rows)), nil
}

// validate checks a user-supplied value for its field.
func validate(field string, raw json.RawMessage) error {
	switch field {
	case FieldTitle, FieldSeriesName:
		var v string
		if json.Unmarshal(raw, &v) != nil || strings.TrimSpace(v) == "" {
			return apperr.Validation(field + " must be a non-empty string")
		}
	case FieldAuthors, FieldNarrators:
		var v []string
		if json.Unmarshal(raw, &v) != nil || len(v) == 0 {
			return apperr.Validation(field + " must be a non-empty list of strings")
		}
		for _, s := range v {
			if strings.TrimSpace(s) == "" {
				return apperr.Validation(field + " entries must not be empty")
			}
		}
	case FieldSeriesIndex:
		var v float64
		if json.Unmarshal(raw, &v) != nil || v < 0 {
			return apperr.Validation("series_index must be a non-negative number")
		}
	case FieldPublisher:
		if v, ok := stringOf(raw); !ok || strings.TrimSpace(v) == "" || len([]rune(v)) > 512 {
			return apperr.Validation("publisher must be a non-empty string of up to 512 characters")
		}
	case FieldDescription:
		if v, ok := stringOf(raw); !ok || strings.TrimSpace(v) == "" || len([]rune(v)) > MaxDescription {
			return apperr.Validation("description must be a non-empty string of up to 8000 characters")
		}
	case FieldPublished:
		if v, ok := stringOf(raw); !ok || !publishedRe.MatchString(v) {
			return apperr.Validation("published must be YYYY, YYYY-MM or YYYY-MM-DD")
		}
	case FieldISBN:
		if v, ok := stringOf(raw); !ok || !isbnRe.MatchString(v) {
			return apperr.Validation("isbn must be 10 or 13 characters (digits, and X for the last of ten) with no hyphens")
		}
	default:
		return apperr.Validation("unknown field " + field)
	}
	return nil
}

func stringOf(raw json.RawMessage) (string, bool) {
	var v string
	return v, json.Unmarshal(raw, &v) == nil
}

// SetUser stores a protected edit (value) or a protected clear (raw == nil). It is the older per-field write, which
// carries no revision; a locked field refuses it (ADR-0097). Save is the revisioned form.
func (s *Service) SetUser(ctx context.Context, recordingID uuid.UUID, field string, raw json.RawMessage) error {
	if err := checkUserValue(field, raw); err != nil {
		return err
	}
	return s.unrevisioned(ctx, recordingID, func(q *sqlcgen.Queries, rec sqlcgen.GetRecordingRowRow) (bool, *apperr.Error, error) {
		return setUserQ(ctx, q, rec, field, raw)
	})
}

// RemoveUser drops the user's override so lower sources apply again ("Reset to source"). A locked field refuses it.
func (s *Service) RemoveUser(ctx context.Context, recordingID uuid.UUID, field string) error {
	if !Valid(field) {
		return apperr.Validation("unknown field " + field)
	}
	return s.unrevisioned(ctx, recordingID, func(q *sqlcgen.Queries, rec sqlcgen.GetRecordingRowRow) (bool, *apperr.Error, error) {
		return resetQ(ctx, q, rec, field)
	})
}

// unrevisioned runs one older per-field write in a transaction that holds the title's metadata revision, so it is
// still ordered against revisioned saves and still advances the revision when it changes something.
func (s *Service) unrevisioned(ctx context.Context, recordingID uuid.UUID, change func(q *sqlcgen.Queries, rec sqlcgen.GetRecordingRowRow) (bool, *apperr.Error, error)) error {
	var refused *apperr.Error
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		rec, err := q.GetRecordingRow(ctx, recordingID)
		if err != nil {
			return err
		}
		if _, err := q.LockTitleMetadataRevision(ctx, rec.TitleID); err != nil {
			return err
		}
		changed, d, err := change(q, rec)
		if err != nil {
			return err
		}
		if d != nil {
			refused = d
			return errRefused // roll back anything the change did before it was refused
		}
		if !changed {
			return nil
		}
		if err := q.BumpTitleMetadataRevision(ctx, rec.TitleID); err != nil {
			return err
		}
		return applyQ(ctx, q, rec.ID)
	})
	switch {
	case refused != nil:
		return refused
	case errors.Is(err, pgx.ErrNoRows):
		return apperr.ErrNotFound
	case err != nil:
		return apperr.ErrUnavailable
	}
	return nil
}

var errRefused = errors.New("metadata change refused")

// Report returns the effective value and conflicts for every field.
func (s *Service) Report(ctx context.Context, recordingID uuid.UUID) (map[string]Effective, error) {
	rep, _, err := s.ReportWithRevision(ctx, recordingID)
	return rep, err
}

// ReportWithRevision is Report plus the title's metadata revision that a save must be based on.
func (s *Service) ReportWithRevision(ctx context.Context, recordingID uuid.UUID) (map[string]Effective, int64, error) {
	q := sqlcgen.New(s.Pool)
	rec, err := q.GetRecordingRow(ctx, recordingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, 0, apperr.ErrNotFound
	}
	if err != nil {
		return nil, 0, apperr.ErrUnavailable
	}
	rep, rev, err := reportQ(ctx, q, rec)
	if err != nil {
		return nil, 0, apperr.ErrUnavailable
	}
	return rep, rev, nil
}

func reportQ(ctx context.Context, q *sqlcgen.Queries, rec sqlcgen.GetRecordingRowRow) (map[string]Effective, int64, error) {
	rev, err := q.GetTitleMetadataRevision(ctx, rec.TitleID)
	if err != nil {
		return nil, 0, err
	}
	var vals []Value
	for _, kind := range []struct {
		k  string
		id uuid.UUID
	}{{"title", rec.TitleID}, {"recording", rec.ID}} {
		rows, err := q.ListMetadataValues(ctx, sqlcgen.ListMetadataValuesParams{SubjectKind: kind.k, SubjectID: kind.id})
		if err != nil {
			return nil, 0, err
		}
		vals = append(vals, fromRows(rows)...)
	}
	return Resolve(vals), rev, nil
}

// LibraryOf returns the library that owns a recording (for permission checks).
func (s *Service) LibraryOf(ctx context.Context, recordingID uuid.UUID) (uuid.UUID, error) {
	rec, err := sqlcgen.New(s.Pool).GetRecordingRow(ctx, recordingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, apperr.ErrNotFound
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("%w", apperr.ErrUnavailable)
	}
	return rec.LibraryID, nil
}
