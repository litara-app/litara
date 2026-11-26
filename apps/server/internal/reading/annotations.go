package reading

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Annotations are private to their owner and anchored to one exact file version
// (ADR-0066). Administrators get no special access: every query is keyed by the
// authenticated user, and another user's annotation is indistinguishable from
// an unknown one.

func annotationKey(userID, id uuid.UUID) string {
	return "annotation:" + userID.String() + ":" + id.String()
}

func annotationWire(r sqlcgen.Annotation) (wire.Annotation, error) {
	out := wire.Annotation{ID: r.ID.String(), EditionID: r.EditionID.String(), Revision: strconv.FormatInt(r.Revision, 10),
		Deleted: r.Deleted, UpdatedAt: rfc(r.UpdatedAt)}
	if r.Deleted {
		return out, nil // a tombstone exposes no content
	}
	var loc wire.Locator
	if err := json.Unmarshal(r.Locator, &loc); err != nil {
		return out, err
	}
	d := wire.AnnotationData{Kind: r.Kind, Text: r.Text, Quote: r.Quote,
		Anchor: wire.EditionAnchor{FileID: r.FileID.String(), ContentVersion: r.ContentVersion.String(), Locator: loc}}
	if len(r.Selection) > 0 {
		var sel wire.Selection
		if err := json.Unmarshal(r.Selection, &sel); err != nil {
			return out, err
		}
		d.Selection = wire.Some(&sel)
	}
	out.Data = wire.Some(&d)
	return out, nil
}

