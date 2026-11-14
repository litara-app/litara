// Package progress implements revisioned position and completion writes,
// durable conflicts, operation receipts and conflict resolution (ADR-0036..0043).
// Every write is one PostgreSQL transaction that locks the user/recording
// state row, so a revision never commits without its receipt and a 409/412
// receipt never commits without its durable candidate.
package progress

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/catalog"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type Service struct {
	pool *pgxpool.Pool
	q    *sqlcgen.Queries
	cat  *catalog.Service
	now  func() time.Time
}

func New(pool *pgxpool.Pool, cat *catalog.Service, clock func() time.Time) *Service {
	if clock == nil {
		clock = time.Now
	}
	return &Service{pool: pool, q: sqlcgen.New(pool), cat: cat, now: func() time.Time { return clock().UTC().Truncate(time.Microsecond) }}
}

// Actor is the authenticated writer; IDs never come from request bodies.
type Actor struct {
	UserID     uuid.UUID
	SessionID  uuid.UUID
	DeviceName string
}

func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
func rfcp(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := rfc(*t)
	return &s
}

func dbErr(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := apperr.As(err); ok {
		return err
	}
	return fmt.Errorf("database: %w", err)
}

func parseRev(s string) (int64, error) {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n < 0 {
		return 0, apperr.Validation("baseRevision must be a nonnegative decimal string")
	}
	return n, nil
}

func parseUUID(field, s string) (uuid.UUID, error) {
	id, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil, apperr.Validation(field + " must be a UUID")
	}
	return id, nil
}

func parseTime(field, s string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return time.Time{}, apperr.Validation(field + " must be an RFC 3339 timestamp")
	}
	return t.UTC(), nil
}

func fingerprint(kind string, payload any) []byte {
	b, _ := json.Marshal(struct {
		Kind    string `json:"kind"`
		Payload any    `json:"payload"`
	}{kind, payload})
	h := sha256.Sum256(b)
	return h[:]
}

// ---- receipts ---------------------------------------------------------

type storedProblem struct {
	Status int                        `json:"status"`
	Code   string                     `json:"code"`
	Detail string                     `json:"detail"`
	Extra  map[string]json.RawMessage `json:"extra,omitempty"`
}

func encodeProblem(e *apperr.Error) []byte {
	sp := storedProblem{Status: e.Status, Code: e.Code, Detail: e.Detail, Extra: map[string]json.RawMessage{}}
	for k, v := range e.Extra {
		sp.Extra[k] = wire.Raw(v)
	}
	return wire.Raw(sp)
}

func decodeProblem(b []byte) *apperr.Error {
	var sp storedProblem
	_ = json.Unmarshal(b, &sp)
	e := apperr.New(sp.Status, sp.Code, sp.Detail)
	if len(sp.Extra) > 0 {
		e.Extra = map[string]any{}
		for k, v := range sp.Extra {
			e.Extra[k] = v
		}
	}
	return e
}

// work runs inside the transaction after the state row is locked and the
// receipt check passed. It returns a success body, a durable problem
// (persisted as the receipt, tx commits) or an error (tx rolls back, no receipt).
type work func(q *sqlcgen.Queries) (body []byte, durable *apperr.Error, err error)

