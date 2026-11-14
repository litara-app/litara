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

type edition = sqlcgen.GetEditionRowRow

// allowedLocators lists the locator kinds each format may carry (ADR-0065).
// Foliate renders CBZ, so it may carry either a Foliate CFI or a comic page.
var allowedLocators = map[string][]string{
	"epub": {"foliate-cfi"}, "kepub": {"foliate-cfi"}, "fb2": {"foliate-cfi"},
	"mobi": {"foliate-cfi"}, "azw": {"foliate-cfi"}, "azw3": {"foliate-cfi"},
	"pdf": {"pdf-page"}, "cbz": {"foliate-cfi", "comic-page"}, "cbr": {"comic-page"}, "cb7": {"comic-page"},
}

func locatorKind(l wire.T005Locator) string {
	switch {
	case l.CFI != nil:
		return "foliate-cfi"
	case l.PDF != nil:
		return "pdf-page"
	case l.Comic != nil:
		return "comic-page"
	}
	return ""
}

func locatorAllowed(format string, l wire.T005Locator) bool {
	k := locatorKind(l)
	for _, a := range allowedLocators[format] {
		if a == k {
			return true
		}
	}
	return false
}

// conflictSpec describes a durable 409/412 to record with its candidate.
type conflictSpec struct {
	status int
	reason string
	code   string
	detail string
}

var (
	specStale   = conflictSpec{http.StatusConflict, "stale_revision", "stale_revision", "The base revision is not current; a candidate was kept for resolution."}
	specContent = conflictSpec{http.StatusPreconditionFailed, "content_changed", "content_changed", "The file content version changed; refetch the edition. The attempt was kept as a candidate."}
	specLocator = conflictSpec{http.StatusPreconditionFailed, "locator_incompatible", "locator_incompatible", "The locator kind is not valid for this edition format. The attempt was kept as a candidate."}
)

// record stores a durable conflict and returns the problem carrying its ID.
func (s *Service) record(ctx context.Context, q *sqlcgen.Queries, a Actor, kind string, resource uuid.UUID, ed edition, op uuid.UUID,
	candidate any, base, current int64, sp conflictSpec) (*apperr.Error, error) {
	raw, err := json.Marshal(candidate)
	if err != nil {
		return nil, err
	}
	c, err := q.InsertT005Conflict(ctx, sqlcgen.InsertT005ConflictParams{UserID: a.UserID, ResourceKind: kind, ResourceID: resource,
		EditionID: uuid.NullUUID{UUID: ed.ID, Valid: true}, Reason: sp.reason, OperationID: op, Candidate: raw, BaseRevision: base, CurrentRevision: current})
	if err != nil {
		return nil, err
	}
	p := apperr.New(sp.status, sp.code, sp.detail).With("conflictId", c.ID.String()).With("currentRevision", strconv.FormatInt(current, 10))
	if sp.status == http.StatusPreconditionFailed {
		p = p.With("currentContentVersion", ed.ContentVersion.String())
	}
	return p, nil
}

// knownVersion checks that a version belongs to the edition file at all.
func (s *Service) knownVersion(ctx context.Context, q *sqlcgen.Queries, file, version uuid.UUID) error {
	k, err := q.GetKnownFileVersion(ctx, version)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && k.FileID != file) {
		return apperr.Validation("contentVersion is not a version of this edition file.")
	}
	return err
}

// ---- position ---------------------------------------------------------------

func positionPayload(w wire.T005PositionWrite) any { return w }

// WritePosition applies one revisioned, idempotent position write.
func (s *Service) WritePosition(ctx context.Context, a Actor, editionID uuid.UUID, w wire.T005PositionWrite) (wire.T005PositionState, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.T005PositionState{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.T005PositionState{}, err
	}
	captured, err := parseTime("capturedAt", w.CapturedAt)
	if err != nil {
		return wire.T005PositionState{}, err
	}
	if _, err = parseUUID("anchor.fileId", w.Anchor.FileID); err != nil {
		return wire.T005PositionState{}, err
	}
	if _, err = parseUUID("anchor.contentVersion", w.Anchor.ContentVersion); err != nil {
		return wire.T005PositionState{}, err
	}
	if locatorKind(w.Anchor.Locator) == "" {
		return wire.T005PositionState{}, apperr.Validation("anchor.locator is required.")
	}
	// Authorization precedes any receipt so a denied request leaves no trace.
	ed, err := s.cat.AuthorizeEdition(ctx, a.UserID, editionID)
	if err != nil {
		return wire.T005PositionState{}, err
	}
	fp := fingerprint(http.MethodPut, "/editions/"+editionID.String()+"/position", positionPayload(w))
	body, err := s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error {
		if err := q.EnsureEditionPosition(ctx, sqlcgen.EnsureEditionPositionParams{UserID: a.UserID, EditionID: editionID}); err != nil {
			return err
		}
		_, err := q.LockEditionPosition(ctx, sqlcgen.LockEditionPositionParams{UserID: a.UserID, EditionID: editionID})
		return err
	}, func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		cur, err := q.GetEditionPosition(ctx, sqlcgen.GetEditionPositionParams{UserID: a.UserID, EditionID: editionID})
		if err != nil {
			return nil, nil, err
		}
		d, err := s.applyPosition(ctx, q, a, ed, w, op, base, captured, cur.Revision, true)
		if err != nil || d != nil {
			return nil, d, err
		}
		st, err := s.cat.PositionStateTx(ctx, q, a.UserID, editionID)
		if err != nil {
			return nil, nil, err
		}
		return wire.Raw(st), nil, nil
	})
	if err != nil {
		return wire.T005PositionState{}, err
	}
	var st wire.T005PositionState
	return st, json.Unmarshal(body, &st)
}

