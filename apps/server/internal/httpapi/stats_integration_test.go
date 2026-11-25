package httpapi_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// ADR-0098: reading stats cover the caller's own sessions, by local day, on editions they can still see.
func TestReadingStatsArePrivateLocalAndFollowGrants(t *testing.T) {
	r := newReadingEnv(t)
	e := r.e
	insert := func(user uuid.UUID, at time.Time, secs int) {
		t.Helper()
		if _, err := e.Pool.Exec(t.Context(), `INSERT INTO reading_sessions (user_id, id, edition_id, started_at, ended_at, active_seconds)
			VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz + make_interval(secs => $5::int), $5::int)`, user, uuid.New(), r.ed.ID, at, secs); err != nil {
			t.Fatal(err)
		}
	}
	// 23:30 in Tokyo on 10 Nov is 14:30 UTC: it belongs to 10 Nov in Tokyo.
	tokyo, _ := time.LoadLocation("Asia/Tokyo")
	insert(e.Fix.UserAID, time.Date(2026, 11, 10, 23, 30, 0, 0, tokyo), 600)
	insert(e.Fix.UserAID, time.Date(2026, 11, 11, 8, 0, 0, 0, tokyo), 120) // under 5 minutes
	insert(e.Fix.UserBID, time.Date(2026, 11, 10, 12, 0, 0, 0, tokyo), 900) // another account

	get := func(token, q string) (wire.ReadingStats, int) {
		var st wire.ReadingStats
		resp := e.Do("GET", "/stats/reading?"+q, token, nil)
		if resp.StatusCode == http.StatusOK {
			resp.JSON(t, &st)
		}
		return st, resp.StatusCode
	}
	st, code := get(r.userA, "from=2026-11-01&to=2026-11-30&timeZone=Asia/Tokyo")
	if code != 200 || len(st.Days) != 2 || st.Days[0].Date != "2026-11-10" || st.Days[0].ActiveSeconds != 600 || !st.Days[0].ReadingDay || st.Days[1].ReadingDay {
		t.Fatalf("tokyo: %d %+v", code, st)
	}
	if st.Sessions != 2 || st.ReadingDays != 1 || st.Books != 1 || st.ReadingDaySeconds != 300 || st.TimeZone != "Asia/Tokyo" {
		t.Fatalf("totals: %+v", st)
	}
	// The same instant is 10 Nov in Los Angeles too, but the 08:00 Tokyo session is 10 Nov 15:00 there.
	if st, _ := get(r.userA, "from=2026-11-01&to=2026-11-30&timeZone=America/Los_Angeles"); len(st.Days) != 1 || st.Days[0].Date != "2026-11-10" || st.Days[0].Sessions != 2 {
		t.Fatalf("los angeles: %+v", st)
	}
	// Without a grant on the library, its sessions drop out.
	if resp := e.Do("DELETE", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+r.lib, r.admin, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke grant: %d %s", resp.StatusCode, resp.Body)
	}
	if st, _ := get(r.userA, "from=2026-11-01&to=2026-11-30&timeZone=Asia/Tokyo"); st.Sessions != 0 || len(st.Days) != 0 {
		t.Fatalf("after losing the grant: %+v", st)
	}
	for name, q := range map[string]string{
		"bad zone":   "from=2026-11-01&to=2026-11-30&timeZone=Mars/Olympus",
		"local zone": "from=2026-11-01&to=2026-11-30&timeZone=Local",
		"reversed":   "from=2026-11-30&to=2026-11-01&timeZone=UTC",
		"too long":   "from=2025-01-01&to=2026-01-02&timeZone=UTC",
		"no zone":    "from=2026-11-01&to=2026-11-30",
	} {
		if _, code := get(r.userA, q); code != http.StatusUnprocessableEntity {
			t.Fatalf("%s: %d", name, code)
		}
	}
	if _, code := get(r.userA, "from=2025-12-01&to=2026-11-30&timeZone=UTC"); code != 200 { // 365 days
		t.Fatalf("a year: %d", code)
	}
	if _, code := get("", "from=2026-11-01&to=2026-11-30&timeZone=UTC"); code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d", code)
	}
}