func (s *Service) ListAnnotations(ctx context.Context, userID, editionID uuid.UUID, includeDeleted bool, page, size int) (wire.Annotations, error) {
	if _, err := s.cat.AuthorizeEdition(ctx, userID, editionID); err != nil {
		return wire.Annotations{}, err
	}
	rows, err := s.q.ListAnnotations(ctx, sqlcgen.ListAnnotationsParams{UserID: userID, EditionID: editionID, IncludeDeleted: includeDeleted,
		PageSize: int32(size), PageOffset: int32(page * size)})
	if err != nil {
		return wire.Annotations{}, dbErr(err)
	}
	total, err := s.q.CountAnnotations(ctx, sqlcgen.CountAnnotationsParams{UserID: userID, EditionID: editionID, IncludeDeleted: includeDeleted})
	if err != nil {
		return wire.Annotations{}, dbErr(err)
	}
	out := wire.Annotations{Items: []wire.Annotation{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, r := range rows {
		w, err := annotationWire(r)
		if err != nil {
			return out, dbErr(err)
		}
		out.Items = append(out.Items, w)
	}
	return out, nil
}

func (s *Service) GetAnnotation(ctx context.Context, userID, editionID, id uuid.UUID) (wire.Annotation, error) {
	if _, err := s.cat.AuthorizeEdition(ctx, userID, editionID); err != nil {
		return wire.Annotation{}, err
	}
	r, err := s.q.GetAnnotation(ctx, sqlcgen.GetAnnotationParams{UserID: userID, ID: id})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && r.EditionID != editionID) {
		return wire.Annotation{}, apperr.ErrNotFound
	}
	if err != nil {
		return wire.Annotation{}, dbErr(err)
	}
	return annotationWire(r)
}

// validateAnnotation checks the syntactic and capability rules that never
// depend on stored state, so a malformed body produces 422 and no candidate.
func validateAnnotation(ed edition, d wire.AnnotationData) error {
	if _, err := parseUUID("data.anchor.fileId", d.Anchor.FileID); err != nil {
		return err
	}
	if _, err := parseUUID("data.anchor.contentVersion", d.Anchor.ContentVersion); err != nil {
		return err
	}
	if locatorKind(d.Anchor.Locator) == "" {
		return apperr.Validation("data.anchor.locator is required.")
	}
	if utf8.RuneCountInString(d.Text) > 65536 || utf8.RuneCountInString(d.Quote) > 16384 {
		return apperr.Validation("text or quote is too long.")
	}
	sel := d.Selection.Value
	if sel != nil { // any supplied selection must agree with the anchor locator kind
		switch {
		case sel.CFI != nil && d.Anchor.Locator.CFI != nil:
		case sel.PDF != nil && d.Anchor.Locator.PDF != nil:
			if sel.PDF.PageIndex != d.Anchor.Locator.PDF.PageIndex {
				return apperr.Validation("The PDF selection page must match the anchor page.")
			}
		default:
			return apperr.Validation("The selection kind must match the anchor locator kind.")
		}
	}
	switch d.Kind {
	case "highlight":
		if comicFormat(ed.Format) {
			return apperr.Validation("Image comics cannot carry text highlights.")
		}
		if sel == nil {
			return apperr.Validation("A highlight requires a selection.")
		}
	case "note":
		if strings.TrimSpace(d.Text) == "" {
			return apperr.Validation("A note requires text.")
		}
	case "bookmark":
		if sel != nil {
			return apperr.Validation("A bookmark has no selection.")
		}
	default:
		return apperr.Validation("kind must be highlight, note or bookmark.")
	}
	return nil
}

func comicFormat(f string) bool { return f == "cbz" || f == "cbr" || f == "cb7" }

// PutAnnotation creates or updates one annotation with revision and receipt semantics.
func (s *Service) PutAnnotation(ctx context.Context, a Actor, editionID, id uuid.UUID, w wire.AnnotationWrite) (wire.Annotation, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.Annotation{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.Annotation{}, err
	}
	captured, err := parseTime("capturedAt", w.CapturedAt)
	if err != nil {
		return wire.Annotation{}, err
	}
	ed, err := s.cat.AuthorizeEdition(ctx, a.UserID, editionID)
	if err != nil {
		return wire.Annotation{}, err
	}
	if err := validateAnnotation(ed, w.Data); err != nil {
		return wire.Annotation{}, err
	}
	fp := fingerprint(http.MethodPut, "/editions/"+editionID.String()+"/annotations/"+id.String(), w)
	body, err := s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error {
		return q.LockPersonalKey(ctx, annotationKey(a.UserID, id))
	}, func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		cur, err := q.GetAnnotation(ctx, sqlcgen.GetAnnotationParams{UserID: a.UserID, ID: id})
		exists := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, err
		}
		if exists && cur.EditionID != ed.ID {
			return nil, nil, apperr.Validation("That annotation belongs to another edition.")
		}
		d, err := s.applyAnnotation(ctx, q, a, ed, id, w, op, base, captured, exists, cur, true)
		if err != nil || d != nil {
			return nil, d, err
		}
		row, err := q.GetAnnotation(ctx, sqlcgen.GetAnnotationParams{UserID: a.UserID, ID: id})
		if err != nil {
			return nil, nil, err
		}
		out, err := annotationWire(row)
		if err != nil {
			return nil, nil, err
		}
		return wire.Raw(out), nil, nil
	})
	if err != nil {
		return wire.Annotation{}, err
	}
	var out wire.Annotation
	return out, json.Unmarshal(body, &out)
}