// applyPosition validates and applies a position candidate under the row lock.
// A non-nil problem is durable (a conflict was recorded). checkBase is false
// when the caller already compared the revision itself.
func (s *Service) applyPosition(ctx context.Context, q *sqlcgen.Queries, a Actor, ed edition, w wire.T005PositionWrite, op uuid.UUID,
	base int64, captured time.Time, current int64, checkBase bool) (*apperr.Error, error) {
	fileID, _ := uuid.Parse(w.Anchor.FileID)
	version, _ := uuid.Parse(w.Anchor.ContentVersion)
	if fileID != ed.FileID {
		return nil, apperr.Validation("anchor.fileId is not the file of this edition.")
	}
	if err := s.knownVersion(ctx, q, ed.FileID, version); err != nil {
		return nil, err
	}
	switch {
	case !locatorAllowed(ed.Format, w.Anchor.Locator):
		return s.record(ctx, q, a, "position", ed.ID, ed, op, w, base, current, specLocator)
	case version != ed.ContentVersion:
		return s.record(ctx, q, a, "position", ed.ID, ed, op, w, base, current, specContent)
	case checkBase && base != current:
		return s.record(ctx, q, a, "position", ed.ID, ed, op, w, base, current, specStale)
	}
	loc, err := json.Marshal(w.Anchor.Locator)
	if err != nil {
		return nil, err
	}
	now := s.now()
	dev := a.DeviceName
	if err := q.SetEditionPosition(ctx, sqlcgen.SetEditionPositionParams{UserID: a.UserID, EditionID: ed.ID,
		FileID: uuid.NullUUID{UUID: fileID, Valid: true}, ContentVersion: uuid.NullUUID{UUID: version, Valid: true}, Locator: loc,
		CapturedAt: &captured, ReceivedAt: &now, DeviceName: &dev}); err != nil {
		return nil, err
	}
	return nil, q.UpsertEditionPositionEvidence(ctx, sqlcgen.UpsertEditionPositionEvidenceParams{UserID: a.UserID, EditionID: ed.ID,
		SessionID: a.SessionID, FileID: fileID, ContentVersion: version, Locator: loc, CapturedAt: captured, ReceivedAt: now, DeviceName: dev})
}

// ---- completion ---------------------------------------------------------------

func (s *Service) WriteCompletion(ctx context.Context, a Actor, editionID uuid.UUID, w wire.T005CompletionWrite) (wire.T005Completion, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.T005Completion{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.T005Completion{}, err
	}
	captured, err := parseTime("capturedAt", w.CapturedAt)
	if err != nil {
		return wire.T005Completion{}, err
	}
	if w.Event != "manual_finish" && w.Event != "manual_unfinish" {
		return wire.T005Completion{}, apperr.Validation("event must be manual_finish or manual_unfinish.")
	}
	if _, err = parseUUID("fileId", w.FileID); err != nil {
		return wire.T005Completion{}, err
	}
	if _, err = parseUUID("contentVersion", w.ContentVersion); err != nil {
		return wire.T005Completion{}, err
	}
	ed, err := s.cat.AuthorizeEdition(ctx, a.UserID, editionID)
	if err != nil {
		return wire.T005Completion{}, err
	}
	fp := fingerprint(http.MethodPut, "/editions/"+editionID.String()+"/completion", w)
	body, err := s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error {
		if err := q.EnsureEditionCompletion(ctx, sqlcgen.EnsureEditionCompletionParams{UserID: a.UserID, EditionID: editionID}); err != nil {
			return err
		}
		_, err := q.LockEditionCompletion(ctx, sqlcgen.LockEditionCompletionParams{UserID: a.UserID, EditionID: editionID})
		return err
	}, func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		cur, err := q.GetEditionCompletion(ctx, sqlcgen.GetEditionCompletionParams{UserID: a.UserID, EditionID: editionID})
		if err != nil {
			return nil, nil, err
		}
		d, err := s.applyCompletion(ctx, q, a, ed, w, op, base, captured, cur.Revision, true)
		if err != nil || d != nil {
			return nil, d, err
		}
		st, err := s.cat.CompletionStateTx(ctx, q, a.UserID, editionID)
		if err != nil {
			return nil, nil, err
		}
		return wire.Raw(st), nil, nil
	})
	if err != nil {
		return wire.T005Completion{}, err
	}
	var st wire.T005Completion
	return st, json.Unmarshal(body, &st)
}

