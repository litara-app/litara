package reading

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"golang.org/x/text/unicode/norm"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Smart shelf filters (ADR-0066). A filter is compiled to one parameterized
// query over the viewer's own grants and personal state; values are always
// bound parameters, never interpolated, and field names come from a fixed set.

const (
	maxFilterDepth      = 4
	maxFilterPredicates = 32
	maxFilterBytes      = 32 * 1024
)

var (
	ebookFormats = map[string]bool{"epub": true, "kepub": true, "mobi": true, "azw": true, "azw3": true, "fb2": true, "pdf": true, "cbz": true, "cbr": true, "cb7": true}
	audioFormats = map[string]bool{"mp3": true, "m4a": true, "m4b": true, "aac": true, "ogg": true, "opus": true, "flac": true, "wav": true, "wma": true, "mka": true}
)

// fold is NFC plus lower-casing. Postgres applies lower(normalize(x, NFC)) to
// stored values. Special full case foldings (for example German sharp s) are
// not expanded; this is a documented limitation.
func fold(s string) string { return strings.ToLower(norm.NFC.String(s)) }

// ValidateFilter enforces the grammar limits; failures are 422.
func ValidateFilter(f wire.T005Filter) error {
	raw, err := json.Marshal(f)
	if err != nil {
		return apperr.Validation("The filter is not valid.")
	}
	if len(raw) > maxFilterBytes {
		return apperr.Validation("The serialized filter exceeds 32 KiB.")
	}
	n := 0
	return validateNode(f, 1, &n)
}

func validateNode(f wire.T005Filter, depth int, preds *int) error {
	if depth > maxFilterDepth {
		return apperr.Validation("The filter nests deeper than 4 levels.")
	}
	switch {
	case f.Predicate != nil:
		*preds++
		if *preds > maxFilterPredicates {
			return apperr.Validation("The filter has more than 32 predicates.")
		}
		return validatePredicate(*f.Predicate)
	case f.Group != nil:
		if len(f.Group.Children) < 1 || len(f.Group.Children) > 32 {
			return apperr.Validation("A filter group needs 1 to 32 children.")
		}
		if f.Group.Kind != "all" && f.Group.Kind != "any" {
			return apperr.Validation("A filter group kind must be all or any.")
		}
		for _, c := range f.Group.Children {
			if err := validateNode(c, depth+1, preds); err != nil {
				return err
			}
		}
		return nil
	case f.Not != nil:
		return validateNode(f.Not.Child, depth+1, preds)
	}
	return apperr.Validation("The filter is empty.")
}

func validatePredicate(p wire.T005Predicate) error {
	v := fold(p.Value)
	if v == "" || len([]rune(p.Value)) > 512 {
		return apperr.Validation("A predicate value must be 1 to 512 characters.")
	}
	if p.Operator != "equals" && p.Operator != "contains" {
		return apperr.Validation("A predicate operator must be equals or contains.")
	}
	switch p.Field {
	case "title", "author", "series", "language", "tag":
	case "finished", "inProgress":
		if p.Operator != "equals" || (p.Value != "true" && p.Value != "false") {
			return apperr.Validation(p.Field + " requires equals with the string true or false.")
		}
	case "mediaKind":
		if p.Operator != "equals" || (v != "ebook" && v != "audio") {
			return apperr.Validation("mediaKind requires equals with ebook or audio.")
		}
	case "format":
		if p.Operator != "equals" || !(ebookFormats[v] || audioFormats[v]) {
			return apperr.Validation("format requires equals with one accepted lowercase extension.")
		}
	default:
		return apperr.Validation("Unknown predicate field.")
	}
	return nil
}

// builder accumulates bound arguments; $1 is always the viewer.
type builder struct{ args []any }

func (b *builder) bind(v any) string {
	b.args = append(b.args, v)
	return fmt.Sprintf("$%d", len(b.args))
}

const (
	grantedEditions   = `SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = $1 WHERE e.title_id = t.id`
	grantedRecordings = `SELECT 1 FROM recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = $1 WHERE r.title_id = t.id`
	visibleTitle      = `(EXISTS (` + grantedEditions + `) OR EXISTS (` + grantedRecordings + `))`
)

func (b *builder) cmp(col string, p wire.T005Predicate) string {
	n := b.bind(fold(p.Value))
	if p.Operator == "equals" {
		return fmt.Sprintf("lower(normalize(%s, NFC)) = %s", col, n)
	}
	return fmt.Sprintf("position(%s in lower(normalize(%s, NFC))) > 0", n, col)
}

