package reading

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
)

func row(at time.Time, secs int32, title uuid.UUID) sqlcgen.ListReadingSessionsForStatsRow {
	return sqlcgen.ListReadingSessionsForStatsRow{StartedAt: at, ActiveSeconds: secs, TitleID: title}
}

// ADR-0098: days are local to the reader, a reading day needs 5 minutes summed over the day, and streaks count runs.
func TestSummarizeDaysThresholdAndStreaks(t *testing.T) {
	loc, _ := time.LoadLocation("America/New_York")
	d := func(m time.Month, dd, h, mi int) time.Time { return time.Date(2026, m, dd, h, mi, 0, 0, loc) }
	start, end := d(3, 1, 0, 0), d(3, 20, 0, 0)
	a, b := uuid.New(), uuid.New()
	rows := []sqlcgen.ListReadingSessionsForStatsRow{
		// 23:50 local on 1 March is already 2 March in UTC; it counts on 1 March.
		row(d(3, 1, 23, 50), 400, a),
		// 2 March: two short sessions that only together reach 5 minutes.
		row(d(3, 2, 9, 0), 200, a), row(d(3, 2, 21, 0), 100, b),
		// 3 March: under the threshold, so it breaks the streak but is still shown.
		row(d(3, 3, 12, 0), 299, a),
		// 7-9 March across the start of daylight saving time (8 March 2026 in New York).
		row(d(3, 7, 10, 0), 600, a), row(d(3, 8, 10, 0), 600, a), row(d(3, 9, 10, 0), 600, a),
		// 19 and 20 March: a run ending today.
		row(d(3, 19, 8, 0), 300, b), row(d(3, 20, 8, 0), 300, b),
	}
	st := summarize(rows, loc, start, end, d(3, 20, 0, 0), "America/New_York")
	if len(st.Days) != 8 || st.Days[0].Date != "2026-03-01" || st.Days[0].ActiveSeconds != 400 {
		t.Fatalf("days: %+v", st.Days)
	}
	if st.Days[1].Date != "2026-03-02" || st.Days[1].Sessions != 2 || !st.Days[1].ReadingDay || st.Days[2].ReadingDay {
		t.Fatalf("threshold: %+v", st.Days[1:3])
	}
	if st.Days[3].Date != "2026-03-07" || st.Days[4].Date != "2026-03-08" || st.Days[5].Date != "2026-03-09" {
		t.Fatalf("DST days: %+v", st.Days[3:6])
	}
	if st.ReadingDays != 7 || st.Sessions != 9 || st.Books != 2 || st.ActiveSeconds != 3399 {
		t.Fatalf("totals: %+v", st)
	}
	if st.LongestStreak != 3 || st.CurrentStreak != 2 {
		t.Fatalf("streaks: longest %d current %d", st.LongestStreak, st.CurrentStreak)
	}
	// Nothing yet today: the streak ending yesterday still counts.
	if st := summarize(rows[:len(rows)-1], loc, start, end, d(3, 20, 0, 0), ""); st.CurrentStreak != 1 {
		t.Fatalf("through yesterday: %d", st.CurrentStreak)
	}
	// A day without reading in between breaks it.
	if st := summarize(rows, loc, start, end, d(3, 22, 0, 0), ""); st.CurrentStreak != 0 {
		t.Fatalf("after a gap: %d", st.CurrentStreak)
	}
}