func (s *Service) applyCompletion(ctx context.Context, q *sqlcgen.Queries, a Actor, ed edition, w wire.T005CompletionWrite, op uuid.UUID,
	base int64, captured time.Time, current int64, checkBase bool) (*apperr.Error, error) {
	fileID, _ := uuid.Parse(w.FileID)
	version, _ := uuid.Parse(w.ContentVersion)
	if fileID != ed.FileID {
		return nil, apperr.Validation("fileId is not the file of this edition.")
	}
	if err := s.knownVersion(ctx, q, ed.FileID, version); err != nil {
		return nil, err
	}
	switch {
	case version != ed.ContentVersion:
		return s.record(ctx, q, a, "completion", ed.ID, ed, op, w, base, current, specContent)
	case checkBase && base != current:
		return s.record(ctx, q, a, "completion", ed.ID, ed, op, w, base, current, specStale)
	}
	now := s.now()
	if err := q.SetEditionCompletion(ctx, sqlcgen.SetEditionCompletionParams{UserID: a.UserID, EditionID: ed.ID,
		Finished: w.Event == "manual_finish", ChangedAt: &now}); err != nil {
		return nil, err
	}
	// Completion never clears or moves the precise location (ADR-0065).
	return nil, q.InsertEditionHistory(ctx, sqlcgen.InsertEditionHistoryParams{UserID: a.UserID, TitleID: ed.TitleID, EditionID: ed.ID,
		FileID: fileID, ContentVersion: version, Event: w.Event, OperationID: op, CapturedAt: captured, ReceivedAt: now})
}

// ---- personal conflicts ---------------------------------------------------------

func conflictWire(c sqlcgen.T005Conflict) (wire.T005Conflict, error) {
	out := wire.T005Conflict{ID: c.ID.String(), ResourceKind: c.ResourceKind, ResourceID: c.ResourceID.String(), Reason: c.Reason,
		BaseRevision: strconv.FormatInt(c.BaseRevision, 10), CurrentRevision: strconv.FormatInt(c.CurrentRevision, 10),
		CreatedAt: rfc(c.CreatedAt), ResolvedAt: rfcp(c.ResolvedAt)}
	if c.EditionID.Valid {
		e := c.EditionID.UUID.String()
		out.EditionID = &e
	}
	return out, json.Unmarshal(c.Candidate, &out.Candidate)
}