// run executes one mutation with idempotent-receipt semantics. The caller's
// lock function must take the relevant state row lock first.
func (s *Service) run(ctx context.Context, a Actor, rec, op uuid.UUID, kind string, fp []byte,
	lock func(q *sqlcgen.Queries) error, w work) ([]byte, error) {
	var replay *sqlcgen.OperationReceipt
	var body []byte
	var durable *apperr.Error

	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		replay, body, durable = nil, nil, nil
		q := s.q.WithTx(tx)
		if err := lock(q); err != nil {
			return err
		}
		r, err := q.GetReceipt(ctx, sqlcgen.GetReceiptParams{UserID: a.UserID, RecordingID: rec, OperationID: op})
		if err == nil {
			replay = &r
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		b, d, err := w(q)
		if err != nil {
			return err
		}
		status, rbody := http.StatusOK, b
		if d != nil {
			status, rbody = d.Status, encodeProblem(d)
		}
		if err := q.InsertReceipt(ctx, sqlcgen.InsertReceiptParams{UserID: a.UserID, RecordingID: rec, OperationID: op, Kind: kind,
			Fingerprint: fp, Status: int32(status), Body: rbody}); err != nil {
			return err
		}
		body, durable = b, d
		return nil
	})
	if err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23505" {
			// A concurrent mutation of another kind claimed the same operation ID.
			return nil, operationReused()
		}
		return nil, dbErr(err)
	}
	if replay != nil {
		if replay.Kind != kind || !bytes.Equal(replay.Fingerprint, fp) {
			return nil, operationReused()
		}
		if replay.Status != http.StatusOK {
			return nil, decodeProblem(replay.Body)
		}
		return replay.Body, nil
	}
	if durable != nil {
		return nil, durable
	}
	return body, nil
}

func operationReused() *apperr.Error {
	return apperr.New(http.StatusConflict, "operation_id_reused", "That operation ID was already used for a different request.")
}

// ---- state assembly -------------------------------------------------------

func positionView(ps sqlcgen.PositionState) *wire.Position {
	if !ps.FileID.Valid || !ps.ContentVersion.Valid || ps.OffsetMs == nil || !ps.LayoutRevision.Valid || ps.CapturedAt == nil || ps.ReceivedAt == nil {
		return nil
	}
	dev := ""
	if ps.DeviceName != nil {
		dev = *ps.DeviceName
	}
	return &wire.Position{FileID: ps.FileID.UUID.String(), ContentVersion: ps.ContentVersion.UUID.String(), OffsetMs: *ps.OffsetMs,
		LayoutRevision: ps.LayoutRevision.UUID.String(), CapturedAt: rfc(*ps.CapturedAt), ReceivedAt: rfc(*ps.ReceivedAt), DeviceName: dev}
}

func conflictView(c sqlcgen.Conflict) wire.Conflict {
	out := wire.Conflict{ID: c.ID.String(), Reason: c.Reason, BaseRevision: strconv.FormatInt(c.BaseRevision, 10),
		CreatedAt: rfc(c.CreatedAt), ResolvedAt: rfcp(c.ResolvedAt)}
	if c.Kind == "completion" {
		var cw wire.CompletionWrite
		if json.Unmarshal(c.Candidate, &cw) == nil {
			out.CompletionCandidate = wire.Some(&cw)
		}
	} else {
		var p wire.Position
		if json.Unmarshal(c.Candidate, &p) == nil {
			out.Candidate = wire.Some(&p)
		}
	}
	return out
}

