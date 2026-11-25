package reading

import (
	"context"
	"time"
	_ "time/tzdata" // stats group days in the reader's time zone, which must work on hosts without a zone database

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// ReadingDaySeconds is the active reading a day needs to count as a reading day (owner's choice, ADR-0098).
const ReadingDaySeconds = 5 * 60

// maxStatsDays bounds one stats request (ADR-0098).
const maxStatsDays = 366

const day = "2006-01-02"

// Stats summarizes the caller's own reading sessions that started on the local dates from..to (inclusive) in the
// given IANA time zone. A session counts on the local day it started (ADR-0098).
func (s *Service) Stats(ctx context.Context, userID uuid.UUID, from, to, timeZone string) (wire.ReadingStats, error) {
	loc, err := time.LoadLocation(timeZone)
	if err != nil || timeZone == "" || timeZone == "Local" {
		return wire.ReadingStats{}, apperr.Validation("timeZone must be an IANA time zone such as Europe/Berlin.")
	}
	start, err1 := time.ParseInLocation(day, from, loc)
	end, err2 := time.ParseInLocation(day, to, loc)
	if err1 != nil || err2 != nil {
		return wire.ReadingStats{}, apperr.Validation("from and to must be dates (YYYY-MM-DD).")
	}
	if end.Before(start) {
		return wire.ReadingStats{}, apperr.Validation("to must not be before from.")
	}
	if days := dayIndex(start, end) + 1; days > maxStatsDays {
		return wire.ReadingStats{}, apperr.Validation("a stats range covers at most 366 days.")
	}
	rows, err := s.q.ListReadingSessionsForStats(ctx, sqlcgen.ListReadingSessionsForStatsParams{
		UserID: userID, FromTime: start, ToTime: end.AddDate(0, 0, 1)})
	if err != nil {
		return wire.ReadingStats{}, dbErr(err)
	}
	today := s.now().In(loc)
	return summarize(rows, loc, start, end, time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, loc), timeZone), nil
}

// dayIndex is the number of calendar days from a to b, both local midnights; it is exact across DST changes.
func dayIndex(a, b time.Time) int {
	ua := time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, time.UTC)
	ub := time.Date(b.Year(), b.Month(), b.Day(), 0, 0, 0, 0, time.UTC)
	return int(ub.Sub(ua).Hours() / 24)
}

func summarize(rows []sqlcgen.ListReadingSessionsForStatsRow, loc *time.Location, start, end, today time.Time, tz string) wire.ReadingStats {
	out := wire.ReadingStats{From: start.Format(day), To: end.Format(day), TimeZone: tz, ReadingDaySeconds: ReadingDaySeconds, Days: []wire.ReadingStatsDay{}}
	n := dayIndex(start, end) + 1
	secs, count := make([]int64, n), make([]int64, n)
	books := map[uuid.UUID]bool{}
	for _, r := range rows {
		i := dayIndex(start, r.StartedAt.In(loc))
		if i < 0 || i >= n {
			continue
		}
		secs[i] += int64(r.ActiveSeconds)
		count[i]++
		books[r.TitleID] = true
		out.ActiveSeconds += int64(r.ActiveSeconds)
		out.Sessions++
	}
	out.Books = int64(len(books))
	run := int64(0)
	for i := 0; i < n; i++ {
		reading := secs[i] >= ReadingDaySeconds
		if count[i] > 0 {
			out.Days = append(out.Days, wire.ReadingStatsDay{Date: start.AddDate(0, 0, i).Format(day), ActiveSeconds: secs[i], Sessions: count[i], ReadingDay: reading})
		}
		if reading {
			out.ReadingDays++
			run++
			out.LongestStreak = max(out.LongestStreak, run)
		} else {
			run = 0
		}
	}
	// The current streak ends today, or yesterday when today has no reading day yet; a range that ends before
	// yesterday has none.
	last := dayIndex(start, today)
	if last >= n || last < 0 || secs[last] < ReadingDaySeconds {
		last--
	}
	for i := last; i >= 0 && i < n && secs[i] >= ReadingDaySeconds; i-- {
		out.CurrentStreak++
	}
	return out
}
