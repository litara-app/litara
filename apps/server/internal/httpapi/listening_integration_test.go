package httpapi_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// ADR-0109: listening sessions are idempotent upserts that never shrink, private to their account, counted in
// wall-clock seconds, and counted toward reading days and streaks.
func TestListeningSessionsAreKeptPrivateAndCountTowardStreaks(t *testing.T) {
	e := apitest.New(t)
	a := e.Login(seed.UserAName, "phone").AccessToken
	b := e.Login(seed.UserBName, "tablet").AccessToken
	rec := snapshot(t, e, a, e.Fix.ThreeFile)
	now := e.Clock.Now().UTC().Truncate(time.Second)
	body := func(startAgo, endAgo time.Duration, seconds int) map[string]any {
		return map[string]any{"startedAt": now.Add(-startAgo).Format(time.RFC3339), "endedAt": now.Add(-endAgo).Format(time.RFC3339), "listenedSeconds": seconds, "startFraction": 0.1, "endFraction": 0.2}
	}
	put := func(token, recording, id string, v map[string]any) apitest.Response {
		return e.Do("PUT", "/recordings/"+recording+"/listening-sessions/"+id, token, v)
	}
	id := uuid.NewString()
	for _, v := range []map[string]any{body(10*time.Minute, 5*time.Minute, 200), body(10*time.Minute, 0, 400), body(10*time.Minute, 5*time.Minute, 200)} {
		if x := put(a, rec.ID, id, v); x.StatusCode != http.StatusNoContent {
			t.Fatalf("send: %d %s", x.StatusCode, x.Body)
		}
	}
	var list wire.ListeningSessions
	e.Do("GET", "/titles/"+rec.TitleID+"/listening-sessions", a, nil).JSON(t, &list)
	if list.Total != 1 || list.Items[0].ListenedSeconds != 400 || list.Items[0].RecordingID != rec.ID {
		t.Fatalf("a session keeps its longest listened time: %+v", list)
	}
	if x := put(a, rec.ID, uuid.NewString(), body(time.Minute, 0, 5000)); x.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("more listening than the window: %d", x.StatusCode)
	}
	other := e.Fix.Alternate.String()
	if x := put(a, other, id, body(10*time.Minute, 0, 100)); x.StatusCode != http.StatusConflict || x.Code() != "session_recording_mismatch" {
		t.Fatalf("id reused on another recording: %d %s", x.StatusCode, x.Body)
	}
	// A recording the account cannot see is refused.
	if x := put(b, rec.ID, uuid.NewString(), body(time.Minute, 0, 30)); x.StatusCode < 400 {
		t.Fatalf("no grant: %d", x.StatusCode)
	}

	// 400 seconds of listening alone reaches the 5-minute reading day; the reading-only fields stay reading-only.
	day := now.Add(-10 * time.Minute).Format("2006-01-02")
	var st wire.ReadingStats
	x := e.Do("GET", "/stats/reading?from="+day+"&to="+now.Format("2006-01-02")+"&timeZone=UTC", a, nil)
	status(t, x, 200, "")
	x.JSON(t, &st)
	if st.ListeningSeconds != 400 || st.ListeningSessions != 1 || st.ListenedBooks != 1 || st.ActiveSeconds != 0 || st.Sessions != 0 || len(st.Days) != 0 {
		t.Fatalf("totals: %+v", st)
	}
	if st.ReadingDays != 1 || st.CurrentStreak != 1 || len(st.Activity) != 1 || !st.Activity[0].ReadingDay || st.Activity[0].ListeningSeconds != 400 {
		t.Fatalf("listening must count toward the streak: %+v", st)
	}
}

type bookmarkCase struct {
	t   *testing.T
	e   *apitest.Env
	tok string
	rec wire.Recording
}

func (c bookmarkCase) data(file int, offset int64, note string) wire.AudioBookmarkData {
	f := c.rec.Files[file]
	return wire.AudioBookmarkData{FileID: f.ID, ContentVersion: f.ContentVersion, OffsetMs: offset, LayoutRevision: c.rec.LayoutRevision, Note: note}
}

func (c bookmarkCase) put(id, base string, d wire.AudioBookmarkData, op ...string) apitest.Response {
	operation := uuid.NewString()
	if len(op) > 0 {
		operation = op[0]
	}
	return c.e.Do("PUT", "/recordings/"+c.rec.ID+"/bookmarks/"+id, c.tok,
		wire.AudioBookmarkWrite{OperationID: operation, BaseRevision: base, Data: d, CapturedAt: "2026-11-13T12:00:00Z"})
}

