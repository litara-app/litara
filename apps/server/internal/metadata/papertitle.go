package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
)

// A paper-only title has no ebook edition or recording to edit its details through (ADR-0116). Its values are stored
// as title values, so an ebook or recording linked to it later keeps the person's edits by the usual precedence.

// NormText keeps only letters and digits, lower-cased, so small differences in punctuation do not matter.
func NormText(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// TitleKey is what a scan compares to find a title with the same name and first author.
func TitleKey(name string, authors []string) string {
	author := ""
	if len(authors) > 0 {
		author = authors[0]
	}
	return NormText(name) + "|" + NormText(author)
}

// TitleField reports whether a field can be edited on a paper-only title. Narrators belong to recordings, and an ISBN
// belongs to a copy.
func TitleField(field string) bool {
	return Valid(field) && SubjectKind(field) == "title" && field != FieldISBN
}

// CheckValue validates a protected edit of a title field.
func CheckValue(field string, raw json.RawMessage) error { return checkUserValue(field, raw) }

// titleOnly stands in for a recording when only title rows are involved: no recording has the nil ID.
func titleOnly(titleID uuid.UUID) sqlcgen.GetRecordingRowRow {
	return sqlcgen.GetRecordingRowRow{ID: uuid.Nil, TitleID: titleID}
}

// TitleReport is the effective title values and the revision a save must be based on.
func (s *Service) TitleReport(ctx context.Context, titleID uuid.UUID) (map[string]Effective, int64, error) {
	q := sqlcgen.New(s.Pool)
	rep, rev, err := reportQ(ctx, q, titleOnly(titleID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, 0, apperr.ErrNotFound
	}
	if err != nil {
		return nil, 0, apperr.ErrUnavailable
	}
	return rep, rev, nil
}

// SaveTitle is Save for a paper-only title.
func (s *Service) SaveTitle(ctx context.Context, userID, titleID, op uuid.UUID, base int64, changes []Change, fp []byte,
	render func(map[string]Effective, int64) []byte) ([]byte, error) {
	if d := CheckChanges(changes, TitleField); d != nil {
		return nil, d
	}
	for _, c := range changes {
		if c.Action != ActionSet {
			continue
		}
		var raw json.RawMessage
		if !c.Clear {
			raw = c.Value
		}
		if err := checkUserValue(c.Field, raw); err != nil {
			return nil, err
		}
	}
	rec := titleOnly(titleID)
	return s.saveRows(ctx, userID, op, base, changes, fp, render, rec, func(q *sqlcgen.Queries) error {
		if err := applyTitleQ(ctx, q, titleID); err != nil {
			return err
		}
		t, err := q.GetTitleRow(ctx, titleID)
		if err != nil {
			return err
		}
		key := TitleKey(t.Title, t.Authors)
		return q.SetTitleGroupKey(ctx, sqlcgen.SetTitleGroupKeyParams{ID: titleID, GroupKey: &key})
	})
}
