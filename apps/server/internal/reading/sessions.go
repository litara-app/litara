package reading

import (
	"context"
	"net/http"
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
// still read. The same id may be sent any number of times; the stored session never gets shorter. An id the caller
// already used for another edition is refused with 409 session_edition_mismatch.
func (s *Service) PutSession(ctx context.Context, userID, editionID, sessionID uuid.UUID, w wire.ReadingSessionWrite) error {
	if sessionID == uuid.Nil {
		return apperr.Validation("sessionId must be a UUID.")
	}
	start, end, err := s.sessionWindow(w.StartedAt, w.EndedAt, w.ActiveSeconds, "activeSeconds")
	if err != nil {
		return err
	}
	if _, err := s.cat.Edition(ctx, userID, editionID); err != nil {
		return err
	}
	n, err := s.q.UpsertReadingSession(ctx, sqlcgen.UpsertReadingSessionParams{
		UserID: userID, ID: sessionID, EditionID: editionID, StartedAt: start, EndedAt: end,
		ActiveSeconds: int32(w.ActiveSeconds), StartFraction: f32(w.StartFraction), EndFraction: f32(w.EndFraction),
	})
	if err != nil {
		return dbErr(err)
	}
	if n == 0 { // the caller already used this id for another edition, which is left alone
		return apperr.New(http.StatusConflict, "session_edition_mismatch", "This session id is already used for another edition; send a new id.")
	}
	return nil
}

// Sessions lists the caller's own sessions for a title they can see, newest first.
func (s *Service) Sessions(ctx context.Context, userID, titleID uuid.UUID, page, size int) (wire.ReadingSessions, error) {
	if err := s.cat.TitleVisible(ctx, userID, titleID); err != nil {
		return wire.ReadingSessions{}, err
	}
	rows, err := s.q.ListReadingSessionsForTitle(ctx, sqlcgen.ListReadingSessionsForTitleParams{UserID: userID, TitleID: titleID, Limit: int32(size), Offset: int32(page * size)})
	if err != nil {
		return wire.ReadingSessions{}, dbErr(err)
	}
	total, err := s.q.CountReadingSessionsForTitle(ctx, sqlcgen.CountReadingSessionsForTitleParams{UserID: userID, TitleID: titleID})
	if err != nil {
		return wire.ReadingSessions{}, dbErr(err)
	}
	out := wire.ReadingSessions{Items: []wire.ReadingSession{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, r := range rows {
		out.Items = append(out.Items, wire.ReadingSession{ID: r.ID.String(), EditionID: r.EditionID.String(), TitleID: r.TitleID.String(),
			StartedAt: rfc(r.StartedAt), EndedAt: rfc(r.EndedAt), ActiveSeconds: int64(r.ActiveSeconds), StartFraction: f64(r.StartFraction), EndFraction: f64(r.EndFraction)})
	}
	return out, nil
}