func (b *builder) predicate(p wire.T005Predicate) string {
	switch p.Field {
	case "title":
		return "(" + b.cmp("t.title", p) + ")"
	case "author":
		return "EXISTS (SELECT 1 FROM unnest(t.authors) AS a(v) WHERE " + b.cmp("a.v", p) + ")"
	case "series":
		return "(t.series_name IS NOT NULL AND " + b.cmp("t.series_name", p) + ")"
	case "language":
		return "EXISTS (" + grantedEditions + " AND e.language IS NOT NULL AND " + b.cmp("e.language", p) + ")"
	case "tag":
		return `EXISTS (SELECT 1 FROM metadata_values mv, jsonb_array_elements_text(CASE WHEN jsonb_typeof(mv.value) = 'array' THEN mv.value ELSE '[]'::jsonb END) AS tg(v)
		        WHERE mv.subject_kind = 'title' AND mv.subject_id = t.id AND mv.field = 'tags' AND NOT mv.protected_clear AND ` + b.cmp("tg.v", p) + ")"
	case "mediaKind":
		if fold(p.Value) == "ebook" {
			return "EXISTS (" + grantedEditions + ")"
		}
		return "EXISTS (" + grantedRecordings + ")"
	case "format":
		n := b.bind(fold(p.Value))
		return "(EXISTS (" + grantedEditions + " AND e.format = " + n + `) OR EXISTS (SELECT 1 FROM recordings r
		        JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = $1
		        JOIN recording_files rf ON rf.recording_id = r.id
		        JOIN file_versions fv ON fv.file_id = rf.file_id AND fv.current
		        WHERE r.title_id = t.id AND lower(substring(fv.filename from '\.([^.]+)$')) = ` + n + "))"
	case "finished":
		q := `(EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = $1
		        JOIN edition_completion_state cs ON cs.edition_id = e.id AND cs.user_id = $1 AND cs.finished WHERE e.title_id = t.id)
		   OR EXISTS (SELECT 1 FROM recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = $1
		        JOIN completion_state cs ON cs.recording_id = r.id AND cs.user_id = $1 AND cs.finished WHERE r.title_id = t.id))`
		return truth(q, p.Value)
	case "inProgress":
		q := `(EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = $1
		        JOIN edition_position_state ps ON ps.edition_id = e.id AND ps.user_id = $1 AND ps.file_id IS NOT NULL
		        WHERE e.title_id = t.id AND NOT EXISTS (SELECT 1 FROM edition_completion_state cs WHERE cs.edition_id = e.id AND cs.user_id = $1 AND cs.finished))
		   OR EXISTS (SELECT 1 FROM recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = $1
		        JOIN position_state ps ON ps.recording_id = r.id AND ps.user_id = $1 AND ps.file_id IS NOT NULL
		        WHERE r.title_id = t.id AND NOT EXISTS (SELECT 1 FROM completion_state cs WHERE cs.recording_id = r.id AND cs.user_id = $1 AND cs.finished)))`
		return truth(q, p.Value)
	}
	return "FALSE"
}

func truth(q, value string) string {
	if value == "true" {
		return q
	}
	return "NOT " + q
}

func (b *builder) node(f wire.T005Filter) string {
	switch {
	case f.Predicate != nil:
		return b.predicate(*f.Predicate)
	case f.Group != nil:
		join := " AND "
		if f.Group.Kind == "any" {
			join = " OR "
		}
		parts := make([]string, 0, len(f.Group.Children))
		for _, c := range f.Group.Children {
			parts = append(parts, b.node(c))
		}
		return "(" + strings.Join(parts, join) + ")"
	case f.Not != nil:
		return "(NOT " + b.node(f.Not.Child) + ")"
	}
	return "FALSE"
}

// smartTitleIDs evaluates a filter for one viewer: only titles in the viewer's
// granted libraries, ordered by title UUID.
func (s *Service) smartTitleIDs(ctx context.Context, viewer uuid.UUID, f wire.T005Filter, limit, offset int) ([]uuid.UUID, int64, error) {
	b := &builder{args: []any{viewer}}
	where := visibleTitle + " AND " + b.node(f)
	var total int64
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM titles t WHERE "+where, b.args...).Scan(&total); err != nil {
		return nil, 0, dbErr(err)
	}
	if limit == 0 {
		return nil, total, nil
	}
	ln, on := b.bind(limit), b.bind(offset)
	rows, err := s.pool.Query(ctx, "SELECT t.id FROM titles t WHERE "+where+" ORDER BY t.id LIMIT "+ln+" OFFSET "+on, b.args...)
	if err != nil {
		return nil, 0, dbErr(err)
	}
	defer rows.Close()
	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, 0, dbErr(err)
		}
		ids = append(ids, id)
	}
	return ids, total, dbErr(rows.Err())
}
