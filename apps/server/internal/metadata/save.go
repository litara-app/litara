package metadata

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/receipts"
)

// What a metadata save can do to one field (ADR-0095, ADR-0097).
const (
	// ActionSet stores a protected edit, or a deliberate clear.
	ActionSet = "set"
	// ActionReset discards the saved edit or clear so other sources apply again ("Reset to source").
	ActionReset = "reset"
	// ActionLock freezes the field as it is now. Only the person locks a field.
	ActionLock = "lock"
	// ActionUnlock removes only the lock; the value stays.
	ActionUnlock = "unlock"
)

// Change is one field change of a save. Value is nil for a clear and for every action other than set.
type Change struct {
	Field  string
	Action string
	Clear  bool
	Value  json.RawMessage
}

// FieldLocked refuses a change to a locked field: it must be unlocked first (ADR-0097 decision 1; the owner chose on
// 2026-11-25 that this holds for typed edits and resets as well as provider applies).
func FieldLocked(field string) *apperr.Error {
	return apperr.New(http.StatusConflict, "field_locked", "The field "+field+" is locked. Unlock it first.").With("field", field)
}

// StaleRevision refuses a save based on an older revision.
func StaleRevision(current int64) *apperr.Error {
	return apperr.New(http.StatusConflict, "stale_revision", "The metadata changed since that revision; refetch and retry.").
		With("currentRevision", strconv.FormatInt(current, 10))
}

// CheckChanges validates the shape of a save: known actions and fields, each field at most once, and a value only
// where action set needs one. Field values themselves are checked by the caller's own validation.
func CheckChanges(changes []Change, valid func(string) bool) *apperr.Error {
	seen := map[string]bool{}
	for _, c := range changes {
		if !valid(c.Field) {
			return apperr.Validation("Unknown metadata field " + c.Field + ".")
		}
		if seen[c.Field] {
			return apperr.Validation("A save may change each field once; " + c.Field + " appears twice.")
		}
		seen[c.Field] = true
		hasValue := len(bytes.TrimSpace(c.Value)) > 0 && string(bytes.TrimSpace(c.Value)) != "null"
		switch c.Action {
		case ActionSet:
			if c.Clear == hasValue {
				return apperr.Validation("Action set needs either a value or clear true for " + c.Field + ".")
			}
		case ActionReset, ActionLock, ActionUnlock:
			if c.Clear || hasValue {
				return apperr.Validation("Action " + c.Action + " takes no value for " + c.Field + ".")
			}
		default:
			return apperr.Validation("Unknown action " + c.Action + ".")
		}
	}
	return nil
}

// checkUserValue validates a protected edit (raw) or a protected clear (raw nil).
func checkUserValue(field string, raw json.RawMessage) error {
	if !Valid(field) {
		return apperr.Validation("unknown field " + field)
	}
	if raw == nil {
		if field == FieldTitle {
			return apperr.Validation("the title cannot be cleared")
		}
		return nil
	}
	return validate(field, raw)
}

// userRow returns the field's user value of a recording, or nil when there is none.
func userRow(ctx context.Context, q *sqlcgen.Queries, rec sqlcgen.GetRecordingRowRow, field string) (*sqlcgen.MetadataValue, error) {
	rows, err := q.ListMetadataValues(ctx, sqlcgen.ListMetadataValuesParams{SubjectKind: SubjectKind(field), SubjectID: subject(rec, field)})
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if rows[i].Field == field && rows[i].Source == SourceUser {
			return &rows[i], nil
		}
	}
	return nil, nil
}

func lockedQ(ctx context.Context, q *sqlcgen.Queries, rec sqlcgen.GetRecordingRowRow, field string) (bool, error) {
	r, err := userRow(ctx, q, rec, field)
	return r != nil && r.Locked, err
}

func setUserQ(ctx context.Context, q *sqlcgen.Queries, rec sqlcgen.GetRecordingRowRow, field string, raw json.RawMessage) (bool, *apperr.Error, error) {
	if locked, err := lockedQ(ctx, q, rec, field); err != nil || locked {
		if locked {
			return false, FieldLocked(field), nil
		}
		return false, nil, err
	}
	n, err := q.UpsertMetadataValue(ctx, sqlcgen.UpsertMetadataValueParams{SubjectKind: SubjectKind(field), SubjectID: subject(rec, field),
		Field: field, Source: SourceUser, Value: raw, ProtectedClear: raw == nil})
	return n > 0, nil, err
}

func resetQ(ctx context.Context, q *sqlcgen.Queries, rec sqlcgen.GetRecordingRowRow, field string) (bool, *apperr.Error, error) {
	if locked, err := lockedQ(ctx, q, rec, field); err != nil || locked {
		if locked {
			return false, FieldLocked(field), nil
		}
		return false, nil, err
	}
	n, err := q.DeleteMetadataValue(ctx, sqlcgen.DeleteMetadataValueParams{SubjectKind: SubjectKind(field), SubjectID: subject(rec, field), Field: field, Source: SourceUser})
	return n > 0, nil, err
}

