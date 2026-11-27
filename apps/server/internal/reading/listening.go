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

// PutListeningSession stores or extends one listening session of the caller's (ADR-0109). The recording must be one the
// caller can still open; a recording that repair has since replaced still accepts what was heard of it, because a
// device may send a session long after it happened.
func (s *Service) PutListeningSession(ctx context.Context, userID, recordingID, sessionID uuid.UUID, w wire.ListeningSessionWrite) error {
	if sessionID == uuid.Nil {
		return apperr.Validation("sessionId must be a UUID.")
	}
	start, end, err := s.sessionWindow(w.StartedAt, w.EndedAt, w.ListenedSeconds, "listenedSeconds")
	if err != nil {
		return err
	}
	if _, err := s.cat.Authorize(ctx, userID, recordingID); err != nil {
		return err
	}
	n, err := s.q.UpsertListeningSession(ctx, sqlcgen.UpsertListeningSessionParams{
		UserID: userID, ID: sessionID, RecordingID: recordingID, StartedAt: start, EndedAt: end,
		ListenedSeconds: int32(w.ListenedSeconds), StartFraction: f32(w.StartFraction), EndFraction: f32(w.EndFraction),
	})
	if err != nil {
		return dbErr(err)
	}
	if n == 0 { // the caller already used this id for another recording, which is left alone
		return apperr.New(http.StatusConflict, "session_recording_mismatch", "This session id is already used for another recording; send a new id.")
	}
	return nil
}

// ListeningSessions lists the caller's own listening for a title they can see, newest first.
func (s *Service) ListeningSessions(ctx context.Context, userID, titleID uuid.UUID, page, size int) (wire.ListeningSessions, error) {
	if err := s.cat.TitleVisible(ctx, userID, titleID); err != nil {
		return wire.ListeningSessions{}, err
	}
	rows, err := s.q.ListListeningSessionsForTitle(ctx, sqlcgen.ListListeningSessionsForTitleParams{UserID: userID, TitleID: titleID, Limit: int32(size), Offset: int32(page * size)})
	if err != nil {
		return wire.ListeningSessions{}, dbErr(err)
	}
	total, err := s.q.CountListeningSessionsForTitle(ctx, sqlcgen.CountListeningSessionsForTitleParams{UserID: userID, TitleID: titleID})
	if err != nil {
		return wire.ListeningSessions{}, dbErr(err)
	}
	out := wire.ListeningSessions{Items: []wire.ListeningSession{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, r := range rows {
		out.Items = append(out.Items, wire.ListeningSession{ID: r.ID.String(), RecordingID: r.RecordingID.String(), TitleID: r.TitleID.String(),
			StartedAt: rfc(r.StartedAt), EndedAt: rfc(r.EndedAt), ListenedSeconds: int64(r.ListenedSeconds), StartFraction: f64(r.StartFraction), EndFraction: f64(r.EndFraction)})
	}
	return out, nil
}

// sessionWindow checks the times and counted seconds shared by reading and listening sessions.
func (s *Service) sessionWindow(startedAt, endedAt string, seconds int64, field string) (time.Time, time.Time, error) {
	var zero time.Time
	start, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return zero, zero, apperr.Validation("startedAt must be an RFC 3339 time.")
	}
	end, err := time.Parse(time.RFC3339, endedAt)
	if err != nil {
		return zero, zero, apperr.Validation("endedAt must be an RFC 3339 time.")
	}
	switch {
	case end.Before(start):
		return zero, zero, apperr.Validation("endedAt must not be before startedAt.")
	case end.Sub(start) > maxSessionWindow:
		return zero, zero, apperr.Validation("a session spans at most 24 hours.")
	case end.After(s.now().Add(10 * time.Minute)):
		return zero, zero, apperr.Validation("endedAt is in the future.")
	case time.Duration(seconds)*time.Second > end.Sub(start)+time.Minute:
		return zero, zero, apperr.Validation(field + " cannot exceed the length of the session.")
	}
	return start.UTC(), end.UTC(), nil
}