func positionState(ctx context.Context, q *sqlcgen.Queries, user, rec uuid.UUID) (wire.PositionState, error) {
	out := wire.PositionState{Revision: "0", UnresolvedConflicts: []wire.Conflict{}}
	ps, err := q.GetPositionState(ctx, sqlcgen.GetPositionStateParams{UserID: user, RecordingID: rec})
	if err == nil {
		out.Revision = strconv.FormatInt(ps.Revision, 10)
		out.Position = wire.Some(positionView(ps))
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	cs, err := q.ListOpenConflicts(ctx, sqlcgen.ListOpenConflictsParams{UserID: user, RecordingID: rec})
	if err != nil {
		return out, err
	}
	for _, c := range cs {
		out.UnresolvedConflicts = append(out.UnresolvedConflicts, conflictView(c))
	}
	return out, nil
}

func completionState(ctx context.Context, q *sqlcgen.Queries, user, rec uuid.UUID) (wire.CompletionState, error) {
	out := wire.CompletionState{Revision: "0"}
	cs, err := q.GetCompletionState(ctx, sqlcgen.GetCompletionStateParams{UserID: user, RecordingID: rec})
	if err == nil {
		out = wire.CompletionState{Revision: strconv.FormatInt(cs.Revision, 10), Finished: cs.Finished, ChangedAt: rfcp(cs.ChangedAt)}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	return out, nil
}

// GetPosition returns the user's PositionState; absence is revision 0.
func (s *Service) GetPosition(ctx context.Context, userID, recID uuid.UUID) (wire.PositionState, error) {
	if _, err := s.cat.Authorize(ctx, userID, recID); err != nil {
		return wire.PositionState{}, err
	}
	st, err := positionState(ctx, s.q, userID, recID)
	return st, dbErr(err)
}

// GetCompletion returns the user's CompletionState; absence is revision 0.
func (s *Service) GetCompletion(ctx context.Context, userID, recID uuid.UUID) (wire.CompletionState, error) {
	if _, err := s.cat.Authorize(ctx, userID, recID); err != nil {
		return wire.CompletionState{}, err
	}
	st, err := completionState(ctx, s.q, userID, recID)
	return st, dbErr(err)
}

// ---- anchors --------------------------------------------------------------

type anchorProblem int

const (
	anchorOK anchorProblem = iota
	anchorLayoutChanged
	anchorContentChanged
	anchorInvalid
)

// classify decides whether an anchor is usable against the current layout.
// Order matters: a replaced file reports content_changed even when the layout
// also moved; an unknown/nonmember file is rejected, never reinterpreted.
func classify(ctx context.Context, q *sqlcgen.Queries, files []sqlcgen.ListRecordingFilesRow, layoutMatches bool,
	fileID, version uuid.UUID) (anchorProblem, *sqlcgen.ListRecordingFilesRow, error) {
	var member *sqlcgen.ListRecordingFilesRow
	for i := range files {
		if files[i].FileID == fileID {
			member = &files[i]
		}
	}
	if member == nil {
		if !layoutMatches {
			return anchorLayoutChanged, nil, nil
		}
		return anchorInvalid, nil, nil
	}
	if member.ContentVersion != version {
		known, err := q.GetKnownFileVersion(ctx, version)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && known.FileID != fileID) {
			return anchorInvalid, member, nil
		}
		if err != nil {
			return anchorInvalid, member, err
		}
		return anchorContentChanged, member, nil
	}
	if !layoutMatches {
		return anchorLayoutChanged, member, nil
	}
	return anchorOK, member, nil
}

func checkOffset(m *sqlcgen.ListRecordingFilesRow, offset int64) error {
	if m.DurationMs == nil {
		return apperr.InvalidPosition("The file duration is unknown; the recording is incomplete.")
	}
	if offset < 0 || offset > *m.DurationMs {
		return apperr.InvalidPosition("The offset is outside the file; offsets are rejected, not clamped.")
	}
	return nil
}

func problemFor(p anchorProblem, conflictID uuid.UUID, layout uuid.UUID) *apperr.Error {
	code, detail := "layout_changed", "The recording layout changed; the position was preserved for resolution."
	if p == anchorContentChanged {
		code, detail = "content_changed", "The file content changed; the position was preserved and is not remapped."
	}
	return apperr.New(http.StatusPreconditionFailed, code, detail).With("conflictId", conflictID.String()).With("currentLayoutRevision", layout.String())
}

// ---- position write -------------------------------------------------------

// WritePosition applies PUT /recordings/{id}/position.
func (s *Service) WritePosition(ctx context.Context, a Actor, recID uuid.UUID, in wire.PositionWrite) (wire.PositionState, error) {
	op, err := parseUUID("operationId", in.OperationID)
	if err != nil {
		return wire.PositionState{}, err
	}
	base, err := parseRev(in.BaseRevision)
	if err != nil {
		return wire.PositionState{}, err
	}
	layout, err := parseUUID("layoutRevision", in.LayoutRevision)
	if err != nil {
		return wire.PositionState{}, err
	}
	fileID, err := parseUUID("position.fileId", in.Position.FileID)
	if err != nil {
		return wire.PositionState{}, err
	}
	version, err := parseUUID("position.contentVersion", in.Position.ContentVersion)
	if err != nil {
		return wire.PositionState{}, err
	}
	captured, err := parseTime("position.capturedAt", in.Position.CapturedAt)
	if err != nil {
		return wire.PositionState{}, err
	}
	if _, err := s.cat.Authorize(ctx, a.UserID, recID); err != nil {
		return wire.PositionState{}, err
	}
	fp := fingerprint("position", map[string]any{"base": base, "layout": layout, "file": fileID, "version": version,
		"offset": in.Position.OffsetMs, "captured": captured.Format(time.RFC3339Nano)})

	body, err := s.run(ctx, a, recID, op, "position", fp,
		func(q *sqlcgen.Queries) error {
			if err := q.EnsurePositionState(ctx, sqlcgen.EnsurePositionStateParams{UserID: a.UserID, RecordingID: recID}); err != nil {
				return err
			}
			_, err := q.LockPositionState(ctx, sqlcgen.LockPositionStateParams{UserID: a.UserID, RecordingID: recID})
			return err
		},
		func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
			now := s.now()
			rec, err := q.GetRecording(ctx, recID)
			if err != nil {
				return nil, nil, err
			}
			files, err := q.ListRecordingFiles(ctx, []uuid.UUID{recID})
			if err != nil {
				return nil, nil, err
			}
			cur, err := q.LockPositionState(ctx, sqlcgen.LockPositionStateParams{UserID: a.UserID, RecordingID: recID})
			if err != nil {
				return nil, nil, err
			}
			candidate := wire.Position{FileID: fileID.String(), ContentVersion: version.String(), OffsetMs: in.Position.OffsetMs,
				LayoutRevision: layout.String(), CapturedAt: rfc(captured), ReceivedAt: rfc(now), DeviceName: a.DeviceName}
			newConflict := func(reason string) (sqlcgen.Conflict, error) {
				return q.InsertConflict(ctx, sqlcgen.InsertConflictParams{UserID: a.UserID, RecordingID: recID, Kind: "position", Reason: reason,
					OperationID: op, Candidate: wire.Raw(candidate), BaseRevision: base, LayoutRevision: uuid.NullUUID{UUID: layout, Valid: true}, CreatedAt: now})
			}

			problem, member, err := classify(ctx, q, files, layout == rec.LayoutRevision, fileID, version)
			if err != nil {
				return nil, nil, err
			}
			switch problem {
			case anchorInvalid:
				return nil, nil, apperr.InvalidPosition("The file/version is not part of this recording.")
			case anchorLayoutChanged, anchorContentChanged:
				reason := "layout_changed"
				if problem == anchorContentChanged {
					reason = "content_changed"
				}
				c, err := newConflict(reason)
				if err != nil {
					return nil, nil, err
				}
				return nil, problemFor(problem, c.ID, rec.LayoutRevision), nil
			}
			if err := checkOffset(member, in.Position.OffsetMs); err != nil {
				return nil, nil, err
			}
			if base > cur.Revision {
				return nil, nil, apperr.Validation("baseRevision is ahead of the server revision")
			}
			if base != cur.Revision {
				c, err := newConflict("stale_revision")
				if err != nil {
					return nil, nil, err
				}
				st, err := positionState(ctx, q, a.UserID, recID)
				if err != nil {
					return nil, nil, err
				}
				return nil, apperr.New(http.StatusConflict, "position_conflict", "The position changed on the server; choose which to keep.").
					With("conflictId", c.ID.String()).With("current", st), nil
			}
			if err := q.SetPositionState(ctx, sqlcgen.SetPositionStateParams{UserID: a.UserID, RecordingID: recID, Revision: cur.Revision + 1,
				FileID: uuid.NullUUID{UUID: fileID, Valid: true}, ContentVersion: uuid.NullUUID{UUID: version, Valid: true},
				OffsetMs: &in.Position.OffsetMs, LayoutRevision: uuid.NullUUID{UUID: layout, Valid: true},
				CapturedAt: &captured, ReceivedAt: &now, DeviceName: &a.DeviceName}); err != nil {
				return nil, nil, err
			}
			if err := q.UpsertEvidence(ctx, sqlcgen.UpsertEvidenceParams{UserID: a.UserID, RecordingID: recID, SessionID: a.SessionID,
				FileID: fileID, ContentVersion: version, OffsetMs: in.Position.OffsetMs, LayoutRevision: layout,
				CapturedAt: captured, ReceivedAt: now, DeviceName: a.DeviceName}); err != nil {
				return nil, nil, err
			}
			st, err := positionState(ctx, q, a.UserID, recID)
			if err != nil {
				return nil, nil, err
			}
			return wire.Raw(st), nil, nil
		})
	if err != nil {
		return wire.PositionState{}, err
	}
	var st wire.PositionState
	if err := json.Unmarshal(body, &st); err != nil {
		return st, err
	}
	return st, nil
}

