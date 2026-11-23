package reading

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

const maxSessionWindow = 24 * time.Hour

func f32(p *float64) *float32 {
	if p == nil {
		return nil
	}
	v := float32(*p)
	return &v
}

func f64(v *float32) *float64 {
	if v == nil {
		return nil
	}
	x := float64(*v)
	return &x
}

// PutSession stores or extends one reading session of the caller's (ADR-0092). The edition must be one the caller can
// still read. The same id may be sent any number of times; the stored session never gets shorter.
func (s *Service) PutSession(ctx context.Context, userID, editionID, sessionID uuid.UUID, w wire.T005ReadingSessionWrite) error {
	if sessionID == uuid.Nil {
		return apperr.Validation("sessionId must be a UUID.")
	}
	start, err := time.Parse(time.RFC3339, w.StartedAt)
	if err != nil {
		return apperr.Validation("startedAt must be an RFC 3339 time.")
	}
	end, err := time.Parse(time.RFC3339, w.EndedAt)
	if err != nil {
		return apperr.Validation("endedAt must be an RFC 3339 time.")
	}
	now := s.now()
	switch {
	case end.Before(start):
		return apperr.Validation("endedAt must not be before startedAt.")
	case end.Sub(start) > maxSessionWindow:
		return apperr.Validation("a session spans at most 24 hours.")
	case end.After(now.Add(10 * time.Minute)):
		return apperr.Validation("endedAt is in the future.")
	case time.Duration(w.ActiveSeconds)*time.Second > end.Sub(start)+time.Minute:
		return apperr.Validation("activeSeconds cannot exceed the length of the session.")
	}
	if _, err := s.cat.Edition(ctx, userID, editionID); err != nil {
		return err
	}
	if err := s.q.UpsertReadingSession(ctx, sqlcgen.UpsertReadingSessionParams{
		UserID: userID, ID: sessionID, EditionID: editionID, StartedAt: start.UTC(), EndedAt: end.UTC(),
		ActiveSeconds: int32(w.ActiveSeconds), StartFraction: f32(w.StartFraction), EndFraction: f32(w.EndFraction),
	}); err != nil {
		return dbErr(err)
	}
	return nil
}

// Sessions lists the caller's own sessions for a title they can see, newest first.
func (s *Service) Sessions(ctx context.Context, userID, titleID uuid.UUID, page, size int) (wire.T005ReadingSessions, error) {
	if err := s.cat.TitleVisible(ctx, userID, titleID); err != nil {
		return wire.T005ReadingSessions{}, err
	}
	rows, err := s.q.ListReadingSessionsForTitle(ctx, sqlcgen.ListReadingSessionsForTitleParams{UserID: userID, TitleID: titleID, Limit: int32(size), Offset: int32(page * size)})
	if err != nil {
		return wire.T005ReadingSessions{}, dbErr(err)
	}
	total, err := s.q.CountReadingSessionsForTitle(ctx, sqlcgen.CountReadingSessionsForTitleParams{UserID: userID, TitleID: titleID})
	if err != nil {
		return wire.T005ReadingSessions{}, dbErr(err)
	}
	out := wire.T005ReadingSessions{Items: []wire.T005ReadingSession{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, r := range rows {
		out.Items = append(out.Items, wire.T005ReadingSession{ID: r.ID.String(), EditionID: r.EditionID.String(), TitleID: r.TitleID.String(),
			StartedAt: rfc(r.StartedAt), EndedAt: rfc(r.EndedAt), ActiveSeconds: int64(r.ActiveSeconds), StartFraction: f64(r.StartFraction), EndFraction: f64(r.EndFraction)})
	}
	return out, nil
}
