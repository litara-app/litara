package reading

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// editionUserRow returns the edition's user value of a field, or nil when there is none.
func editionUserRow(ctx context.Context, q *sqlcgen.Queries, id uuid.UUID, field string) (*sqlcgen.EditionMetadataValue, error) {
	rows, err := q.ListEditionMetadataValues(ctx, id)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if rows[i].Field == field && rows[i].Source == metadata.SourceUser {
			return &rows[i], nil
		}
	}
	return nil, nil
}

func editionLocked(ctx context.Context, q *sqlcgen.Queries, id uuid.UUID, field string) (bool, error) {
	r, err := editionUserRow(ctx, q, id, field)
	return r != nil && r.Locked, err
}

// MetadataChanges converts a save's wire changes.
func MetadataChanges(in []wire.MetadataChange) []metadata.Change {
	out := make([]metadata.Change, len(in))
	for i, c := range in {
		out[i] = metadata.Change{Field: c.Field, Action: c.Action, Clear: c.Clear, Value: c.Value.Raw}
	}
	return out
}

// SaveEditionMetadata applies an edition's metadata changes together, under one revision (ADR-0095 decision 4,
// ADR-0097). A stale revision, or a set or reset of a locked field, refuses the whole save and stores nothing.
func (s *Service) SaveEditionMetadata(ctx context.Context, a Actor, id uuid.UUID, w wire.MetadataSave) (wire.EditionMetadataReport, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.EditionMetadataReport{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.EditionMetadataReport{}, err
	}
	changes := MetadataChanges(w.Changes)
	if d := metadata.CheckChanges(changes, validEditionField); d != nil {
		return wire.EditionMetadataReport{}, d
	}
	stored := map[string]json.RawMessage{}
	for _, c := range changes {
		if c.Action != metadata.ActionSet {
			continue
		}
		raw, err := editionValue(c.Field, wire.EditionMetadataWrite{Clear: c.Clear, Value: wire.MetadataValue{Raw: c.Value}})
		if err != nil {
			return wire.EditionMetadataReport{}, err
		}
		stored[c.Field] = raw
	}
	if _, err := s.EditionLibrary(ctx, id); err != nil {
		return wire.EditionMetadataReport{}, err
	}
	fp := fingerprint(http.MethodPatch, "/admin/editions/"+id.String()+"/metadata", w)
	body, err := s.mutateEdition(ctx, a, id, op, base, fp, func(q *sqlcgen.Queries, ed sqlcgen.Edition) (*apperr.Error, error) {
		// Every lock is checked before anything is written: a refusal is stored as this operation's result and its
		// transaction commits, so nothing may have been changed by then.
		for _, c := range changes {
			if c.Action != metadata.ActionSet && c.Action != metadata.ActionReset {
				continue
			}
			locked, err := editionLocked(ctx, q, id, c.Field)
			if err != nil {
				return nil, err
			}
			if locked {
				return metadata.FieldLocked(c.Field), nil
			}
		}
		for _, c := range changes {
			var err error
			switch c.Action {
			case metadata.ActionSet:
				raw := stored[c.Field]
				err = q.UpsertEditionMetadataValue(ctx, sqlcgen.UpsertEditionMetadataValueParams{EditionID: id, Field: c.Field, Source: metadata.SourceUser,
					Value: raw, ProtectedClear: raw == nil})
			case metadata.ActionReset:
				_, err = q.DeleteEditionMetadataValue(ctx, sqlcgen.DeleteEditionMetadataValueParams{EditionID: id, Field: c.Field, Source: metadata.SourceUser})
			case metadata.ActionLock:
				err = s.lockEditionField(ctx, q, ed, c.Field)
			case metadata.ActionUnlock:
				_, err = q.SetEditionMetadataLock(ctx, sqlcgen.SetEditionMetadataLockParams{Locked: false, EditionID: id, Field: c.Field})
			}
			if err != nil {
				return nil, err
			}
		}
		return nil, s.propagate(ctx, q, ed)
	}, s.renderReport(ctx, id))
	if err != nil {
		return wire.EditionMetadataReport{}, err
	}
	var out wire.EditionMetadataReport
	return out, json.Unmarshal(body, &out)
}

// lockEditionField locks a field as it is now. A value shown from another source (including the file name) is frozen
// by copying it into a user value; an empty field is frozen as a deliberate clear (ADR-0097).
func (s *Service) lockEditionField(ctx context.Context, q *sqlcgen.Queries, ed sqlcgen.Edition, field string) error {
	row, err := editionUserRow(ctx, q, ed.ID, field)
	if err != nil {
		return err
	}
	if row == nil {
		rep, err := s.report(ctx, q, ed.ID, ed.Revision)
		if err != nil {
			return err
		}
		var raw json.RawMessage
		for _, f := range rep.Fields {
			if f.Field == field && !f.Cleared {
				raw = f.Value.Raw
			}
		}
		if raw == nil && field == "title" {
			return apperr.Validation("The title has no value to lock.")
		}
		if err := q.UpsertEditionMetadataValue(ctx, sqlcgen.UpsertEditionMetadataValueParams{EditionID: ed.ID, Field: field, Source: metadata.SourceUser,
			Value: raw, ProtectedClear: raw == nil}); err != nil {
			return err
		}
	}
	_, err = q.SetEditionMetadataLock(ctx, sqlcgen.SetEditionMetadataLockParams{Locked: true, EditionID: ed.ID, Field: field})
	return err
}