// ResolveConflict applies POST /recordings/{id}/conflicts/{cid}/resolve.
func (s *Service) ResolveConflict(ctx context.Context, a Actor, recID, conflictID uuid.UUID, in wire.ResolveConflict) (wire.PositionState, error) {
	op, err := parseUUID("operationId", in.OperationID)
	if err != nil {
		return wire.PositionState{}, err
	}
	base, err := parseRev(in.BaseRevision)
	if err != nil {
		return wire.PositionState{}, err
	}
	layout, err := parseUUID("layoutRevision", in.LayoutRevision)
	if err != nil {
		return wire.PositionState{}, err
	}
	var explicit *wire.PositionInput
	switch in.Choice {
	case "keep_server", "use_candidate":
		if in.Position.Value != nil {
			return wire.PositionState{}, apperr.Validation("position must be null for this choice")
		}
	case "use_explicit":
		if in.Position.Value == nil {
			return wire.PositionState{}, apperr.Validation("position is required for use_explicit")
		}
		explicit = in.Position.Value
	default:
		return wire.PositionState{}, apperr.Validation("unknown choice")
	}
	var exFile, exVer uuid.UUID
	var exCaptured time.Time
	if explicit != nil {
		if exFile, err = parseUUID("position.fileId", explicit.FileID); err != nil {
			return wire.PositionState{}, err
		}
		if exVer, err = parseUUID("position.contentVersion", explicit.ContentVersion); err != nil {
			return wire.PositionState{}, err
		}
		if exCaptured, err = parseTime("position.capturedAt", explicit.CapturedAt); err != nil {
			return wire.PositionState{}, err
		}
	}
	if _, err := s.cat.Authorize(ctx, a.UserID, recID); err != nil {
		return wire.PositionState{}, err
	}
	var fpPos any
	if explicit != nil {
		fpPos = map[string]any{"file": exFile, "version": exVer, "offset": explicit.OffsetMs, "captured": exCaptured.Format(time.RFC3339Nano)}
	}
	fp := fingerprint("resolve_position", map[string]any{"conflict": conflictID, "choice": in.Choice, "base": base, "layout": layout, "position": fpPos})

	body, err := s.run(ctx, a, recID, op, "resolve_position", fp,
		func(q *sqlcgen.Queries) error {
			if err := q.EnsurePositionState(ctx, sqlcgen.EnsurePositionStateParams{UserID: a.UserID, RecordingID: recID}); err != nil {
				return err
			}
			_, err := q.LockPositionState(ctx, sqlcgen.LockPositionStateParams{UserID: a.UserID, RecordingID: recID})
			return err
		},
		func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
			now := s.now()
			c, err := q.GetConflictForUpdate(ctx, sqlcgen.GetConflictForUpdateParams{ID: conflictID, UserID: a.UserID, RecordingID: recID})
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && c.Kind != "position") {
				return nil, nil, apperr.ErrNotFound
			}
			if err != nil {
				return nil, nil, err
			}
			if c.ResolvedAt != nil {
				return nil, apperr.New(http.StatusConflict, "conflict_resolved", "That conflict was already resolved.").With("conflictId", c.ID.String()), nil
			}
			rec, err := q.GetRecording(ctx, recID)
			if err != nil {
				return nil, nil, err
			}
			cur, err := q.LockPositionState(ctx, sqlcgen.LockPositionStateParams{UserID: a.UserID, RecordingID: recID})
			if err != nil {
				return nil, nil, err
			}
			if layout != rec.LayoutRevision {
				return nil, problemFor(anchorLayoutChanged, c.ID, rec.LayoutRevision), nil
			}
			if base > cur.Revision {
				return nil, nil, apperr.Validation("baseRevision is ahead of the server revision")
			}
			if base != cur.Revision {
				st, err := positionState(ctx, q, a.UserID, recID)
				if err != nil {
					return nil, nil, err
				}
				return nil, apperr.New(http.StatusConflict, "position_conflict", "The position changed while choosing; the conflict is still unresolved.").
					With("conflictId", c.ID.String()).With("current", st), nil
			}
			files, err := q.ListRecordingFiles(ctx, []uuid.UUID{recID})
			if err != nil {
				return nil, nil, err
			}

			next := cur // keep_server keeps the canonical position
			setAnchor := func(file, ver uuid.UUID, offset int64, captured time.Time, device string) *apperr.Error {
				next.FileID = uuid.NullUUID{UUID: file, Valid: true}
				next.ContentVersion = uuid.NullUUID{UUID: ver, Valid: true}
				next.OffsetMs = &offset
				next.LayoutRevision = uuid.NullUUID{UUID: layout, Valid: true}
				next.CapturedAt = &captured
				next.ReceivedAt = &now
				next.DeviceName = &device
				return nil
			}
			switch in.Choice {
			case "use_candidate":
				var cand wire.Position
				if err := json.Unmarshal(c.Candidate, &cand); err != nil {
					return nil, nil, err
				}
				f, _ := uuid.Parse(cand.FileID)
				v, _ := uuid.Parse(cand.ContentVersion)
				problem, member, err := classify(ctx, q, files, true, f, v)
				if err != nil {
					return nil, nil, err
				}
				switch problem {
				case anchorContentChanged:
					return nil, problemFor(problem, c.ID, rec.LayoutRevision), nil
				case anchorInvalid:
					return nil, nil, apperr.InvalidPosition("The saved candidate is no longer valid; choose an explicit position.")
				}
				if err := checkOffset(member, cand.OffsetMs); err != nil {
					return nil, nil, err
				}
				ct, _ := time.Parse(time.RFC3339Nano, cand.CapturedAt)
				setAnchor(f, v, cand.OffsetMs, ct.UTC(), cand.DeviceName)
			case "use_explicit":
				problem, member, err := classify(ctx, q, files, true, exFile, exVer)
				if err != nil {
					return nil, nil, err
				}
				switch problem {
				case anchorContentChanged:
					return nil, problemFor(problem, c.ID, rec.LayoutRevision), nil
				case anchorInvalid:
					return nil, nil, apperr.InvalidPosition("The file/version is not part of this recording.")
				}
				if err := checkOffset(member, explicit.OffsetMs); err != nil {
					return nil, nil, err
				}
				setAnchor(exFile, exVer, explicit.OffsetMs, exCaptured, a.DeviceName)
			}
			if err := q.SetPositionState(ctx, sqlcgen.SetPositionStateParams{UserID: a.UserID, RecordingID: recID, Revision: cur.Revision + 1,
				FileID: next.FileID, ContentVersion: next.ContentVersion, OffsetMs: next.OffsetMs, LayoutRevision: next.LayoutRevision,
				CapturedAt: next.CapturedAt, ReceivedAt: next.ReceivedAt, DeviceName: next.DeviceName}); err != nil {
				return nil, nil, err
			}
			if err := q.ResolveConflictRow(ctx, sqlcgen.ResolveConflictRowParams{ID: c.ID, ResolvedAt: &now, ResolvedOperationID: uuid.NullUUID{UUID: op, Valid: true}}); err != nil {
				return nil, nil, err
			}
			st, err := positionState(ctx, q, a.UserID, recID)
			if err != nil {
				return nil, nil, err
			}
			return wire.Raw(st), nil, nil
		})
	if err != nil {
		return wire.PositionState{}, err
	}
	var st wire.PositionState
	return st, json.Unmarshal(body, &st)
}
