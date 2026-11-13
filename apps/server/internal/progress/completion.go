package progress

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

func completionConflictProblem(conflictID uuid.UUID, cur wire.CompletionState, detail string) *apperr.Error {
	return apperr.New(http.StatusConflict, "completion_conflict", detail).With("conflictId", conflictID.String()).With("currentCompletion", cur)
}

// validateTerminal checks a natural_end anchor: the final file, its current
// version, at exactly its known duration. Seeking never finishes a recording.
func validateTerminal(ctx context.Context, q *sqlcgen.Queries, files []sqlcgen.ListRecordingFilesRow, layoutMatches bool,
	anchor *wire.Anchor) (anchorProblem, *apperr.Error, error) {
	f, err := uuid.Parse(anchor.FileID)
	if err != nil {
		return anchorInvalid, apperr.Validation("finalPosition.fileId must be a UUID"), nil
	}
	v, err := uuid.Parse(anchor.ContentVersion)
	if err != nil {
		return anchorInvalid, apperr.Validation("finalPosition.contentVersion must be a UUID"), nil
	}
	problem, member, err := classify(ctx, q, files, layoutMatches, f, v)
	if err != nil {
		return anchorInvalid, nil, err
	}
	switch problem {
	case anchorInvalid:
		return problem, apperr.InvalidPosition("The final position is not part of this recording."), nil
	case anchorLayoutChanged, anchorContentChanged:
		return problem, nil, nil
	}
	last := files[len(files)-1]
	if member.FileID != last.FileID || member.DurationMs == nil || anchor.OffsetMs != *member.DurationMs {
		return anchorInvalid, apperr.InvalidPosition("natural_end must be anchored at the end of the final file."), nil
	}
	return anchorOK, nil, nil
}

func checkEventShape(event string, final *wire.Anchor) error {
	switch event {
	case "natural_end":
		if final == nil {
			return apperr.Validation("natural_end requires finalPosition")
		}
	case "manual_finish", "manual_unfinish":
		if final != nil {
			return apperr.Validation(event + " requires finalPosition to be null")
		}
	default:
		return apperr.Validation("unknown completion event")
	}
	return nil
}

// applyEvent performs the finish/unfinish transition inside the caller's
// transaction. A repeated finish (or unfinish of an unfinished recording) is
// accepted without a new revision or history entry.
func (s *Service) applyEvent(ctx context.Context, q *sqlcgen.Queries, a Actor, rec sqlcgen.GetRecordingRow, op uuid.UUID,
	cur sqlcgen.CompletionState, event string, captured time.Time, forceBump bool) (wire.CompletionState, error) {
	now := s.now()
	wantFinished := event != "manual_unfinish"
	changed := wantFinished != cur.Finished
	if changed || forceBump {
		changedAt := cur.ChangedAt
		if changed {
			changedAt = &now
		}
		if err := q.SetCompletionState(ctx, sqlcgen.SetCompletionStateParams{UserID: a.UserID, RecordingID: rec.ID,
			Revision: cur.Revision + 1, Finished: wantFinished || (!changed && cur.Finished), ChangedAt: changedAt}); err != nil {
			return wire.CompletionState{}, err
		}
		if changed {
			if err := q.InsertHistory(ctx, sqlcgen.InsertHistoryParams{UserID: a.UserID, TitleID: rec.TitleID, RecordingID: rec.ID,
				Event: event, OperationID: op, CapturedAt: captured, ReceivedAt: now}); err != nil {
				return wire.CompletionState{}, err
			}
		}
	}
	return completionState(ctx, q, a.UserID, rec.ID)
}

func lockCompletion(ctx context.Context, a Actor, rec uuid.UUID) func(q *sqlcgen.Queries) error {
	return func(q *sqlcgen.Queries) error {
		if err := q.EnsureCompletionState(ctx, sqlcgen.EnsureCompletionStateParams{UserID: a.UserID, RecordingID: rec}); err != nil {
			return err
		}
		_, err := q.LockCompletionState(ctx, sqlcgen.LockCompletionStateParams{UserID: a.UserID, RecordingID: rec})
		return err
	}
}

