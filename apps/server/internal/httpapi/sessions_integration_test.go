package httpapi_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// ADR-0092: reading sessions are idempotent upserts that never shrink, are private to their account, and need a readable edition.
func TestReadingSessionsAreExtendedNotShrunkAndPrivateToTheirAccount(t *testing.T) {
	r := newReadingEnv(t)
	e := r.e
	id := uuid.NewString()
	now := e.Clock.Now().UTC().Truncate(time.Second)
	body := func(end time.Time, active int, endFrac float64) map[string]any {
		return map[string]any{"startedAt": now.Add(-10 * time.Minute).Format(time.RFC3339), "endedAt": end.Format(time.RFC3339), "activeSeconds": active, "startFraction": 0.1, "endFraction": endFrac}
	}
	put := func(token string, sid string, b map[string]any) apitest.Response {
		return apitest.Response(e.Do("PUT", "/editions/"+r.ed.ID+"/reading-sessions/"+sid, token, b))
	}

	if x := put(r.userA, id, body(now.Add(-5*time.Minute), 300, 0.2)); x.StatusCode != http.StatusNoContent && x.StatusCode != http.StatusOK {
		t.Fatalf("first send: %d %s", x.StatusCode, x.Body)
	}
	// A longer send extends it; an older, shorter one arriving later does not shrink it.
	put(r.userA, id, body(now, 540, 0.3))
	put(r.userA, id, body(now.Add(-5*time.Minute), 300, 0.2))

	var list wire.T005ReadingSessions
	e.Do("GET", "/titles/"+r.ed.TitleID+"/reading-sessions", r.userA, nil).JSON(t, &list)
	if list.Total != 1 || len(list.Items) != 1 {
		t.Fatalf("one session expected: %+v", list)
	}
	s := list.Items[0]
	if s.ID != id || s.ActiveSeconds != 540 || s.EndedAt[:19] != now.Format("2006-01-02T15:04:05") || s.EndFraction == nil || *s.EndFraction < 0.29 || *s.EndFraction > 0.31 {
		t.Fatalf("a session must keep its longest active time and latest end: %+v", s)
	}

	// Sanity limits.
	if x := put(r.userA, uuid.NewString(), body(now.Add(48*time.Hour), 10, 0.5)); x.StatusCode < 400 {
		t.Fatalf("a session in the future must be refused: %d", x.StatusCode)
	}
	if x := put(r.userA, uuid.NewString(), body(now, 5000, 0.5)); x.StatusCode < 400 {
		t.Fatalf("more active time than the window must be refused: %d", x.StatusCode)
	}

	// Private: the administrator and another account see none of it, and cannot add to someone else's session id.
	var adminList wire.T005ReadingSessions
	if x := e.Do("GET", "/titles/"+r.ed.TitleID+"/reading-sessions", r.admin, nil); x.StatusCode == http.StatusOK {
		x.JSON(t, &adminList)
		if len(adminList.Items) != 0 {
			t.Fatalf("another account saw a reading session: %+v", adminList)
		}
	}
	if x := put(r.userB, id, body(now, 9999, 0.9)); x.StatusCode < 400 {
		var again wire.T005ReadingSessions
		e.Do("GET", "/titles/"+r.ed.TitleID+"/reading-sessions", r.userA, nil).JSON(t, &again)
		if len(again.Items) != 1 || again.Items[0].ActiveSeconds != 540 {
			t.Fatalf("another account changed a session: %+v", again)
		}
	}
	// A bad edition is not found.
	if x := e.Do("PUT", "/editions/"+uuid.NewString()+"/reading-sessions/"+uuid.NewString(), r.userA, body(now, 10, 0.5)); x.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown edition: %d", x.StatusCode)
	}
}
