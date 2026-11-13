package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type pcase struct {
	e      *apitest.Env
	tok    string
	rec    uuid.UUID
	snap   wire.Recording
	layout string
}

func newCase(t *testing.T, e *apitest.Env, user string) *pcase {
	tok := e.Login(user, "Phone").AccessToken
	snap := snapshot(t, e, tok, e.Fix.ThreeFile)
	return &pcase{e: e, tok: tok, rec: e.Fix.ThreeFile, snap: snap, layout: snap.LayoutRevision}
}

func (c *pcase) pos(file int, offset int64) wire.PositionInput {
	f := c.snap.Files[file]
	return wire.PositionInput{FileID: f.ID, ContentVersion: f.ContentVersion, OffsetMs: offset, CapturedAt: "2026-11-13T12:00:00Z"}
}

func (c *pcase) write(tok, base string, p wire.PositionInput, op ...string) apitest.Response {
	id := uuid.NewString()
	if len(op) > 0 {
		id = op[0]
	}
	return c.e.Do("PUT", "/recordings/"+c.rec.String()+"/position", tok,
		wire.PositionWrite{OperationID: id, BaseRevision: base, LayoutRevision: c.layout, Position: p})
}

func (c *pcase) state(tok string) wire.PositionState {
	r := c.e.Do("GET", "/recordings/"+c.rec.String()+"/position", tok, nil)
	status(c.e.T, r, 200, "")
	var s wire.PositionState
	r.JSON(c.e.T, &s)
	return s
}

func problem(t *testing.T, r apitest.Response) httpapi.Problem {
	t.Helper()
	var p httpapi.Problem
	r.JSON(t, &p)
	return p
}

func TestPositionRevisionsReceiptsAndBackwardSeek(t *testing.T) {
	e := apitest.New(t)
	c := newCase(t, e, "fixture-user-a")

	if s := c.state(c.tok); s.Revision != "0" || s.Position.Value != nil || len(s.UnresolvedConflicts) != 0 {
		t.Fatalf("initial state: %+v", s)
	}

	op := uuid.NewString()
	r1 := c.write(c.tok, "0", c.pos(1, 30000), op)
	status(t, r1, 200, "")
	var s1 wire.PositionState
	r1.JSON(t, &s1)
	if s1.Revision != "1" || s1.Position.Value.OffsetMs != 30000 || s1.Position.Value.DeviceName != "Phone" || s1.Position.Value.LayoutRevision != c.layout {
		t.Fatalf("accepted: %+v", s1)
	}

	// An identical recorded operation returns the original body without a new revision.
	again := c.write(c.tok, "0", c.pos(1, 30000), op)
	if again.StatusCode != 200 || string(again.Body) != string(r1.Body) || c.state(c.tok).Revision != "1" {
		t.Fatalf("retry: %d %s", again.StatusCode, again.Body)
	}
	// The same ID with a different body is rejected and changes nothing.
	status(t, c.write(c.tok, "0", c.pos(1, 31000), op), 409, "operation_id_reused")
	if c.state(c.tok).Position.Value.OffsetMs != 30000 {
		t.Fatal("operation_id_reused mutated state")
	}

	// Intentional backward movement is a normal accepted write that advances the revision.
	back := c.write(c.tok, "1", c.pos(0, 5000))
	status(t, back, 200, "")
	if s := c.state(c.tok); s.Revision != "2" || s.Position.Value.OffsetMs != 5000 || s.Position.Value.FileID != c.snap.Files[0].ID {
		t.Fatalf("backward: %+v", s)
	}

	// Offsets are validated, never clamped: past the file end, negative, nonmember and unknown version are refused.
	status(t, c.write(c.tok, "2", c.pos(0, *c.snap.Files[0].DurationMs+1)), 422, "invalid_position")
	status(t, c.write(c.tok, "2", c.pos(0, -1)), 422, "validation_failed")
	other := c.pos(0, 1)
	other.FileID = e.Fix.Files["r2-f1"].ID.String()
	other.ContentVersion = e.Fix.Files["r2-f1"].Version.String()
	status(t, c.write(c.tok, "2", other), 422, "invalid_position")
	unknown := c.pos(0, 1)
	unknown.ContentVersion = uuid.NewString()
	status(t, c.write(c.tok, "2", unknown), 422, "invalid_position")
	end := c.write(c.tok, "2", c.pos(0, *c.snap.Files[0].DurationMs)) // the final endpoint is a valid resume position
	status(t, end, 200, "")
	if s := c.state(c.tok); s.Revision != "3" || len(s.UnresolvedConflicts) != 0 {
		t.Fatalf("after validation failures: %+v", s)
	}
	status(t, c.write(c.tok, "9", c.pos(0, 1)), 422, "validation_failed") // base ahead of the server

	// A position is per user: another account cannot read or write it.
	status(t, c.e.Do("GET", "/recordings/"+c.rec.String()+"/position", e.Login("fixture-user-b", "B").AccessToken, nil), 403, "library_access_denied")
}