// WriteCompletion applies PUT /recordings/{id}/completion.
func (s *Service) WriteCompletion(ctx context.Context, a Actor, recID uuid.UUID, in wire.CompletionWrite) (wire.CompletionState, error) {
	op, err := parseUUID("operationId", in.OperationID)
	if err != nil {
		return wire.CompletionState{}, err
	}
	base, err := parseRev(in.BaseRevision)
	if err != nil {
		return wire.CompletionState{}, err
	}
	layout, err := parseUUID("layoutRevision", in.LayoutRevision)
	if err != nil {
		return wire.CompletionState{}, err
	}
	captured, err := parseTime("capturedAt", in.CapturedAt)
	if err != nil {
		return wire.CompletionState{}, err
	}
	if err := checkEventShape(in.Event, in.FinalPosition.Value); err != nil {
		return wire.CompletionState{}, err
	}
	if _, err := s.cat.Authorize(ctx, a.UserID, recID); err != nil {
		return wire.CompletionState{}, err
	}
	var fpFinal any
	if in.FinalPosition.Value != nil {
		fpFinal = *in.FinalPosition.Value
	}
	fp := fingerprint("completion", map[string]any{"base": base, "layout": layout, "event": in.Event, "captured": captured.Format(time.RFC3339Nano), "final": fpFinal})

	body, err := s.run(ctx, a, recID, op, "completion", fp, lockCompletion(ctx, a, recID),
		func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
			now := s.now()
			rec, err := q.GetRecording(ctx, recID)
			if err != nil {
				return nil, nil, err
			}
			cur, err := q.LockCompletionState(ctx, sqlcgen.LockCompletionStateParams{UserID: a.UserID, RecordingID: recID})
			if err != nil {
				return nil, nil, err
			}
			curView, err := completionState(ctx, q, a.UserID, recID)
			if err != nil {
				return nil, nil, err
			}
			newConflict := func(reason string) (sqlcgen.Conflict, error) {
				return q.InsertConflict(ctx, sqlcgen.InsertConflictParams{UserID: a.UserID, RecordingID: recID, Kind: "completion", Reason: reason,
					OperationID: op, Candidate: wire.Raw(in), BaseRevision: base, LayoutRevision: uuid.NullUUID{UUID: layout, Valid: true}, CreatedAt: now})
			}
			if in.Event == "natural_end" {
				files, err := q.ListRecordingFiles(ctx, []uuid.UUID{recID})
				if err != nil {
					return nil, nil, err
				}
				problem, perr, err := validateTerminal(ctx, q, files, layout == rec.LayoutRevision, in.FinalPosition.Value)
				if err != nil {
					return nil, nil, err
				}
				if perr != nil {
					return nil, nil, perr
				}
				if problem == anchorLayoutChanged || problem == anchorContentChanged {
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
			}
			if base > cur.Revision {
				return nil, nil, apperr.Validation("baseRevision is ahead of the server revision")
			}
			if base != cur.Revision {
				c, err := newConflict("completion_changed")
				if err != nil {
					return nil, nil, err
				}
				return nil, completionConflictProblem(c.ID, curView, "The completion state changed on the server; the event was preserved."), nil
			}
			st, err := s.applyEvent(ctx, q, a, rec, op, cur, in.Event, captured, false)
			if err != nil {
				return nil, nil, err
			}
			return wire.Raw(st), nil, nil
		})
	if err != nil {
		return wire.CompletionState{}, err
	}
	var st wire.CompletionState
	return st, json.Unmarshal(body, &st)
}

