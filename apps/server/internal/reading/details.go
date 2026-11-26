package reading

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Descriptive book details and personal rating, review and reading dates (ADR-0081).

// EditionDetails returns the effective descriptive fields of an edition the caller may see.
func (s *Service) EditionDetails(ctx context.Context, userID, editionID uuid.UUID) (wire.EditionDetails, error) {
	ed, err := s.cat.AuthorizeEdition(ctx, userID, editionID)
	if err != nil {
		return wire.EditionDetails{}, err
	}
	rep, err := s.report(ctx, s.q, ed.ID, ed.Revision)
	if err != nil {
		return wire.EditionDetails{}, err
	}
	created, err := s.q.GetEditionCreatedAt(ctx, ed.ID)
	if err != nil {
		return wire.EditionDetails{}, dbErr(err)
	}
	out := wire.EditionDetails{EditionID: ed.ID.String(), AddedAt: rfc(created)}
	for _, f := range rep.Fields {
		if f.Cleared || len(f.Value.Raw) == 0 || string(f.Value.Raw) == "null" {
			continue
		}
		switch f.Field {
		case "publisher":
			out.Publisher = jsonString(f.Value.Raw)
		case "published":
			out.Published = jsonString(f.Value.Raw)
		case "isbn":
			out.ISBN = jsonString(f.Value.Raw)
		case "description":
			out.Description = jsonString(f.Value.Raw)
		case "page_count":
			var n int64
			if json.Unmarshal(f.Value.Raw, &n) == nil {
				out.PageCount = &n
			}
		}
	}
	return out, nil
}

func jsonString(raw []byte) *string {
	var v string
	if json.Unmarshal(raw, &v) != nil || v == "" {
		return nil
	}
	return &v
}

func personalKey(userID, titleID uuid.UUID) string {
	return "personal:" + userID.String() + ":" + titleID.String()
}

var epoch = time.Unix(0, 0)

func timePtr(t time.Time) *string {
	if !t.After(epoch) {
		return nil
	}
	v := rfc(t)
	return &v
}

func personalWire(titleID uuid.UUID, row *sqlcgen.TitlePersonal, started, finished time.Time) wire.TitlePersonal {
	out := wire.TitlePersonal{TitleID: titleID.String(), Revision: "0", DerivedStartedAt: timePtr(started), DerivedFinishedAt: timePtr(finished)}
	if row == nil {
		return out
	}
	out.Revision = strconv.FormatInt(row.Revision, 10)
	if row.RatingHalves != nil {
		v := int64(*row.RatingHalves)
		out.Data.RatingHalves = &v
	}
	if row.Review != nil {
		out.Data.Review = *row.Review
	}
	if row.StartedAt != nil {
		v := rfc(*row.StartedAt)
		out.Data.StartedAt = &v
	}
	if row.FinishedAt != nil {
		v := rfc(*row.FinishedAt)
		out.Data.FinishedAt = &v
	}
	u := rfc(row.UpdatedAt)
	out.UpdatedAt = &u
	return out
}

// TitlePersonal returns the caller's own rating, review and dates for a visible title. Nobody else's are ever returned.
func (s *Service) TitlePersonal(ctx context.Context, userID, titleID uuid.UUID) (wire.TitlePersonal, error) {
	if err := s.cat.TitleVisible(ctx, userID, titleID); err != nil {
		return wire.TitlePersonal{}, err
	}
	return s.personalRead(ctx, s.q, userID, titleID)
}

func (s *Service) personalRead(ctx context.Context, q *sqlcgen.Queries, userID, titleID uuid.UUID) (wire.TitlePersonal, error) {
	d, err := q.DerivedTitleDates(ctx, sqlcgen.DerivedTitleDatesParams{UserID: userID, TitleID: titleID})
	if err != nil {
		return wire.TitlePersonal{}, dbErr(err)
	}
	row, err := q.GetTitlePersonal(ctx, sqlcgen.GetTitlePersonalParams{UserID: userID, TitleID: titleID})
	if errors.Is(err, pgx.ErrNoRows) {
		return personalWire(titleID, nil, d.StartedAt, d.FinishedAt), nil
	}
	if err != nil {
		return wire.TitlePersonal{}, dbErr(err)
	}
	return personalWire(titleID, &row, d.StartedAt, d.FinishedAt), nil
}