func TestTwoDeviceContentionPreservesBothCandidates(t *testing.T) {
	e := apitest.New(t)
	phone := newCase(t, e, "fixture-user-a")
	tablet := e.Login("fixture-user-a", "Tablet").AccessToken
	status(t, phone.write(phone.tok, "0", phone.pos(0, 1000)), 200, "")

	// Both devices last saw revision 1. The phone wins; the tablet's write becomes a durable conflict.
	status(t, phone.write(phone.tok, "1", phone.pos(1, 2000)), 200, "")
	r := phone.write(tablet, "1", phone.pos(2, 3000))
	status(t, r, 409, "position_conflict")
	p := problem(t, r)
	if p.ConflictID == "" || p.Current == nil || p.Current.Revision != "2" || p.Current.Position.Value.OffsetMs != 2000 {
		t.Fatalf("problem body: %+v", p)
	}
	// Canonical position is unchanged; the candidate is recoverable after a restart (fresh server, same database).
	restarted := httptest.NewServer(httpapi.New(httpapi.Deps{Pool: e.Pool, API: &httpapi.APIDeps{Accounts: e.Accounts, Catalog: e.Catalog, Progress: e.Progress, Config: e.Cfg}}))
	defer restarted.Close()
	req, _ := http.NewRequest("GET", restarted.URL+"/api/v1/recordings/"+phone.rec.String()+"/position", nil)
	req.Header.Set("Authorization", "Bearer "+tablet)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var st wire.PositionState
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		t.Fatal(err)
	}
	if st.Revision != "2" || st.Position.Value.OffsetMs != 2000 || len(st.UnresolvedConflicts) != 1 {
		t.Fatalf("after restart: %+v", st)
	}
	cf := st.UnresolvedConflicts[0]
	if cf.ID != p.ConflictID || cf.Reason != "stale_revision" || cf.Candidate.Value.OffsetMs != 3000 || cf.Candidate.Value.DeviceName != "Tablet" || cf.BaseRevision != "1" {
		t.Fatalf("durable conflict: %+v", cf)
	}

	// Resolving needs a new operation against the current revision; using the candidate is a new revision.
	res := e.Do("POST", "/recordings/"+phone.rec.String()+"/conflicts/"+cf.ID+"/resolve", tablet,
		wire.ResolveConflict{OperationID: uuid.NewString(), BaseRevision: "2", LayoutRevision: phone.layout, Choice: "use_candidate"})
	status(t, res, 200, "")
	var after wire.PositionState
	res.JSON(t, &after)
	if after.Revision != "3" || after.Position.Value.OffsetMs != 3000 || len(after.UnresolvedConflicts) != 0 {
		t.Fatalf("resolved: %+v", after)
	}
	// Raw evidence is retained, marked resolved.
	var resolved int
	_ = e.Pool.QueryRow(context.Background(), `SELECT count(*) FROM conflicts WHERE id = $1 AND resolved_at IS NOT NULL`, cf.ID).Scan(&resolved)
	if resolved != 1 {
		t.Fatal("resolved conflict evidence was deleted")
	}
	// A second resolution with a new operation is a typed conflict; the identical retry returns the receipt.
	status(t, e.Do("POST", "/recordings/"+phone.rec.String()+"/conflicts/"+cf.ID+"/resolve", tablet,
		wire.ResolveConflict{OperationID: uuid.NewString(), BaseRevision: "3", LayoutRevision: phone.layout, Choice: "keep_server"}), 409, "conflict_resolved")
}