// Conflicts lists only the caller own conflicts whose resources are still readable.
func (s *Service) Conflicts(ctx context.Context, userID uuid.UUID, resource *uuid.UUID, includeResolved bool, page, size int) (wire.T005Conflicts, error) {
	rid := uuid.NullUUID{}
	if resource != nil {
		rid = uuid.NullUUID{UUID: *resource, Valid: true}
	}
	rows, err := s.q.ListT005Conflicts(ctx, sqlcgen.ListT005ConflictsParams{UserID: userID, ResourceID: rid, IncludeResolved: includeResolved,
		PageSize: int32(size), PageOffset: int32(page * size)})
	if err != nil {
		return wire.T005Conflicts{}, dbErr(err)
	}
	total, err := s.q.CountT005Conflicts(ctx, sqlcgen.CountT005ConflictsParams{UserID: userID, ResourceID: rid, IncludeResolved: includeResolved})
	if err != nil {
		return wire.T005Conflicts{}, dbErr(err)
	}
	out := wire.T005Conflicts{Items: []wire.T005Conflict{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, c := range rows {
		w, err := conflictWire(c)
		if err != nil {
			return out, dbErr(err)
		}
		out.Items = append(out.Items, w)
	}
	return out, nil
}

// Resolve settles one of the caller own conflicts. keep_server leaves the
// resource untouched; use_candidate re-validates and reapplies the retained
// candidate as a normal revisioned write.
func (s *Service) Resolve(ctx context.Context, a Actor, conflictID uuid.UUID, r wire.T005Resolve) (wire.T005Resolved, error) {
	op, err := parseUUID("operationId", r.OperationID)
	if err != nil {
		return wire.T005Resolved{}, err
	}
	base, err := parseRev(r.BaseRevision)
	if err != nil {
		return wire.T005Resolved{}, err
	}
	var cv *uuid.UUID
	if r.ContentVersion != nil {
		v, err := parseUUID("contentVersion", *r.ContentVersion)
		if err != nil {
			return wire.T005Resolved{}, err
		}
		cv = &v
	}
	if r.Choice != "keep_server" && r.Choice != "use_candidate" {
		return wire.T005Resolved{}, apperr.Validation("choice must be keep_server or use_candidate.")
	}
	// Another user conflict is indistinguishable from an unknown one.
	c0, err := s.q.GetT005Conflict(ctx, conflictID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && c0.UserID != a.UserID) {
		return wire.T005Resolved{}, apperr.ErrNotFound
	}
	if err != nil {
		return wire.T005Resolved{}, dbErr(err)
	}
	if c0.ResourceKind != "position" && c0.ResourceKind != "completion" {
		return wire.T005Resolved{}, apperr.Validation("This conflict kind cannot be resolved yet.")
	}
	ed, err := s.cat.AuthorizeEdition(ctx, a.UserID, c0.EditionID.UUID) // grant removal blocks resolution
	if err != nil {
		return wire.T005Resolved{}, err
	}
	fp := fingerprint(http.MethodPost, "/personal-conflicts/"+conflictID.String()+"/resolve", r)

	lock := func(q *sqlcgen.Queries) error {
		if c0.ResourceKind == "position" {
			if err := q.EnsureEditionPosition(ctx, sqlcgen.EnsureEditionPositionParams{UserID: a.UserID, EditionID: ed.ID}); err != nil {
				return err
			}
			if _, err := q.LockEditionPosition(ctx, sqlcgen.LockEditionPositionParams{UserID: a.UserID, EditionID: ed.ID}); err != nil {
				return err
			}
		} else {
			if err := q.EnsureEditionCompletion(ctx, sqlcgen.EnsureEditionCompletionParams{UserID: a.UserID, EditionID: ed.ID}); err != nil {
				return err
			}
			if _, err := q.LockEditionCompletion(ctx, sqlcgen.LockEditionCompletionParams{UserID: a.UserID, EditionID: ed.ID}); err != nil {
				return err
			}
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
		var current int64
		if c.ResourceKind == "position" {
			p, err := q.GetEditionPosition(ctx, sqlcgen.GetEditionPositionParams{UserID: a.UserID, EditionID: ed.ID})
			if err != nil {
				return nil, nil, err
			}
			current = p.Revision
		} else {
			cs, err := q.GetEditionCompletion(ctx, sqlcgen.GetEditionCompletionParams{UserID: a.UserID, EditionID: ed.ID})
			if err != nil {
				return nil, nil, err
			}
			current = cs.Revision
		}
		now := s.now()
		resultRev := current
		if r.Choice == "use_candidate" {
			var cand wire.T005Candidate
			if err := json.Unmarshal(c.Candidate, &cand); err != nil {
				return nil, nil, err
			}
			// A race with another write yields a new durable conflict; the original stays open.
			if base != current {
				d, err := s.record(ctx, q, a, c.ResourceKind, ed.ID, ed, op, cand, base, current, specStale)
				return nil, d, err
			}
			if cv != nil && *cv != ed.ContentVersion {
				d, err := s.record(ctx, q, a, c.ResourceKind, ed.ID, ed, op, cand, base, current, specContent)
				return nil, d, err
			}
			var d *apperr.Error
			switch {
			case cand.Position != nil:
				t, _ := time.Parse(time.RFC3339Nano, cand.Position.CapturedAt)
				d, err = s.applyPosition(ctx, q, a, ed, *cand.Position, op, base, t.UTC(), current, false)
			case cand.Completion != nil:
				t, _ := time.Parse(time.RFC3339Nano, cand.Completion.CapturedAt)
				d, err = s.applyCompletion(ctx, q, a, ed, *cand.Completion, op, base, t.UTC(), current, false)
			default:
				err = errors.New("empty candidate")
			}
			if err != nil || d != nil {
				return nil, d, err
			}
			resultRev = current + 1
		}
		if err := q.ResolveT005Conflict(ctx, sqlcgen.ResolveT005ConflictParams{ID: conflictID, ResolvedAt: &now, ResolvedOperationID: uuid.NullUUID{UUID: op, Valid: true},
			ResolvedRevision: &resultRev}); err != nil {
			return nil, nil, err
		}
		return wire.Raw(wire.T005Resolved{ConflictID: conflictID.String(), ResourceKind: c.ResourceKind, ResourceID: c.ResourceID.String(),
			Revision: strconv.FormatInt(resultRev, 10), ResolvedAt: rfc(now)}), nil, nil
	})
	if err != nil {
		return wire.T005Resolved{}, err
	}
	var out wire.T005Resolved
	return out, json.Unmarshal(body, &out)
}