func parseOptTime(field string, v *string) (*time.Time, error) {
	if v == nil {
		return nil, nil
	}
	t, err := parseTime(field, *v)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// PutTitlePersonal replaces the caller's rating, review and date overrides at the stated revision. Replays of the same
// operation return the first answer; a stale base is refused with the current revision and changes nothing.
func (s *Service) PutTitlePersonal(ctx context.Context, a Actor, titleID uuid.UUID, w wire.TitlePersonalWrite) (wire.TitlePersonal, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.TitlePersonal{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.TitlePersonal{}, err
	}
	if _, err = parseTime("capturedAt", w.CapturedAt); err != nil {
		return wire.TitlePersonal{}, err
	}
	d := w.Data
	if d.RatingHalves != nil && (*d.RatingHalves < 1 || *d.RatingHalves > 10) {
		return wire.TitlePersonal{}, apperr.Validation("data.ratingHalves must be 1 to 10 half stars, or null.")
	}
	if len([]rune(d.Review)) > 20000 {
		return wire.TitlePersonal{}, apperr.Validation("data.review is limited to 20000 characters.")
	}
	started, err := parseOptTime("data.startedAt", d.StartedAt)
	if err != nil {
		return wire.TitlePersonal{}, err
	}
	finished, err := parseOptTime("data.finishedAt", d.FinishedAt)
	if err != nil {
		return wire.TitlePersonal{}, err
	}
	if started != nil && finished != nil && finished.Before(*started) {
		return wire.TitlePersonal{}, apperr.Validation("data.finishedAt cannot be before data.startedAt.")
	}
	// Authorization precedes any receipt so a denied request leaves no trace.
	if err := s.cat.TitleVisible(ctx, a.UserID, titleID); err != nil {
		return wire.TitlePersonal{}, err
	}
	var review *string
	if strings.TrimSpace(d.Review) != "" {
		review = &d.Review
	}
	var rating *int16
	if d.RatingHalves != nil {
		v := int16(*d.RatingHalves)
		rating = &v
	}
	fp := fingerprint(http.MethodPut, "/titles/"+titleID.String()+"/personal", w)
	body, err := s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error {
		return q.LockPersonalKey(ctx, personalKey(a.UserID, titleID))
	}, func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		cur, err := q.GetTitlePersonal(ctx, sqlcgen.GetTitlePersonalParams{UserID: a.UserID, TitleID: titleID})
		exists := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, err
		}
		var currentRev int64
		if exists {
			currentRev = cur.Revision
		}
		if base != currentRev {
			return nil, apperr.New(http.StatusConflict, "stale_revision", "The base revision is not current; reload and try again.").
				With("currentRevision", strconv.FormatInt(currentRev, 10)), nil
		}
		now := s.now()
		if exists {
			err = q.UpdateTitlePersonal(ctx, sqlcgen.UpdateTitlePersonalParams{UserID: a.UserID, TitleID: titleID, RatingHalves: rating, Review: review,
				StartedAt: started, FinishedAt: finished, UpdatedAt: now})
		} else {
			err = q.InsertTitlePersonal(ctx, sqlcgen.InsertTitlePersonalParams{UserID: a.UserID, TitleID: titleID, RatingHalves: rating, Review: review,
				StartedAt: started, FinishedAt: finished, UpdatedAt: now})
		}
		if err != nil {
			return nil, nil, err
		}
		out, err := s.personalRead(ctx, q, a.UserID, titleID)
		if err != nil {
			return nil, nil, err
		}
		return wire.Raw(out), nil, nil
	})
	if err != nil {
		return wire.TitlePersonal{}, err
	}
	var out wire.TitlePersonal
	return out, json.Unmarshal(body, &out)
}

// RecordingDetails returns the effective descriptive fields of a recording the caller may see.
func (s *Service) RecordingDetails(ctx context.Context, userID, recordingID uuid.UUID) (wire.RecordingDetails, error) {
	rec, err := s.cat.Authorize(ctx, userID, recordingID)
	if err != nil {
		return wire.RecordingDetails{}, err
	}
	created, err := s.q.GetRecordingCreatedAt(ctx, rec.ID)
	if err != nil {
		return wire.RecordingDetails{}, dbErr(err)
	}
	eff, err := metadata.EffectiveForTitle(ctx, s.q, rec.TitleID)
	if err != nil {
		return wire.RecordingDetails{}, dbErr(err)
	}
	out := wire.RecordingDetails{RecordingID: rec.ID.String(), AddedAt: rfc(created)}
	text := func(k string) *string {
		if e, ok := eff[k]; ok && !e.Cleared {
			return jsonString(e.Raw)
		}
		return nil
	}
	out.Publisher, out.Published = text(metadata.FieldPublisher), text(metadata.FieldPublished)
	out.ISBN, out.Description = text(metadata.FieldISBN), text(metadata.FieldDescription)
	return out, nil
}