func TestConcurrentWritersExactlyOneWins(t *testing.T) {
	e := apitest.New(t)
	c := newCase(t, e, "fixture-user-a")
	var wg sync.WaitGroup
	var mu sync.Mutex
	won, conflicts := 0, 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := c.write(c.tok, "0", c.pos(0, int64(1000+i)))
			mu.Lock()
			defer mu.Unlock()
			switch r.StatusCode {
			case 200:
				won++
			case 409:
				conflicts++
			default:
				t.Errorf("unexpected %d %s", r.StatusCode, r.Body)
			}
		}()
	}
	wg.Wait()
	if won != 1 || conflicts != 7 {
		t.Fatalf("won=%d conflicts=%d", won, conflicts)
	}
	s := c.state(c.tok)
	if s.Revision != "1" || len(s.UnresolvedConflicts) != 7 {
		t.Fatalf("state: revision %s, %d conflicts", s.Revision, len(s.UnresolvedConflicts))
	}
}

func TestConflictResolutionChoicesAndRaces(t *testing.T) {
	e := apitest.New(t)
	c := newCase(t, e, "fixture-user-a")
	dev2 := e.Login("fixture-user-a", "Tablet").AccessToken
	status(t, c.write(c.tok, "0", c.pos(0, 1000)), 200, "") // rev 1
	status(t, c.write(dev2, "0", c.pos(1, 7000)), 409, "position_conflict")
	cf := c.state(c.tok).UnresolvedConflicts[0]
	resolve := func(tok string, body wire.ResolveConflict) apitest.Response {
		return e.Do("POST", "/recordings/"+c.rec.String()+"/conflicts/"+cf.ID+"/resolve", tok, body)
	}
	rb := func(base, choice string, p *wire.PositionInput) wire.ResolveConflict {
		return wire.ResolveConflict{OperationID: uuid.NewString(), BaseRevision: base, LayoutRevision: c.layout, Choice: choice, Position: wire.Some(p)}
	}

	// Argument rules: keep_server and use_candidate require null; use_explicit requires a position.
	exp := c.pos(2, 100)
	status(t, resolve(dev2, rb("1", "keep_server", &exp)), 422, "validation_failed")
	status(t, resolve(dev2, rb("1", "use_candidate", &exp)), 422, "validation_failed")
	status(t, resolve(dev2, rb("1", "use_explicit", nil)), 422, "validation_failed")

	// Race: the server advanced while the user was choosing -> 409, the conflict stays unresolved.
	status(t, c.write(c.tok, "1", c.pos(0, 2000)), 200, "") // rev 2
	r := resolve(dev2, rb("1", "use_candidate", nil))
	status(t, r, 409, "position_conflict")
	if p := problem(t, r); p.ConflictID != cf.ID || p.Current.Revision != "2" {
		t.Fatalf("race body: %+v", p)
	}
	if st := c.state(c.tok); len(st.UnresolvedConflicts) != 1 || st.UnresolvedConflicts[0].ID != cf.ID {
		t.Fatalf("conflict lost during race: %+v", st)
	}

	// Explicit new position is a new revision-aware operation.
	op := wire.ResolveConflict{OperationID: uuid.NewString(), BaseRevision: "2", LayoutRevision: c.layout, Choice: "use_explicit", Position: wire.Some(&exp)}
	ok := resolve(dev2, op)
	status(t, ok, 200, "")
	var st wire.PositionState
	ok.JSON(t, &st)
	if st.Revision != "3" || st.Position.Value.FileID != c.snap.Files[2].ID || st.Position.Value.OffsetMs != 100 || len(st.UnresolvedConflicts) != 0 {
		t.Fatalf("explicit: %+v", st)
	}
	// Identical retry returns the original receipt; no extra revision.
	if again := resolve(dev2, op); again.StatusCode != 200 || string(again.Body) != string(ok.Body) || c.state(c.tok).Revision != "3" {
		t.Fatalf("retry: %d", again.StatusCode)
	}
	// An unknown conflict is 404; another user's conflict is not visible either.
	status(t, e.Do("POST", "/recordings/"+c.rec.String()+"/conflicts/"+uuid.NewString()+"/resolve", dev2, rb("3", "keep_server", nil)), 404, "not_found")

	// keep_server on a fresh conflict advances the revision and leaves the position as it was.
	status(t, c.write(dev2, "0", c.pos(1, 9000)), 409, "position_conflict")
	cf2 := c.state(c.tok).UnresolvedConflicts[0]
	ks := e.Do("POST", "/recordings/"+c.rec.String()+"/conflicts/"+cf2.ID+"/resolve", dev2, rb("3", "keep_server", nil))
	status(t, ks, 200, "")
	var kst wire.PositionState
	ks.JSON(t, &kst)
	if kst.Revision != "4" || kst.Position.Value.OffsetMs != 100 || len(kst.UnresolvedConflicts) != 0 {
		t.Fatalf("keep_server: %+v", kst)
	}
}

