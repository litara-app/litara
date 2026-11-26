package reading

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// target adapts one resource kind to conflict resolution: how to lock it, read
// its revision and reapply a retained candidate as a normal revisioned write.
type target struct {
	lock    func(q *sqlcgen.Queries) error
	current func(q *sqlcgen.Queries) (int64, error)
	// apply reapplies the candidate without comparing its base revision. A
	// non-nil problem is a durable conflict.
	apply func(q *sqlcgen.Queries, cand wire.PersonalCandidate, op uuid.UUID, base int64) (*apperr.Error, error)
	// race records a new durable conflict when resolution itself loses a race.
	race func(q *sqlcgen.Queries, cand wire.PersonalCandidate, op uuid.UUID, base, current int64, sp conflictSpec) (*apperr.Error, error)
	// ed is set for edition-scoped kinds, which also honor the content-version check.
	ed *edition
}

func utc(s string) time.Time { t, _ := time.Parse(time.RFC3339Nano, s); return t.UTC() }

var errEmptyCandidate = errors.New("candidate does not match the conflict kind")

func (s *Service) targetFor(ctx context.Context, a Actor, c sqlcgen.T005Conflict) (*target, error) {
	switch c.ResourceKind {
	case "position", "completion":
		ed, err := s.cat.AuthorizeEdition(ctx, a.UserID, c.EditionID.UUID) // grant removal blocks resolution
		if err != nil {
			return nil, err
		}
		t := &target{ed: &ed}
		t.race = func(q *sqlcgen.Queries, cand wire.PersonalCandidate, op uuid.UUID, base, cur int64, sp conflictSpec) (*apperr.Error, error) {
			return s.record(ctx, q, a, c.ResourceKind, ed.ID, ed, op, cand, base, cur, sp)
		}
		if c.ResourceKind == "position" {
			t.lock = func(q *sqlcgen.Queries) error {
				if err := q.EnsureEditionPosition(ctx, sqlcgen.EnsureEditionPositionParams{UserID: a.UserID, EditionID: ed.ID}); err != nil {
					return err
				}
				_, err := q.LockEditionPosition(ctx, sqlcgen.LockEditionPositionParams{UserID: a.UserID, EditionID: ed.ID})
				return err
			}
			t.current = func(q *sqlcgen.Queries) (int64, error) {
				p, err := q.GetEditionPosition(ctx, sqlcgen.GetEditionPositionParams{UserID: a.UserID, EditionID: ed.ID})
				return p.Revision, err
			}
			t.apply = func(q *sqlcgen.Queries, cand wire.PersonalCandidate, op uuid.UUID, base int64) (*apperr.Error, error) {
				if cand.Position == nil {
					return nil, errEmptyCandidate
				}
				cur, err := t.current(q)
				if err != nil {
					return nil, err
				}
				return s.applyPosition(ctx, q, a, ed, *cand.Position, op, base, utc(cand.Position.CapturedAt), cur, false)
			}
			return t, nil
		}
		t.lock = func(q *sqlcgen.Queries) error {
			if err := q.EnsureEditionCompletion(ctx, sqlcgen.EnsureEditionCompletionParams{UserID: a.UserID, EditionID: ed.ID}); err != nil {
				return err
			}
			_, err := q.LockEditionCompletion(ctx, sqlcgen.LockEditionCompletionParams{UserID: a.UserID, EditionID: ed.ID})
			return err
		}
		t.current = func(q *sqlcgen.Queries) (int64, error) {
			cs, err := q.GetEditionCompletion(ctx, sqlcgen.GetEditionCompletionParams{UserID: a.UserID, EditionID: ed.ID})
			return cs.Revision, err
		}
		t.apply = func(q *sqlcgen.Queries, cand wire.PersonalCandidate, op uuid.UUID, base int64) (*apperr.Error, error) {
			if cand.Completion == nil {
				return nil, errEmptyCandidate
			}
			cur, err := t.current(q)
			if err != nil {
				return nil, err
			}
			return s.applyCompletion(ctx, q, a, ed, *cand.Completion, op, base, utc(cand.Completion.CapturedAt), cur, false)
		}
		return t, nil

	case "annotation":
		ed, err := s.cat.AuthorizeEdition(ctx, a.UserID, c.EditionID.UUID)
		if err != nil {
			return nil, err
		}
		id := c.ResourceID
		t := &target{ed: &ed}
		t.lock = func(q *sqlcgen.Queries) error { return q.LockPersonalKey(ctx, annotationKey(a.UserID, id)) }
		t.current = func(q *sqlcgen.Queries) (int64, error) {
			r, err := q.GetAnnotation(ctx, sqlcgen.GetAnnotationParams{UserID: a.UserID, ID: id})
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, nil
			}
			return r.Revision, err
		}
		t.race = func(q *sqlcgen.Queries, cand wire.PersonalCandidate, op uuid.UUID, base, cur int64, sp conflictSpec) (*apperr.Error, error) {
			return s.record(ctx, q, a, "annotation", id, ed, op, cand, base, cur, sp)
		}
		t.apply = func(q *sqlcgen.Queries, cand wire.PersonalCandidate, op uuid.UUID, base int64) (*apperr.Error, error) {
			cur, err := q.GetAnnotation(ctx, sqlcgen.GetAnnotationParams{UserID: a.UserID, ID: id})
			exists := err == nil
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return nil, err
			}
			switch {
			case cand.Annotation != nil:
				return s.applyAnnotation(ctx, q, a, ed, id, *cand.Annotation, op, base, utc(cand.Annotation.CapturedAt), exists, cur, false)
			case cand.Delete != nil && exists:
				return s.applyAnnotationDelete(ctx, q, a, ed, id, *cand.Delete, op, base, cur, false)
			case cand.Delete != nil:
				return nil, apperr.ErrNotFound
			}
			return nil, errEmptyCandidate
		}
		return t, nil

	case "shelf", "membership", "shelf-order":
		id := c.ResourceID
		if _, err := s.ownedShelf(ctx, s.q, a.UserID, id); err != nil {
			return nil, err
		}
		t := &target{}
		t.lock = func(q *sqlcgen.Queries) error { return q.LockPersonalKey(ctx, shelfKey(id)) }
		t.current = func(q *sqlcgen.Queries) (int64, error) {
			sh, err := q.GetShelf(ctx, id)
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, nil
			}
			return sh.Revision, err
		}
		t.race = func(q *sqlcgen.Queries, cand wire.PersonalCandidate, op uuid.UUID, base, cur int64, sp conflictSpec) (*apperr.Error, error) {
			return s.recordFor(ctx, q, a, c.ResourceKind, id, uuid.NullUUID{}, nil, op, cand, base, cur, sp)
		}
		t.apply = func(q *sqlcgen.Queries, cand wire.PersonalCandidate, op uuid.UUID, base int64) (*apperr.Error, error) {
			cur, err := s.ownedShelfOrNew(ctx, q, a.UserID, id)
			if err != nil {
				return nil, err
			}
			switch {
			case cand.Shelf != nil:
				return s.applyShelf(ctx, q, a, id, *cand.Shelf, op, base, cur, false)
			case cur == nil:
				return nil, apperr.ErrNotFound
			case cand.Delete != nil:
				return s.applyShelfDelete(ctx, q, a, *cur, *cand.Delete, op, base, false)
			case cand.Membership != nil:
				return s.applyMember(ctx, q, a, *cur, *cand.Membership, op, base, false)
			case cand.Order != nil:
				return s.applyOrder(ctx, q, a, *cur, *cand.Order, op, base, false)
			}
			return nil, errEmptyCandidate
		}
		return t, nil
	}
	return nil, apperr.Validation("Unknown conflict kind.")
}

