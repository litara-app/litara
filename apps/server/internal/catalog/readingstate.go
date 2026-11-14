package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// CompletionState returns the caller own edition completion; absence is revision 0.
func (s *Service) CompletionState(ctx context.Context, userID, editionID uuid.UUID) (wire.T005Completion, error) {
	return s.CompletionStateTx(ctx, s.q, userID, editionID)
}

// CompletionStateTx reads through q so a writer sees its own uncommitted row.
func (s *Service) CompletionStateTx(ctx context.Context, q *sqlcgen.Queries, userID, editionID uuid.UUID) (wire.T005Completion, error) {
	out := wire.T005Completion{Revision: "0"}
	c, err := q.GetEditionCompletion(ctx, sqlcgen.GetEditionCompletionParams{UserID: userID, EditionID: editionID})
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, unavailable(err)
	}
	out.Revision, out.Finished = strconv.FormatInt(c.Revision, 10), c.Finished
	out.ChangedAt = rfcp(c.ChangedAt)
	return out, nil
}

// PositionState returns the caller own edition position; absence is revision 0, position null.
func (s *Service) PositionState(ctx context.Context, userID, editionID uuid.UUID) (wire.T005PositionState, error) {
	return s.PositionStateTx(ctx, s.q, userID, editionID)
}

func (s *Service) PositionStateTx(ctx context.Context, q *sqlcgen.Queries, userID, editionID uuid.UUID) (wire.T005PositionState, error) {
	out := wire.T005PositionState{Revision: "0", ConflictsPath: fmt.Sprintf("%s/personal-conflicts?resourceId=%s", s.apiBase, editionID)}
	p, err := q.GetEditionPosition(ctx, sqlcgen.GetEditionPositionParams{UserID: userID, EditionID: editionID})
	switch {
	case err == nil:
		out.Revision = strconv.FormatInt(p.Revision, 10)
		if p.FileID.Valid && p.ContentVersion.Valid && len(p.Locator) > 0 && p.CapturedAt != nil && p.ReceivedAt != nil {
			var loc wire.T005Locator
			if json.Unmarshal(p.Locator, &loc) == nil {
				dev := ""
				if p.DeviceName != nil {
					dev = *p.DeviceName
				}
				pos := wire.T005Position{Anchor: wire.T005Anchor{FileID: p.FileID.UUID.String(), ContentVersion: p.ContentVersion.UUID.String(), Locator: loc},
					CapturedAt: p.CapturedAt.UTC().Format(time.RFC3339Nano), ReceivedAt: p.ReceivedAt.UTC().Format(time.RFC3339Nano), DeviceName: dev}
				out.Position = wire.Some(&pos)
			}
		}
	case !errors.Is(err, pgx.ErrNoRows):
		return out, unavailable(err)
	}
	n, err := q.CountOpenEditionConflicts(ctx, sqlcgen.CountOpenEditionConflictsParams{UserID: userID, ResourceID: editionID})
	if err != nil {
		return out, unavailable(err)
	}
	out.UnresolvedConflictCount = n
	return out, nil
}