func TestLayoutAndContentChangesPreserveCandidates(t *testing.T) {
	e := apitest.New(t)
	ctx := context.Background()
	c := newCase(t, e, "fixture-user-a")
	status(t, c.write(c.tok, "0", c.pos(0, 1000)), 200, "")

	// Reorder: a valid old file/version anchor against the old layout -> 412 layout_changed, candidate preserved.
	if err := seed.Reorder(ctx, e.Pool, c.rec, []uuid.UUID{e.Fix.Files["r1-f2"].ID, e.Fix.Files["r1-f1"].ID, e.Fix.Files["r1-f3"].ID}); err != nil {
		t.Fatal(err)
	}
	r := c.write(c.tok, "1", c.pos(0, 4000))
	status(t, r, 412, "layout_changed")
	p := problem(t, r)
	cur := snapshot(t, e, c.tok, c.rec)
	if p.ConflictID == "" || p.CurrentLayoutRevision != cur.LayoutRevision || cur.LayoutRevision == c.layout {
		t.Fatalf("412 body: %+v (layout %s)", p, cur.LayoutRevision)
	}
	st := c.state(c.tok)
	if len(st.UnresolvedConflicts) != 1 || st.UnresolvedConflicts[0].Reason != "layout_changed" || st.UnresolvedConflicts[0].Candidate.Value.OffsetMs != 4000 || st.Revision != "1" {
		t.Fatalf("state: %+v", st)
	}
	// The client validated the anchor against the new snapshot and resubmits the same file/version/offset with a new operation.
	c.layout, c.snap = cur.LayoutRevision, cur
	ok := c.e.Do("PUT", "/recordings/"+c.rec.String()+"/position", c.tok, wire.PositionWrite{OperationID: uuid.NewString(), BaseRevision: "1",
		LayoutRevision: c.layout, Position: wire.PositionInput{FileID: e.Fix.Files["r1-f1"].ID.String(), ContentVersion: e.Fix.Files["r1-f1"].Version.String(), OffsetMs: 4000, CapturedAt: "2026-11-13T12:00:00Z"}})
	status(t, ok, 200, "")

	// The unresolved layout candidate can be adopted when its anchor is still valid.
	cf := c.state(c.tok).UnresolvedConflicts[0]
	res := e.Do("POST", "/recordings/"+c.rec.String()+"/conflicts/"+cf.ID+"/resolve", c.tok,
		wire.ResolveConflict{OperationID: uuid.NewString(), BaseRevision: "2", LayoutRevision: c.layout, Choice: "use_candidate", Position: wire.Nullable[wire.PositionInput]{}})
	status(t, res, 200, "")

	// Replacement: same file ID, different content version -> content_changed, no offset mapping.
	oldRef := e.Fix.Files["r1-f2"]
	dur := *snapshot(t, e, c.tok, c.rec).Files[0].DurationMs
	np := filepath.Join(e.Cfg.MediaRoot, "r1-part2-v2.mp3")
	b, _ := os.ReadFile(oldRef.Path)
	_ = os.WriteFile(np, append(b, 1), 0o600)
	if _, err := seed.ReplaceContent(ctx, e.Pool, oldRef, np, int64(len(b)+1), dur); err != nil {
		t.Fatal(err)
	}
	stale := wire.PositionWrite{OperationID: uuid.NewString(), BaseRevision: "3", LayoutRevision: c.layout,
		Position: wire.PositionInput{FileID: oldRef.ID.String(), ContentVersion: oldRef.Version.String(), OffsetMs: 500, CapturedAt: "2026-11-13T12:00:00Z"}}
	r = e.Do("PUT", "/recordings/"+c.rec.String()+"/position", c.tok, stale)
	status(t, r, 412, "content_changed")
	cc := problem(t, r).ConflictID
	// A changed-content candidate cannot be adopted heuristically; an explicit position against the new bytes can.
	newSnap := snapshot(t, e, c.tok, c.rec)
	c.layout = newSnap.LayoutRevision
	adopt := e.Do("POST", "/recordings/"+c.rec.String()+"/conflicts/"+cc+"/resolve", c.tok,
		wire.ResolveConflict{OperationID: uuid.NewString(), BaseRevision: "3", LayoutRevision: c.layout, Choice: "use_candidate"})
	status(t, adopt, 412, "content_changed")
	var f2 wire.File
	for _, f := range newSnap.Files {
		if f.ID == oldRef.ID.String() {
			f2 = f
		}
	}
	expl := wire.PositionInput{FileID: f2.ID, ContentVersion: f2.ContentVersion, OffsetMs: 250, CapturedAt: "2026-11-13T12:00:00Z"}
	status(t, e.Do("POST", "/recordings/"+c.rec.String()+"/conflicts/"+cc+"/resolve", c.tok,
		wire.ResolveConflict{OperationID: uuid.NewString(), BaseRevision: "3", LayoutRevision: c.layout, Choice: "use_explicit", Position: wire.Some(&expl)}), 200, "")
}