// ResolveCompletionConflict applies POST /recordings/{id}/completion-conflicts/{cid}/resolve.
func (s *Service) ResolveCompletionConflict(ctx context.Context, a Actor, recID, conflictID uuid.UUID, in wire.ResolveCompletionConflict) (wire.CompletionState, error) {
	op, err := parseUUID("operationId", in.OperationID)
	if err != nil {
		return wire.CompletionState{}, err
	}
	base, err := parseRev(in.BaseRevision)
	if err != nil {
		return wire.CompletionState{}, err
	}
	layout, err := parseUUID("layoutRevision", in.LayoutRevision)
	if err != nil {
		return wire.CompletionState{}, err
	}
	captured, err := parseTime("capturedAt", in.CapturedAt)
	if err != nil {
		return wire.CompletionState{}, err
	}
	switch in.Choice {
	case "keep_server", "use_candidate":
		if in.Event != nil || in.FinalPosition.Value != nil {
			return wire.CompletionState{}, apperr.Validation("event and finalPosition must be null for this choice")
		}
	case "use_explicit":
		if in.Event == nil {
			return wire.CompletionState{}, apperr.Validation("event is required for use_explicit")
		}
		if err := checkEventShape(*in.Event, in.FinalPosition.Value); err != nil {
			return wire.CompletionState{}, err
		}
	default:
		return wire.CompletionState{}, apperr.Validation("unknown choice")
	}
	if _, err := s.cat.Authorize(ctx, a.UserID, recID); err != nil {
		return wire.CompletionState{}, err
	}
	var fpFinal any
	if in.FinalPosition.Value != nil {
		fpFinal = *in.FinalPosition.Value
	}
	fp := fingerprint("resolve_completion", map[string]any{"conflict": conflictID, "choice": in.Choice, "base": base, "layout": layout,
		"event": in.Event, "captured": captured.Format(time.RFC3339Nano), "final": fpFinal})

	body, err := s.run(ctx, a, recID, op, "resolve_completion", fp, lockCompletion(ctx, a, recID),
		func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
			now := s.now()
			c, err := q.GetConflictForUpdate(ctx, sqlcgen.GetConflictForUpdateParams{ID: conflictID, UserID: a.UserID, RecordingID: recID})
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && c.Kind != "completion") {
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
			cur, err := q.LockCompletionState(ctx, sqlcgen.LockCompletionStateParams{UserID: a.UserID, RecordingID: recID})
			if err != nil {
				return nil, nil, err
			}
			curView, err := completionState(ctx, q, a.UserID, recID)
			if err != nil {
				return nil, nil, err
			}
			if base > cur.Revision {
				return nil, nil, apperr.Validation("baseRevision is ahead of the server revision")
			}
			if base != cur.Revision {
				return nil, completionConflictProblem(c.ID, curView, "The completion state changed while choosing; the conflict is still unresolved."), nil
			}
			if layout != rec.LayoutRevision {
				return nil, problemFor(anchorLayoutChanged, c.ID, rec.LayoutRevision), nil
			}
			files, err := q.ListRecordingFiles(ctx, []uuid.UUID{recID})
			if err != nil {
				return nil, nil, err
			}
			event, evCaptured := "", captured
			var final *wire.Anchor
			switch in.Choice {
			case "use_candidate":
				var cand wire.CompletionWrite
				if err := json.Unmarshal(c.Candidate, &cand); err != nil {
					return nil, nil, err
				}
				event, final = cand.Event, cand.FinalPosition.Value
				if t, err := time.Parse(time.RFC3339Nano, cand.CapturedAt); err == nil {
					evCaptured = t.UTC()
				}
			case "use_explicit":
				event, final = *in.Event, in.FinalPosition.Value
			}
			if final != nil {
				problem, perr, err := validateTerminal(ctx, q, files, true, final)
				if err != nil {
					return nil, nil, err
				}
				if perr != nil {
					return nil, nil, perr
				}
				if problem == anchorContentChanged {
					return nil, problemFor(problem, c.ID, rec.LayoutRevision), nil
				}
			}
			var st wire.CompletionState
			if event == "" { // keep_server: bump the revision so stale clients re-sync, state unchanged
				if err := q.SetCompletionState(ctx, sqlcgen.SetCompletionStateParams{UserID: a.UserID, RecordingID: recID,
					Revision: cur.Revision + 1, Finished: cur.Finished, ChangedAt: cur.ChangedAt}); err != nil {
					return nil, nil, err
				}
				if st, err = completionState(ctx, q, a.UserID, recID); err != nil {
					return nil, nil, err
				}
			} else {
				if st, err = s.applyEvent(ctx, q, a, rec, op, cur, event, evCaptured, true); err != nil {
					return nil, nil, err
				}
			}
			if err := q.ResolveConflictRow(ctx, sqlcgen.ResolveConflictRowParams{ID: c.ID, ResolvedAt: &now, ResolvedOperationID: uuid.NullUUID{UUID: op, Valid: true}}); err != nil {
				return nil, nil, err
			}
			return wire.Raw(st), nil, nil
		})
	if err != nil {
		return wire.CompletionState{}, err
	}
	var st wire.CompletionState
	return st, json.Unmarshal(body, &st)
}

var _ = strconv.Itoa