func (c bookmarkCase) list(token string) wire.AudioBookmarks {
	x := c.e.Do("GET", "/recordings/"+c.rec.ID+"/bookmarks", token, nil)
	status(c.t, x, 200, "")
	var out wire.AudioBookmarks
	x.JSON(c.t, &out)
	return out
}

func (c bookmarkCase) conflicts() []wire.AudioBookmarkConflict {
	x := c.e.Do("GET", "/recordings/"+c.rec.ID+"/bookmark-conflicts", c.tok, nil)
	status(c.t, x, 200, "")
	var out wire.AudioBookmarkConflicts
	x.JSON(c.t, &out)
	return out.Items
}

func (c bookmarkCase) resolve(conflict, choice, base string) apitest.Response {
	return c.e.Do("POST", "/recordings/"+c.rec.ID+"/bookmark-conflicts/"+conflict+"/resolve", c.tok,
		wire.AudioBookmarkResolve{OperationID: uuid.NewString(), Choice: choice, BaseRevision: base})
}

// ADR-0110: bookmarks are private, replayable, keep every refused write, and never move a place.
func TestAudioBookmarksKeepRefusedWritesAndNeverMoveAPlace(t *testing.T) {
	e := apitest.New(t)
	tok := e.Login(seed.UserAName, "phone").AccessToken
	c := bookmarkCase{t: t, e: e, tok: tok, rec: snapshot(t, e, tok, e.Fix.ThreeFile)}

	id, op := uuid.NewString(), uuid.NewString()
	first := c.put(id, "0", c.data(1, 1000, "the good part"), op)
	status(t, first, 200, "")
	var made wire.AudioBookmark
	first.JSON(t, &made)
	if made.Revision != "1" || !made.Available || made.Data.Value == nil || made.Data.Value.Note != "the good part" {
		t.Fatalf("created: %s", first.Body)
	}
	if again := c.put(id, "0", c.data(1, 1000, "the good part"), op); again.StatusCode != 200 || string(again.Body) != string(first.Body) {
		t.Fatalf("replay: %d %s", again.StatusCode, again.Body)
	}
	if reused := c.put(id, "1", c.data(1, 2000, "different"), op); reused.StatusCode != http.StatusConflict {
		t.Fatalf("operation id reused: %d %s", reused.StatusCode, reused.Body)
	}

	// A stale write is kept, and applying it is the owner's choice against the revision they looked at.
	stale := c.put(id, "0", c.data(1, 1500, "from the other phone"))
	if stale.StatusCode != http.StatusConflict || stale.Code() != "stale_revision" {
		t.Fatalf("stale: %d %s", stale.StatusCode, stale.Body)
	}
	pending := c.conflicts()
	if len(pending) != 1 || pending[0].Candidate.Value == nil || pending[0].Candidate.Value.Note != "from the other phone" || pending[0].CurrentRevision != "1" {
		t.Fatalf("kept candidate: %+v", pending)
	}
	if x := c.resolve(pending[0].ID, "use_candidate", "0"); x.StatusCode != http.StatusConflict {
		t.Fatalf("outdated choice: %d %s", x.StatusCode, x.Body)
	}
	status(t, c.resolve(pending[0].ID, "use_candidate", "1"), http.StatusNoContent, "")
	if got := c.list(tok); got.Total != 1 || got.Items[0].Revision != "2" || got.Items[0].Data.Value.OffsetMs != 1500 || len(c.conflicts()) != 0 {
		t.Fatalf("applied: %+v", got)
	}

	// Private to the account that made it.
	admin := e.Login(seed.AdminName, "cli").AccessToken
	if x := e.Do("PUT", "/admin/users/"+e.Fix.UserBID.String()+"/libraries/"+e.Fix.Lib1.String(), admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d %s", x.StatusCode, x.Body)
	}
	other := e.Login(seed.UserBName, "tablet").AccessToken
	if got := c.list(other); got.Total != 0 {
		t.Fatalf("another account saw a bookmark: %+v", got)
	}

	// Delete leaves a tombstone that a stale write cannot revive.
	del := e.Do("DELETE", "/recordings/"+c.rec.ID+"/bookmarks/"+id, tok, wire.RevisionedDelete{OperationID: uuid.NewString(), BaseRevision: "2", CapturedAt: "2026-11-13T12:00:00Z"})
	status(t, del, 200, "")
	if got := c.list(tok); got.Total != 0 {
		t.Fatalf("deleted bookmark still listed: %+v", got)
	}
	revive := c.put(id, "2", c.data(1, 1500, "late edit"))
	if revive.StatusCode != http.StatusConflict || revive.Code() != "deleted" {
		t.Fatalf("revive: %d %s", revive.StatusCode, revive.Body)
	}
	status(t, c.resolve(c.conflicts()[0].ID, "keep_current", "3"), http.StatusNoContent, "")

	// A layout change leaves the bookmark in place but unavailable; renaming keeps working, a new place is refused.
	kept := uuid.NewString()
	status(t, c.put(kept, "0", c.data(2, 500, "keep me")), 200, "")
	order := []uuid.UUID{uuid.MustParse(c.rec.Files[1].ID), uuid.MustParse(c.rec.Files[0].ID), uuid.MustParse(c.rec.Files[2].ID)}
	if err := seed.Reorder(context.Background(), e.Pool, e.Fix.ThreeFile, order); err != nil {
		t.Fatal(err)
	}
	got := c.list(tok)
	if got.Total != 1 || got.Items[0].Available || got.Items[0].Data.Value.OffsetMs != 500 {
		t.Fatalf("after a layout change: %+v", got)
	}
	status(t, c.put(kept, "1", c.data(2, 500, "renamed")), 200, "")
	moved := c.put(kept, "2", c.data(2, 900, "renamed"))
	if moved.StatusCode != http.StatusPreconditionFailed || moved.Code() != "layout_changed" {
		t.Fatalf("moving under an old layout: %d %s", moved.StatusCode, moved.Body)
	}
	if x := c.resolve(c.conflicts()[0].ID, "use_candidate", "2"); x.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("a place that no longer exists must not be applied: %d %s", x.StatusCode, x.Body)
	}
	if len(c.conflicts()) != 1 {
		t.Fatal("the refused choice must leave the conflict")
	}
}