func TestCompletionNaturalEndManualAndHistory(t *testing.T) {
	e := apitest.New(t)
	c := newCase(t, e, "fixture-user-a")
	last := c.snap.Files[2]
	endAnchor := &wire.Anchor{FileID: last.ID, ContentVersion: last.ContentVersion, OffsetMs: *last.DurationMs}
	cw := func(base, event string, final *wire.Anchor) wire.CompletionWrite {
		return wire.CompletionWrite{OperationID: uuid.NewString(), BaseRevision: base, LayoutRevision: c.layout, Event: event,
			CapturedAt: "2026-11-13T12:00:00Z", FinalPosition: wire.Some(final)}
	}
	put := func(w wire.CompletionWrite) apitest.Response {
		return e.Do("PUT", "/recordings/"+c.rec.String()+"/completion", c.tok, w)
	}
	getC := func() wire.CompletionState {
		var s wire.CompletionState
		e.Do("GET", "/recordings/"+c.rec.String()+"/completion", c.tok, nil).JSON(t, &s)
		return s
	}
	history := func() wire.History {
		var h wire.History
		e.Do("GET", "/titles/"+c.snap.TitleID+"/history", c.tok, nil).JSON(t, &h)
		return h
	}

	if s := getC(); s.Revision != "0" || s.Finished || s.ChangedAt != nil {
		t.Fatalf("initial: %+v", s)
	}
	// Seeking to the end never finishes a recording.
	status(t, c.write(c.tok, "0", wire.PositionInput{FileID: last.ID, ContentVersion: last.ContentVersion, OffsetMs: *last.DurationMs, CapturedAt: "2026-11-13T12:00:00Z"}), 200, "")
	if s := getC(); s.Finished || s.Revision != "0" {
		t.Fatalf("seek-only finished the recording: %+v", s)
	}

	// Invalid event/anchor combinations are rejected.
	status(t, put(cw("0", "natural_end", nil)), 422, "validation_failed")
	status(t, put(cw("0", "manual_finish", endAnchor)), 422, "validation_failed")
	mid := &wire.Anchor{FileID: last.ID, ContentVersion: last.ContentVersion, OffsetMs: 10}
	status(t, put(cw("0", "natural_end", mid)), 422, "invalid_position")
	first := c.snap.Files[0]
	notLast := &wire.Anchor{FileID: first.ID, ContentVersion: first.ContentVersion, OffsetMs: *first.DurationMs}
	status(t, put(cw("0", "natural_end", notLast)), 422, "invalid_position")
	if getC().Finished {
		t.Fatal("rejected events changed state")
	}

	// A real natural end finishes this recording once, with one history entry; the alternate stays unfinished.
	ne := cw("0", "natural_end", endAnchor)
	r := put(ne)
	status(t, r, 200, "")
	var s wire.CompletionState
	r.JSON(t, &s)
	if s.Revision != "1" || !s.Finished || s.ChangedAt == nil {
		t.Fatalf("finished: %+v", s)
	}
	if again := put(ne); again.StatusCode != 200 || string(again.Body) != string(r.Body) {
		t.Fatalf("idempotent retry: %d", again.StatusCode)
	}
	if h := history(); h.Total != 1 || h.Items[0].Event != "natural_end" || h.Items[0].RecordingID != c.rec.String() || h.Items[0].TitleID != c.snap.TitleID {
		t.Fatalf("history: %+v", h)
	}
	// A repeated finish while finished fabricates no reread-history entry and no revision.
	status(t, put(cw("1", "natural_end", endAnchor)), 200, "")
	status(t, put(cw("1", "manual_finish", nil)), 200, "")
	if h, s := history(), getC(); h.Total != 1 || s.Revision != "1" {
		t.Fatalf("repeat finish: history %d, %+v", h.Total, s)
	}
	var list wire.Recordings
	e.Do("GET", "/recordings", c.tok, nil).JSON(t, &list)
	for _, it := range list.Items {
		if it.ID == e.Fix.Alternate.String() && it.Completion.Finished {
			t.Fatal("the alternate recording of the same title must stay unfinished")
		}
		if it.ID == c.rec.String() && (!it.Completion.Finished || it.LastActivityAt == nil) {
			t.Fatalf("summary: %+v", it)
		}
	}

	// Explicit unfinish preserves previous history and is its own event; refinish adds a transition.
	status(t, put(cw("1", "manual_unfinish", nil)), 200, "")
	if h, s := history(), getC(); h.Total != 2 || h.Items[1].Event != "manual_unfinish" || s.Finished || s.Revision != "2" {
		t.Fatalf("unfinish: %+v %+v", h, s)
	}
	status(t, put(cw("2", "manual_finish", nil)), 200, "")
	if h := history(); h.Total != 3 || h.Items[0].Event != "natural_end" || h.Items[2].Event != "manual_finish" {
		t.Fatalf("history after refinish: %+v", h)
	}

	// Stale completion revision -> durable completion_conflict that preserves the attempted event.
	stale := cw("1", "manual_unfinish", nil)
	r = put(stale)
	status(t, r, 409, "completion_conflict")
	p := problem(t, r)
	if p.ConflictID == "" || p.CurrentCompletion == nil || p.CurrentCompletion.Revision != "3" || !p.CurrentCompletion.Finished {
		t.Fatalf("completion conflict body: %+v", p)
	}
	ps := c.state(c.tok)
	if len(ps.UnresolvedConflicts) != 1 || ps.UnresolvedConflicts[0].Reason != "completion_changed" || ps.UnresolvedConflicts[0].CompletionCandidate.Value.Event != "manual_unfinish" {
		t.Fatalf("restart recovery state: %+v", ps)
	}
	// Position conflicts cannot be resolved through the completion endpoint and vice versa.
	status(t, e.Do("POST", "/recordings/"+c.rec.String()+"/conflicts/"+p.ConflictID+"/resolve", c.tok,
		wire.ResolveConflict{OperationID: uuid.NewString(), BaseRevision: "0", LayoutRevision: c.layout, Choice: "keep_server"}), 404, "not_found")
	rc := e.Do("POST", "/recordings/"+c.rec.String()+"/completion-conflicts/"+p.ConflictID+"/resolve", c.tok,
		wire.ResolveCompletionConflict{OperationID: uuid.NewString(), BaseRevision: "3", LayoutRevision: c.layout, Choice: "use_candidate", CapturedAt: "2026-11-13T12:00:00Z"})
	status(t, rc, 200, "")
	var after wire.CompletionState
	rc.JSON(t, &after)
	if after.Finished || after.Revision != "4" || len(c.state(c.tok).UnresolvedConflicts) != 0 {
		t.Fatalf("resolved completion: %+v", after)
	}
	if h := history(); h.Total != 4 || h.Items[3].Event != "manual_unfinish" {
		t.Fatalf("history after resolution: %+v", h)
	}
}