// Resolve settles one of the caller own conflicts. keep_server leaves the
// resource untouched; use_candidate re-validates and reapplies the retained
// candidate as a normal revisioned write. It never resurrects a tombstone.
func (s *Service) Resolve(ctx context.Context, a Actor, conflictID uuid.UUID, r wire.ResolvePersonalConflict) (wire.ResolvedPersonalConflict, error) {
	op, err := parseUUID("operationId", r.OperationID)
	if err != nil {
		return wire.ResolvedPersonalConflict{}, err
	}
	base, err := parseRev(r.BaseRevision)
	if err != nil {
		return wire.ResolvedPersonalConflict{}, err
	}
	var cv *uuid.UUID
	if r.ContentVersion != nil {
		v, err := parseUUID("contentVersion", *r.ContentVersion)
		if err != nil {
			return wire.ResolvedPersonalConflict{}, err
		}
		cv = &v
	}
	if r.Choice != "keep_server" && r.Choice != "use_candidate" {
		return wire.ResolvedPersonalConflict{}, apperr.Validation("choice must be keep_server or use_candidate.")
	}
	// Another user conflict is indistinguishable from an unknown one.
	c0, err := s.q.GetT005Conflict(ctx, conflictID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && c0.UserID != a.UserID) {
		return wire.ResolvedPersonalConflict{}, apperr.ErrNotFound
	}
	if err != nil {
		return wire.ResolvedPersonalConflict{}, dbErr(err)
	}
	t, err := s.targetFor(ctx, a, c0)
	if err != nil {
		return wire.ResolvedPersonalConflict{}, err
	}
	fp := fingerprint(http.MethodPost, "/personal-conflicts/"+conflictID.String()+"/resolve", r)
	lock := func(q *sqlcgen.Queries) error {
		if err := t.lock(q); err != nil {
			return err
		}
		_, err := q.LockT005Conflict(ctx, conflictID)
		return err
	}
	body, err := s.run(ctx, a, op, fp, lock, func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		c, err := q.GetT005Conflict(ctx, conflictID)
		if err != nil {
			return nil, nil, err
		}
		if c.ResolvedAt != nil {
			return nil, apperr.New(http.StatusConflict, "conflict_resolved", "That conflict was already resolved."), nil
		}
		current, err := t.current(q)
		if err != nil {
			return nil, nil, err
		}
		now := s.now()
		resultRev := current
		if r.Choice == "use_candidate" {
			var cand wire.PersonalCandidate
			if err := json.Unmarshal(c.Candidate, &cand); err != nil {
				return nil, nil, err
			}
			// A race with another write yields a new durable conflict; the original stays open.
			if base != current {
				d, err := t.race(q, cand, op, base, current, specStale)
				return nil, d, err
			}
			if t.ed != nil && cv != nil && *cv != t.ed.ContentVersion {
				d, err := t.race(q, cand, op, base, current, specContent)
				return nil, d, err
			}
			if d, err := t.apply(q, cand, op, base); err != nil || d != nil {
				return nil, d, err
			}
			if resultRev, err = t.current(q); err != nil {
				return nil, nil, err
			}
		}
		if err := q.ResolveT005Conflict(ctx, sqlcgen.ResolveT005ConflictParams{ID: conflictID, ResolvedAt: &now, ResolvedOperationID: uuid.NullUUID{UUID: op, Valid: true},
			ResolvedRevision: &resultRev}); err != nil {
			return nil, nil, err
		}
		return wire.Raw(wire.ResolvedPersonalConflict{ConflictID: conflictID.String(), ResourceKind: c.ResourceKind, ResourceID: c.ResourceID.String(),
			Revision: strconv.FormatInt(resultRev, 10), ResolvedAt: rfc(now)}), nil, nil
	})
	if err != nil {
		return wire.ResolvedPersonalConflict{}, err
	}
	var out wire.ResolvedPersonalConflict
	return out, json.Unmarshal(body, &out)
}