// applyAnnotation validates and applies a write under the key lock. A non-nil
// problem is durable (a conflict was recorded). checkBase is false when a
// conflict resolution already compared the revision itself.
func (s *Service) applyAnnotation(ctx context.Context, q *sqlcgen.Queries, a Actor, ed edition, id uuid.UUID, w wire.AnnotationWrite,
	op uuid.UUID, base int64, captured time.Time, exists bool, cur sqlcgen.Annotation, checkBase bool) (*apperr.Error, error) {
	d := w.Data
	fileID, _ := uuid.Parse(d.Anchor.FileID)
	version, _ := uuid.Parse(d.Anchor.ContentVersion)
	if fileID != ed.FileID {
		return nil, apperr.Validation("data.anchor.fileId is not the file of this edition.")
	}
	if err := s.knownVersion(ctx, q, ed.FileID, version); err != nil {
		return nil, err
	}
	if exists && cur.Kind != d.Kind {
		return nil, apperr.Validation("An annotation kind cannot change.")
	}
	var currentRev int64
	if exists {
		currentRev = cur.Revision
	}
	switch {
	case exists && cur.Deleted:
		return s.record(ctx, q, a, "annotation", id, ed, op, w, base, currentRev, specDeleted) // a stale edit never resurrects a tombstone
	case !locatorAllowed(ed.Format, d.Anchor.Locator):
		return s.record(ctx, q, a, "annotation", id, ed, op, w, base, currentRev, specLocator)
	case version != ed.ContentVersion || (exists && cur.ContentVersion != ed.ContentVersion):
		// Edits apply only to an annotation anchored to the current bytes.
		return s.record(ctx, q, a, "annotation", id, ed, op, w, base, currentRev, specContent)
	case checkBase && base != currentRev:
		return s.record(ctx, q, a, "annotation", id, ed, op, w, base, currentRev, specStale)
	}
	loc, err := json.Marshal(d.Anchor.Locator)
	if err != nil {
		return nil, err
	}
	var sel []byte
	if d.Selection.Value != nil {
		if sel, err = json.Marshal(d.Selection.Value); err != nil {
			return nil, err
		}
	}
	now := s.now()
	if !exists {
		return nil, q.InsertAnnotation(ctx, sqlcgen.InsertAnnotationParams{UserID: a.UserID, ID: id, EditionID: ed.ID, Kind: d.Kind,
			FileID: fileID, ContentVersion: version, Locator: loc, Selection: sel, Text: d.Text, Quote: d.Quote, CreatedAt: now})
	}
	return nil, q.UpdateAnnotation(ctx, sqlcgen.UpdateAnnotationParams{UserID: a.UserID, ID: id, FileID: fileID, ContentVersion: version,
		Locator: loc, Selection: sel, Text: d.Text, Quote: d.Quote, UpdatedAt: now})
}

// DeleteAnnotation tombstones an annotation at its current revision. Deleting
// stays allowed when the book bytes were superseded: it does not reinterpret a locator.
func (s *Service) DeleteAnnotation(ctx context.Context, a Actor, editionID, id uuid.UUID, w wire.RevisionedDelete) (wire.Annotation, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.Annotation{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.Annotation{}, err
	}
	if _, err = parseTime("capturedAt", w.CapturedAt); err != nil {
		return wire.Annotation{}, err
	}
	ed, err := s.cat.AuthorizeEdition(ctx, a.UserID, editionID)
	if err != nil {
		return wire.Annotation{}, err
	}
	fp := fingerprint(http.MethodDelete, "/editions/"+editionID.String()+"/annotations/"+id.String(), w)
	body, err := s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error {
		return q.LockPersonalKey(ctx, annotationKey(a.UserID, id))
	}, func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		cur, err := q.GetAnnotation(ctx, sqlcgen.GetAnnotationParams{UserID: a.UserID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && cur.EditionID != ed.ID) {
			return nil, nil, apperr.ErrNotFound
		}
		if err != nil {
			return nil, nil, err
		}
		d, err := s.applyAnnotationDelete(ctx, q, a, ed, id, w, op, base, cur, true)
		if err != nil || d != nil {
			return nil, d, err
		}
		row, err := q.GetAnnotation(ctx, sqlcgen.GetAnnotationParams{UserID: a.UserID, ID: id})
		if err != nil {
			return nil, nil, err
		}
		out, err := annotationWire(row)
		if err != nil {
			return nil, nil, err
		}
		return wire.Raw(out), nil, nil
	})
	if err != nil {
		return wire.Annotation{}, err
	}
	var out wire.Annotation
	return out, json.Unmarshal(body, &out)
}

func (s *Service) applyAnnotationDelete(ctx context.Context, q *sqlcgen.Queries, a Actor, ed edition, id uuid.UUID, w wire.RevisionedDelete,
	op uuid.UUID, base int64, cur sqlcgen.Annotation, checkBase bool) (*apperr.Error, error) {
	if checkBase && base != cur.Revision {
		return s.record(ctx, q, a, "annotation", id, ed, op, w, base, cur.Revision, specStale)
	}
	if cur.Deleted {
		return nil, nil // deleting a tombstone at its current revision changes nothing
	}
	return nil, q.TombstoneAnnotation(ctx, sqlcgen.TombstoneAnnotationParams{UserID: a.UserID, ID: id, UpdatedAt: s.now()})
}
