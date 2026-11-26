package httpapi_test

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// shelf-concurrency: two tabs reorder and remove at one shelf revision while one member is hidden by a
// revoked grant. Exactly one write wins, every loser keeps a durable 409 candidate, a retry of any request
// (same operation ID) replays its original answer instead of acting twice, and the hidden member is neither
// exposed nor lost (ADR-0066).
func TestShelfReorderAndRemoveRacesWithAHiddenMember(t *testing.T) {
	r := newReadingEnv(t)
	e := r.e
	root2, _ := filepath.Abs(filepath.Join(e.Cfg.MediaRoot, "ebooks-race"))
	_ = os.MkdirAll(root2, 0o755)
	var d2 wire.LibraryDetail
	cl := e.Do("POST", "/admin/libraries", r.admin, map[string]any{"name": "Race library", "config": map[string]any{
		"mode": "managed", "rootPath": root2, "followSymlinks": false, "writebackBackups": false, "providerOrder": []string{}}})
	cl.JSON(t, &d2)
	if cl.StatusCode != http.StatusCreated {
		t.Fatalf("second library: %d %s", cl.StatusCode, cl.Body)
	}
	for _, id := range []string{e.Fix.AdminID.String(), e.Fix.UserAID.String()} {
		if x := e.Do("PUT", "/admin/users/"+id+"/libraries/"+d2.Library.ID, r.admin, nil); x.StatusCode != http.StatusNoContent {
			t.Fatalf("grant: %d", x.StatusCode)
		}
	}
	epub(t, filepath.Join(r.root, "Saga", "vol3.epub"), "Third Tale", "Bob Writer", "978-0-306-40615-7")
	epub(t, filepath.Join(root2, "Other", "other.epub"), "Fourth Folio", "Cy Scribe", "978-3-16-148410-0")
	scanTwice(t, e, r.admin, r.lib)
	scanTwice(t, e, r.admin, d2.Library.ID)
	var titles wire.Titles
	e.Do("GET", "/titles", r.userA, nil).JSON(t, &titles)
	byName := map[string]string{}
	for _, x := range titles.Items {
		byName[x.Title] = x.ID
	}
	t2, t3, t4 := byName["Second Volume"], byName["Third Tale"], byName["Fourth Folio"]
	if t2 == "" || t3 == "" || t4 == "" {
		t.Fatalf("titles: %+v", byName)
	}

	sid := uuid.NewString()
	var sh wire.Shelf
	e.Do("PUT", "/shelves/"+sid, r.userA, r.shelfBody(uuid.NewString(), "0", "manual", "private", "Races", nil)).JSON(t, &sh)
	for i, tt := range []string{t2, t3, t4} {
		x := e.Do("PUT", "/shelves/"+sid+"/titles/"+tt, r.userA, delBody(uuid.NewString(), string(rune('1'+i))))
		if x.StatusCode != 200 {
			t.Fatalf("add %d: %d %s", i, x.StatusCode, x.Body)
		}
	}
	// The fourth title's library is revoked: it stays on the shelf but is hidden from its owner.
	if x := e.Do("DELETE", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+d2.Library.ID, r.admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke: %d", x.StatusCode)
	}
	e.Do("GET", "/shelves/"+sid, r.userA, nil).JSON(t, &sh)
	base := sh.Revision

	type req struct {
		name, method, path string
		body               map[string]any
	}
	order := map[string]any{"operationId": uuid.NewString(), "baseRevision": base, "visibleTitleIds": []string{t3, t2}, "capturedAt": "2026-11-14T10:00:00Z"}
	reqs := []req{
		{"reorder", "PUT", "/shelves/" + sid + "/order", order},
		{"remove second", "DELETE", "/shelves/" + sid + "/titles/" + t2, delBody(uuid.NewString(), base)},
		{"remove third", "DELETE", "/shelves/" + sid + "/titles/" + t3, delBody(uuid.NewString(), base)},
	}
	res := make([]apitest.Response, len(reqs))
	var wg sync.WaitGroup
	for i := range reqs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			res[i] = e.Do(reqs[i].method, reqs[i].path, r.userA, reqs[i].body)
		}(i)
	}
	wg.Wait()
	winner, losers := -1, []int{}
	for i, x := range res {
		switch {
		case x.StatusCode == 200 && winner < 0:
			winner = i
		case x.StatusCode == 409 && problemMap(t, x)["code"] == "stale_revision":
			losers = append(losers, i)
		default:
			t.Fatalf("%s: unexpected %d %s", reqs[i].name, x.StatusCode, x.Body)
		}
	}
	if winner < 0 || len(losers) != len(reqs)-1 {
		t.Fatalf("expected exactly one winner and %d stale losers: %v", len(reqs)-1, statuses(res))
	}
	e.Do("GET", "/shelves/"+sid, r.userA, nil).JSON(t, &sh)
	if sh.Revision == base {
		t.Fatal("the winner did not spend a revision")
	}
	afterRace := sh.Revision

	// Every loser keeps exactly one durable candidate; none leaks the hidden title.
	var cs wire.PersonalConflicts
	e.Do("GET", "/personal-conflicts?resourceId="+sid, r.userA, nil).JSON(t, &cs)
	if len(cs.Items) != len(losers) {
		t.Fatalf("durable conflicts: %d, want %d", len(cs.Items), len(losers))
	}
	for _, c := range cs.Items {
		if raw, _ := json.Marshal(c); strings.Contains(string(raw), t4) {
			t.Fatalf("a conflict exposes the hidden title: %s", raw)
		}
	}

	// Retries replay: the winner again, and a loser again, with the same operation IDs.
	again := e.Do(reqs[winner].method, reqs[winner].path, r.userA, reqs[winner].body)
	if again.StatusCode != 200 {
		t.Fatalf("winner replay: %d %s", again.StatusCode, again.Body)
	}
	lr := e.Do(reqs[losers[0]].method, reqs[losers[0]].path, r.userA, reqs[losers[0]].body)
	if lr.StatusCode != 409 {
		t.Fatalf("loser replay: %d %s", lr.StatusCode, lr.Body)
	}
	e.Do("GET", "/shelves/"+sid, r.userA, nil).JSON(t, &sh)
	if sh.Revision != afterRace {
		t.Fatalf("a replay spent a revision: %s -> %s", afterRace, sh.Revision)
	}
	var cs2 wire.PersonalConflicts
	e.Do("GET", "/personal-conflicts?resourceId="+sid, r.userA, nil).JSON(t, &cs2)
	if len(cs2.Items) != len(cs.Items) {
		t.Fatalf("a replay duplicated a conflict: %d -> %d", len(cs.Items), len(cs2.Items))
	}

	// The hidden member is neither exposed nor lost: regranting shows it exactly once.
	for _, x := range r.shelfTitles(t, r.userA, sid).Items {
		if x.ID == t4 {
			t.Fatal("hidden title visible to its owner")
		}
	}
	if x := e.Do("PUT", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+d2.Library.ID, r.admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("regrant: %d", x.StatusCode)
	}
	count := 0
	for _, x := range r.shelfTitles(t, r.userA, sid).Items {
		if x.ID == t4 {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("the hidden member appears %d times after regrant, want exactly once", count)
	}
}

func statuses(rs []apitest.Response) []int {
	out := make([]int, len(rs))
	for i, x := range rs {
		out[i] = x.StatusCode
	}
	return out
}