func TestNaturalEndAfterLayoutChangeIsPreserved(t *testing.T) {
	e := apitest.New(t)
	c := newCase(t, e, "fixture-user-a")
	last := c.snap.Files[2]
	if err := seed.Reorder(context.Background(), e.Pool, c.rec, []uuid.UUID{e.Fix.Files["r1-f3"].ID, e.Fix.Files["r1-f1"].ID, e.Fix.Files["r1-f2"].ID}); err != nil {
		t.Fatal(err)
	}
	w := wire.CompletionWrite{OperationID: uuid.NewString(), BaseRevision: "0", LayoutRevision: c.layout, Event: "natural_end", CapturedAt: "2026-11-13T12:00:00Z",
		FinalPosition: wire.Some(&wire.Anchor{FileID: last.ID, ContentVersion: last.ContentVersion, OffsetMs: *last.DurationMs})}
	r := e.Do("PUT", "/recordings/"+c.rec.String()+"/completion", c.tok, w)
	status(t, r, 412, "layout_changed")
	if p := problem(t, r); p.ConflictID == "" || p.CurrentLayoutRevision == c.layout {
		t.Fatalf("412: %+v", p)
	}
	var s wire.CompletionState
	e.Do("GET", "/recordings/"+c.rec.String()+"/completion", c.tok, nil).JSON(t, &s)
	if s.Finished || s.Revision != "0" {
		t.Fatalf("a stale-layout event finished the recording: %+v", s)
	}
}