// lockQ locks a field as it is now. A field shown from another source is frozen by copying what is shown into a user
// value, so a later rescan or lookup cannot change it; an empty field is frozen as a deliberate clear.
func lockQ(ctx context.Context, q *sqlcgen.Queries, rec sqlcgen.GetRecordingRowRow, field string) (bool, *apperr.Error, error) {
	row, err := userRow(ctx, q, rec, field)
	if err != nil {
		return false, nil, err
	}
	if row == nil {
		eff, _, err := reportQ(ctx, q, rec)
		if err != nil {
			return false, nil, err
		}
		var raw json.RawMessage
		if e, ok := eff[field]; ok && !e.Cleared {
			raw = e.Raw
		} else if field == FieldTitle {
			t, err := q.GetTitleRow(ctx, rec.TitleID)
			if err != nil {
				return false, nil, err
			}
			raw, _ = json.Marshal(t.Title)
		}
		if _, err := q.UpsertMetadataValue(ctx, sqlcgen.UpsertMetadataValueParams{SubjectKind: SubjectKind(field), SubjectID: subject(rec, field),
			Field: field, Source: SourceUser, Value: raw, ProtectedClear: raw == nil}); err != nil {
			return false, nil, err
		}
	}
	n, err := q.SetMetadataLock(ctx, sqlcgen.SetMetadataLockParams{Locked: true, SubjectKind: SubjectKind(field), SubjectID: subject(rec, field), Field: field})
	return n > 0, nil, err
}

func unlockQ(ctx context.Context, q *sqlcgen.Queries, rec sqlcgen.GetRecordingRowRow, field string) (bool, *apperr.Error, error) {
	n, err := q.SetMetadataLock(ctx, sqlcgen.SetMetadataLockParams{Locked: false, SubjectKind: SubjectKind(field), SubjectID: subject(rec, field), Field: field})
	return n > 0, nil, err
}

// Save applies a recording's metadata changes together, against base, the title metadata revision the form was loaded
// from (ADR-0095 decision 4). A stale base, or a set or reset of a locked field, refuses the whole save and stores
// nothing. An identical retry of the same operation returns the first result. render builds the response body from
// the report after the save.
func (s *Service) Save(ctx context.Context, userID, recordingID, op uuid.UUID, base int64, changes []Change, fp []byte,
	render func(map[string]Effective, int64) []byte) ([]byte, error) {
	if d := CheckChanges(changes, Valid); d != nil {
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
	rec, err := sqlcgen.New(s.Pool).GetRecordingRow(ctx, recordingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperr.ErrNotFound
	}
	if err != nil {
		return nil, apperr.ErrUnavailable
	}
	return s.saveRows(ctx, userID, op, base, changes, fp, render, rec, func(q *sqlcgen.Queries) error { return applyQ(ctx, q, rec.ID) })
}

// saveRows is the transaction of a save. rec names the rows the fields live in; apply writes the result onto them.
func (s *Service) saveRows(ctx context.Context, userID, op uuid.UUID, base int64, changes []Change, fp []byte,
	render func(map[string]Effective, int64) []byte, rec sqlcgen.GetRecordingRowRow, apply func(*sqlcgen.Queries) error) ([]byte, error) {
	_, body, err := receipts.New(s.Pool).Run(ctx, userID, op, fp,
		func(_ pgx.Tx, q *sqlcgen.Queries) error {
			_, err := q.LockTitleMetadataRevision(ctx, rec.TitleID)
			return err
		},
		func(_ pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
			rev, err := q.GetTitleMetadataRevision(ctx, rec.TitleID)
			if err != nil {
				return 0, nil, nil, err
			}
			if rev != base {
				return 0, nil, StaleRevision(rev), nil
			}
			// Every lock is checked before anything is written, so a refusal never leaves part of the save behind.
			for _, c := range changes {
				if c.Action != ActionSet && c.Action != ActionReset {
					continue
				}
				locked, err := lockedQ(ctx, q, rec, c.Field)
				if err != nil {
					return 0, nil, nil, err
				}
				if locked {
					return 0, nil, FieldLocked(c.Field), nil
				}
			}
			changed := false
			for _, c := range changes {
				var ch bool
				var err error
				switch c.Action {
				case ActionSet:
					var raw json.RawMessage
					if !c.Clear {
						raw = c.Value
					}
					ch, _, err = setUserQ(ctx, q, rec, c.Field, raw)
				case ActionReset:
					ch, _, err = resetQ(ctx, q, rec, c.Field)
				case ActionLock:
					ch, _, err = lockQ(ctx, q, rec, c.Field)
				case ActionUnlock:
					ch, _, err = unlockQ(ctx, q, rec, c.Field)
				}
				if err != nil {
					return 0, nil, nil, err
				}
				changed = changed || ch
			}
			if changed {
				if err := q.BumpTitleMetadataRevision(ctx, rec.TitleID); err != nil {
					return 0, nil, nil, err
				}
				if err := apply(q); err != nil {
					return 0, nil, nil, err
				}
			}
			rep, rev, err := reportQ(ctx, q, rec)
			if err != nil {
				return 0, nil, nil, err
			}
			return http.StatusOK, render(rep, rev), nil, nil
		})
	return body, err
}