// ADR-0070 and ADR-0110: repair copies a bookmark to the successor holding its exact file version; the source keeps it.
func TestRecordingRepairCopiesValidBookmarks(t *testing.T) {
	e := apitest.New(t)
	admin := e.Login(seed.AdminName, "cli").AccessToken
	a := e.Login(seed.UserAName, "phone").AccessToken
	if x := e.Do("PUT", "/admin/users/"+e.Fix.AdminID.String()+"/libraries/"+e.Fix.Lib1.String(), admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d %s", x.StatusCode, x.Body)
	}
	tf, alt := snapshot(t, e, a, e.Fix.ThreeFile), snapshot(t, e, a, e.Fix.Alternate)
	source := bookmarkCase{t: t, e: e, tok: a, rec: tf}
	status(t, source.put(uuid.NewString(), "0", source.data(1, 700, "carried")), 200, "")

	pl := e.Do("POST", "/admin/recording-repairs", admin, repairPlan(uuid.NewString(), "merge", []wire.Recording{tf, alt}, out("m", repairFiles(tf), repairFiles(alt))))
	status(t, pl, 201, "")
	var plan wire.RepairPlan
	pl.JSON(t, &plan)
	path := "/admin/recording-repairs/" + plan.ID
	status(t, e.Do("POST", path+"/approve", admin, apply("0")), 200, "")
	ex := e.Do("POST", path+"/execute", admin, apply("1"))
	status(t, ex, 200, "")
	ex.JSON(t, &plan)
	successor := snapshot(t, e, a, uuid.MustParse(plan.Result[0].RecordingID))

	got := bookmarkCase{t: t, e: e, tok: a, rec: successor}.list(a)
	if got.Total != 1 || !got.Items[0].Available || got.Items[0].Data.Value.Note != "carried" || got.Items[0].Data.Value.OffsetMs != 700 || got.Items[0].Data.Value.LayoutRevision != successor.LayoutRevision {
		t.Fatalf("successor bookmarks: %+v", got)
	}
	old := source.list(a)
	if old.Total != 1 || old.Items[0].Available {
		t.Fatalf("the source keeps its bookmark, unavailable: %+v", old)
	}
	if x := source.put(uuid.NewString(), "0", source.data(0, 10, "late")); x.StatusCode != http.StatusConflict {
		t.Fatalf("a replaced recording takes no new bookmarks: %d %s", x.StatusCode, x.Body)
	}
	// Listening that happened before the repair can still arrive afterwards.
	now := e.Clock.Now().UTC().Truncate(time.Second)
	late := e.Do("PUT", "/recordings/"+tf.ID+"/listening-sessions/"+uuid.NewString(), a, map[string]any{
		"startedAt": now.Add(-time.Hour).Format(time.RFC3339), "endedAt": now.Add(-50 * time.Minute).Format(time.RFC3339), "listenedSeconds": 300})
	status(t, late, http.StatusNoContent, "")
}