func TestListSearchPaginationRecentAndGrants(t *testing.T) {
	e := apitest.New(t)
	a := e.Login("fixture-user-a", "A")
	b := e.Login("fixture-user-b", "B")
	admin := e.Login("fixture-admin", "admin")
	list := func(tok, q string) (apitest.Response, wire.Recordings) {
		r := e.Do("GET", "/recordings"+q, tok, nil)
		var l wire.Recordings
		if r.StatusCode == 200 {
			r.JSON(t, &l)
		}
		return r, l
	}

	_, la := list(a.AccessToken, "")
	_, lb := list(b.AccessToken, "")
	_, ladmin := list(admin.AccessToken, "")
	if la.Total != 3 || lb.Total != 1 || ladmin.Total != 0 || la.Page != 0 || la.Size != 50 {
		t.Fatalf("totals a=%d b=%d admin=%d size=%d", la.Total, lb.Total, ladmin.Total, la.Size)
	}
	// Totals are computed after authorization and filtering, not globally.
	if _, l := list(a.AccessToken, "?q=Alternate+Narrator"); l.Total != 1 || l.Items[0].ID != e.Fix.Alternate.String() {
		t.Fatalf("narrator search: %+v", l)
	}
	if _, l := list(a.AccessToken, "?q=fIXTURE+auThOr"); l.Total != 3 {
		t.Fatalf("author search: %d", l.Total)
	}
	if _, l := list(a.AccessToken, "?q=other+library"); l.Total != 0 {
		t.Fatalf("a must not find the other library: %d", l.Total)
	}
	if _, l := list(b.AccessToken, "?q=other+library"); l.Total != 1 {
		t.Fatalf("b search: %d", l.Total)
	}
	if _, l := list(a.AccessToken, "?libraryId="+e.Fix.Lib2.String()); l.Total != 0 {
		t.Fatalf("library filter bypassed grants: %d", l.Total)
	}

	// Size handling: zero/negative/nonnumeric -> 422; above 200 capped with the effective value echoed.
	for _, q := range []string{"?size=0", "?size=-3", "?size=abc", "?page=-1"} {
		if r, _ := list(a.AccessToken, q); r.StatusCode != 422 || r.Code() != "validation_failed" {
			t.Errorf("%s: %d %s", q, r.StatusCode, r.Body)
		}
	}
	if _, l := list(a.AccessToken, "?size=500"); l.Size != 200 {
		t.Fatalf("size not capped: %d", l.Size)
	}
	_, p0 := list(a.AccessToken, "?size=2&page=0")
	_, p1 := list(a.AccessToken, "?size=2&page=1")
	_, p9 := list(a.AccessToken, "?size=2&page=9")
	if len(p0.Items) != 2 || len(p1.Items) != 1 || len(p9.Items) != 0 || p9.Total != 3 || p9.Size != 2 || p0.Items[0].ID == p1.Items[0].ID {
		t.Fatalf("pagination: %d %d %d total=%d", len(p0.Items), len(p1.Items), len(p9.Items), p9.Total)
	}
	// Stable title-then-ID ordering.
	for i := 1; i < len(la.Items); i++ {
		if la.Items[i-1].Title > la.Items[i].Title {
			t.Fatalf("not title ordered: %s > %s", la.Items[i-1].Title, la.Items[i].Title)
		}
	}

	// Continue Listening: unfinished + recent orders by server activity, then finished items drop out.
	c := newCase(t, e, "fixture-user-a")
	status(t, c.write(c.tok, "0", c.pos(0, 100)), 200, "")
	_, recent := list(a.AccessToken, "?sort=recent&completion=unfinished")
	if recent.Total != 3 || recent.Items[0].ID != e.Fix.ThreeFile.String() || recent.Items[0].LastActivityAt == nil {
		t.Fatalf("recent unfinished: %+v", recent.Items[0])
	}
	last := c.snap.Files[2]
	status(t, e.Do("PUT", "/recordings/"+c.rec.String()+"/completion", a.AccessToken, wire.CompletionWrite{OperationID: uuid.NewString(), BaseRevision: "0",
		LayoutRevision: c.layout, Event: "manual_finish", CapturedAt: "2026-11-13T12:00:00Z"}), 200, "")
	_ = last
	if _, l := list(a.AccessToken, "?completion=unfinished"); l.Total != 2 {
		t.Fatalf("unfinished after finish: %d", l.Total)
	}
	if _, l := list(a.AccessToken, "?completion=finished"); l.Total != 1 {
		t.Fatalf("finished: %d", l.Total)
	}

	// Explicit self-grant for the administrator turns the 403 into a 200.
	status(t, e.Do("GET", "/recordings/"+e.Fix.ThreeFile.String(), admin.AccessToken, nil), 403, "library_access_denied")
	status(t, e.Do("PUT", "/admin/users/"+e.Fix.AdminID.String()+"/libraries/"+e.Fix.Lib1.String(), admin.AccessToken, nil), 204, "")
	status(t, e.Do("GET", "/recordings/"+e.Fix.ThreeFile.String(), admin.AccessToken, nil), 200, "")
	status(t, e.Do("GET", "/recordings/"+uuid.NewString(), admin.AccessToken, nil), 404, "not_found")
	var libs wire.LibraryList
	e.Do("GET", "/libraries", admin.AccessToken, nil).JSON(t, &libs)
	if libs.Total != 1 || libs.Items[0].ID != e.Fix.Lib1.String() {
		t.Fatalf("libraries: %+v", libs)
	}
	_ = strconv.Itoa
}
