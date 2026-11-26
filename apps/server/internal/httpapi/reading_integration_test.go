package httpapi_test

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type readingEnv struct {
	e                   *apitest.Env
	admin, userA, userB string
	lib, root           string
	ed                  wire.Edition
	book                string
}

func newReadingEnv(t *testing.T) *readingEnv {
	t.Helper()
	return newReadingEnvWith(t, apitest.Options{})
}

func newReadingEnvWith(t *testing.T, o apitest.Options) *readingEnv {
	t.Helper()
	e := apitest.New(t, o)
	root, _ := filepath.Abs(filepath.Join(e.Cfg.MediaRoot, "ebooks"))
	_ = os.MkdirAll(root, 0o755)
	admin := e.Login(seed.AdminName, "cli").AccessToken
	d := setupLibrary(t, e, admin, root)
	lib := d.Library.ID
	if r := e.Do("PUT", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+lib, admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d %s", r.StatusCode, r.Body)
	}
	book := filepath.Join(root, "Saga", "vol2.epub")
	epub(t, book, "Second Volume", "Ada Author", "978-1-4028-9462-6")
	scanTwice(t, e, admin, lib)
	r := &readingEnv{e: e, admin: admin, userA: e.Login(seed.UserAName, "phone").AccessToken, userB: e.Login(seed.UserBName, "tablet").AccessToken, lib: lib, root: root, book: book}
	var eds wire.Editions
	e.Do("GET", "/editions?libraryId="+lib, r.userA, nil).JSON(t, &eds)
	if len(eds.Items) != 1 {
		t.Fatalf("editions: %+v", eds)
	}
	r.ed = eds.Items[0]
	return r
}

func (r *readingEnv) cfi(path string) map[string]any {
	return map[string]any{"kind": "foliate-cfi", "version": 1, "cfi": "epubcfi(" + path + ")"}
}

func (r *readingEnv) posBody(op, base, version string, locator map[string]any) map[string]any {
	return map[string]any{"operationId": op, "baseRevision": base, "capturedAt": "2026-11-14T10:00:00Z",
		"anchor": map[string]any{"fileId": r.ed.File.ID, "contentVersion": version, "locator": locator}}
}

func (r *readingEnv) putPos(t *testing.T, token string, body map[string]any) apitest.Response {
	return r.e.Do("PUT", "/editions/"+r.ed.ID+"/position", token, body)
}

func problemMap(t *testing.T, r apitest.Response) map[string]any {
	t.Helper()
	var m map[string]any
	r.JSON(t, &m)
	return m
}

func TestEditionPositionRevisionsReceiptsAndConflicts(t *testing.T) {
	r := newReadingEnv(t)
	e, v := r.e, r.ed.File.ContentVersion

	var st wire.ReadingPositionState
	e.Do("GET", "/editions/"+r.ed.ID+"/position", r.userA, nil).JSON(t, &st)
	if st.Revision != "0" || st.Position.Value != nil || st.UnresolvedConflictCount != 0 {
		t.Fatalf("initial: %+v", st)
	}

	// First write, then an intentional backward seek: both are valid revisions.
	op1 := uuid.NewString()
	w1 := r.posBody(op1, "0", v, r.cfi("/6/8!/4/2"))
	first := r.putPos(t, r.userA, w1)
	if first.StatusCode != 200 {
		t.Fatalf("write 1: %d %s", first.StatusCode, first.Body)
	}
	first.JSON(t, &st)
	if st.Revision != "1" || st.Position.Value == nil || st.Position.Value.Anchor.Locator.CFI == nil {
		t.Fatalf("after write 1: %+v", st)
	}
	back := r.putPos(t, r.userA, r.posBody(uuid.NewString(), "1", v, r.cfi("/6/2!/4/2")))
	back.JSON(t, &st)
	if back.StatusCode != 200 || st.Revision != "2" || st.Position.Value.Anchor.Locator.CFI.CFI != "epubcfi(/6/2!/4/2)" {
		t.Fatalf("backward seek: %d %s", back.StatusCode, back.Body)
	}

	// Identical retry replays the original body and does not advance the revision.
	replay := r.putPos(t, r.userA, w1)
	if replay.StatusCode != 200 || string(replay.Body) != string(first.Body) {
		t.Fatalf("replay: %d %s want %s", replay.StatusCode, replay.Body, first.Body)
	}
	e.Do("GET", "/editions/"+r.ed.ID+"/position", r.userA, nil).JSON(t, &st)
	if st.Revision != "2" {
		t.Fatalf("replay advanced the revision: %s", st.Revision)
	}
	// Same operation ID with different semantics, or another resource kind, is refused.
	changed := r.posBody(op1, "0", v, r.cfi("/6/99!/4/2"))
	if x := r.putPos(t, r.userA, changed); x.StatusCode != 409 || x.Code() != "operation_id_reused" {
		t.Fatalf("reuse: %d %s", x.StatusCode, x.Body)
	}
	if x := e.Do("PUT", "/editions/"+r.ed.ID+"/completion", r.userA, map[string]any{"operationId": op1, "baseRevision": "0",
		"fileId": r.ed.File.ID, "contentVersion": v, "event": "manual_finish", "capturedAt": "2026-11-14T10:00:00Z"}); x.StatusCode != 409 || x.Code() != "operation_id_reused" {
		t.Fatalf("cross-kind reuse: %d %s", x.StatusCode, x.Body)
	}

	// Malformed and mismatched bodies are 422 and leave no receipt behind.
	opBad := uuid.NewString()
	bad := r.posBody(opBad, "2", v, r.cfi("/6/4!/4/2"))
	bad["anchor"].(map[string]any)["fileId"] = uuid.NewString()
	if x := r.putPos(t, r.userA, bad); x.StatusCode != 422 {
		t.Fatalf("wrong file: %d %s", x.StatusCode, x.Body)
	}
	if x := r.putPos(t, r.userA, r.posBody(opBad, "2", v, r.cfi("/6/4!/4/2"))); x.StatusCode != 200 {
		t.Fatalf("op id reusable after 422: %d %s", x.StatusCode, x.Body)
	}
	// The revision is now 3; a write based on 0 is stale and kept as a durable candidate.
	stale := r.posBody(uuid.NewString(), "0", v, r.cfi("/6/20!/4/2"))
	sx := r.putPos(t, r.userA, stale)
	p := problemMap(t, sx)
	if sx.StatusCode != 409 || p["code"] != "stale_revision" || p["currentRevision"] != "3" || p["conflictId"] == nil {
		t.Fatalf("stale: %d %s", sx.StatusCode, sx.Body)
	}
	if again := r.putPos(t, r.userA, stale); again.StatusCode != 409 || problemMap(t, again)["conflictId"] != p["conflictId"] {
		t.Fatalf("stale replay changed conflict: %s", again.Body)
	}
	// An incompatible locator kind is 412 locator_incompatible with its own candidate.
	pdf := r.putPos(t, r.userA, r.posBody(uuid.NewString(), "3", v, map[string]any{"kind": "pdf-page", "version": 1, "pageIndex": 1, "x": 0.1, "y": 0.2}))
	if pp := problemMap(t, pdf); pdf.StatusCode != 412 || pp["code"] != "locator_incompatible" {
		t.Fatalf("locator: %d %s", pdf.StatusCode, pdf.Body)
	}

	// Conflicts belong to their owner and block nothing; open conflicts are counted.
	e.Do("GET", "/editions/"+r.ed.ID+"/position", r.userA, nil).JSON(t, &st)
	if st.UnresolvedConflictCount != 2 {
		t.Fatalf("conflict count: %d", st.UnresolvedConflictCount)
	}
	var cs wire.PersonalConflicts
	e.Do("GET", "/personal-conflicts?resourceId="+r.ed.ID, r.userA, nil).JSON(t, &cs)
	if cs.Total != 2 || cs.Items[0].Candidate.Position == nil {
		t.Fatalf("conflicts: %+v", cs)
	}
	var other wire.PersonalConflicts
	e.Do("GET", "/personal-conflicts", r.admin, nil).JSON(t, &other)
	if other.Total != 0 {
		t.Fatalf("conflicts leaked across accounts: %+v", other)
	}
	staleID := p["conflictId"].(string)
	if x := e.Do("POST", "/personal-conflicts/"+staleID+"/resolve", r.admin, map[string]any{"operationId": uuid.NewString(), "baseRevision": "3", "choice": "keep_server", "contentVersion": nil}); x.StatusCode != 404 {
		t.Fatalf("other user resolve: %d %s", x.StatusCode, x.Body)
	}

	// use_candidate with the wrong base creates a new durable conflict and keeps the original.
	lateOp := uuid.NewString()
	late := map[string]any{"operationId": lateOp, "baseRevision": "2", "choice": "use_candidate", "contentVersion": nil}
	if x := e.Do("POST", "/personal-conflicts/"+staleID+"/resolve", r.userA, late); x.StatusCode != 409 || problemMap(t, x)["conflictId"] == staleID {
		t.Fatalf("resolve race: %d %s", x.StatusCode, x.Body)
	}
	// With the current base the retained candidate is reapplied as a normal write.
	useOp := uuid.NewString()
	use := map[string]any{"operationId": useOp, "baseRevision": "3", "choice": "use_candidate", "contentVersion": v}
	res := e.Do("POST", "/personal-conflicts/"+staleID+"/resolve", r.userA, use)
	var rv wire.ResolvedPersonalConflict
	res.JSON(t, &rv)
	if res.StatusCode != 200 || rv.Revision != "4" || rv.ResourceKind != "position" {
		t.Fatalf("resolve: %d %s", res.StatusCode, res.Body)
	}
	e.Do("GET", "/editions/"+r.ed.ID+"/position", r.userA, nil).JSON(t, &st)
	if st.Revision != "4" || st.Position.Value.Anchor.Locator.CFI.CFI != "epubcfi(/6/20!/4/2)" {
		t.Fatalf("candidate not applied: %+v", st)
	}
	if rep := e.Do("POST", "/personal-conflicts/"+staleID+"/resolve", r.userA, use); rep.StatusCode != 200 || string(rep.Body) != string(res.Body) {
		t.Fatalf("resolve replay: %d %s", rep.StatusCode, rep.Body)
	}
	diff := map[string]any{"operationId": uuid.NewString(), "baseRevision": "4", "choice": "keep_server", "contentVersion": nil}
	if x := e.Do("POST", "/personal-conflicts/"+staleID+"/resolve", r.userA, diff); x.StatusCode != 409 || x.Code() != "conflict_resolved" {
		t.Fatalf("already resolved: %d %s", x.StatusCode, x.Body)
	}

	// keep_server resolves without replacing state.
	var open wire.PersonalConflicts
	e.Do("GET", "/personal-conflicts?resourceId="+r.ed.ID, r.userA, nil).JSON(t, &open)
	if open.Total == 0 {
		t.Fatal("expected remaining open conflicts")
	}
	keep := e.Do("POST", "/personal-conflicts/"+open.Items[0].ID+"/resolve", r.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "4", "choice": "keep_server", "contentVersion": nil})
	keep.JSON(t, &rv)
	if keep.StatusCode != 200 || rv.Revision != "4" {
		t.Fatalf("keep_server: %d %s", keep.StatusCode, keep.Body)
	}

	// Authorization: no grant, no write, no receipt for that account.
	if x := r.putPos(t, r.userB, r.posBody(uuid.NewString(), "0", v, r.cfi("/6/2"))); x.StatusCode != 403 {
		t.Fatalf("ungranted write: %d %s", x.StatusCode, x.Body)
	}
	if x := e.Do("GET", "/editions/"+r.ed.ID+"/position", r.userB, nil); x.StatusCode != 403 {
		t.Fatalf("ungranted read: %d", x.StatusCode)
	}
	// State is per user: the other granted account starts at revision 0.
	var adminSt wire.ReadingPositionState
	e.Do("GET", "/editions/"+r.ed.ID+"/position", r.admin, nil).JSON(t, &adminSt)
	if adminSt.Revision != "0" || adminSt.Position.Value != nil {
		t.Fatalf("state leaked across users: %+v", adminSt)
	}

	// The reader snapshot and edition now show the saved state.
	var rd wire.ReaderSnapshot
	e.Do("GET", "/editions/"+r.ed.ID+"/reader", r.userA, nil).JSON(t, &rd)
	if rd.Position.Revision != "4" || rd.Position.Position.Value == nil {
		t.Fatalf("reader snapshot: %+v", rd.Position)
	}
}

func TestEditionContentChangeInvalidatesLocationsAndCompletionHistory(t *testing.T) {
	r := newReadingEnv(t)
	e, v := r.e, r.ed.File.ContentVersion
	if x := r.putPos(t, r.userA, r.posBody(uuid.NewString(), "0", v, r.cfi("/6/8!/4/2"))); x.StatusCode != 200 {
		t.Fatalf("write: %d %s", x.StatusCode, x.Body)
	}

	// Manual finish/unfinish: revisioned, history is additive, location is kept.
	fin := func(op, base, event, version string) apitest.Response {
		return e.Do("PUT", "/editions/"+r.ed.ID+"/completion", r.userA, map[string]any{"operationId": op, "baseRevision": base,
			"fileId": r.ed.File.ID, "contentVersion": version, "event": event, "capturedAt": "2026-11-14T11:00:00Z"})
	}
	var c wire.ReadingCompletion
	x := fin(uuid.NewString(), "0", "manual_finish", v)
	x.JSON(t, &c)
	if x.StatusCode != 200 || c.Revision != "1" || !c.Finished || c.ChangedAt == nil {
		t.Fatalf("finish: %d %s", x.StatusCode, x.Body)
	}
	if y := fin(uuid.NewString(), "0", "manual_unfinish", v); y.StatusCode != 409 || y.Code() != "stale_revision" {
		t.Fatalf("stale completion: %d %s", y.StatusCode, y.Body)
	}
	fin(uuid.NewString(), "1", "manual_unfinish", v).JSON(t, &c)
	if c.Revision != "2" || c.Finished {
		t.Fatalf("unfinish: %+v", c)
	}
	fin(uuid.NewString(), "2", "manual_finish", v)
	var st wire.ReadingPositionState
	e.Do("GET", "/editions/"+r.ed.ID+"/position", r.userA, nil).JSON(t, &st)
	if st.Revision != "1" || st.Position.Value == nil {
		t.Fatalf("completion moved or cleared the location: %+v", st)
	}
	var h wire.ReadingHistory
	e.Do("GET", "/titles/"+r.ed.TitleID+"/reading-history", r.userA, nil).JSON(t, &h)
	if h.Total != 3 || h.Items[0].Event != "manual_finish" || h.Items[1].Event != "manual_unfinish" || h.Items[0].EditionID != r.ed.ID {
		t.Fatalf("history: %+v", h)
	}
	var ed wire.Edition
	e.Do("GET", "/editions/"+r.ed.ID, r.userA, nil).JSON(t, &ed)
	if !ed.Completion.Finished || ed.Completion.Revision != "3" {
		t.Fatalf("edition completion: %+v", ed.Completion)
	}
	var otherHist wire.ReadingHistory
	e.Do("GET", "/titles/"+r.ed.TitleID+"/reading-history", r.admin, nil).JSON(t, &otherHist)
	if otherHist.Total != 0 {
		t.Fatalf("history leaked: %+v", otherHist)
	}

	// Replace the file's bytes: the old version can no longer be written, and a
	// retained candidate is never transferred to the new bytes.
	time.Sleep(10 * time.Millisecond)
	b, _ := os.ReadFile(r.book)
	_ = os.WriteFile(r.book, append(b, []byte("PADDING")...), 0o644)
	scanTwice(t, e, r.admin, r.lib)
	scanTwice(t, e, r.admin, r.lib)
	e.Do("GET", "/editions/"+r.ed.ID, r.userA, nil).JSON(t, &ed)
	if ed.File.ContentVersion == v {
		t.Fatal("expected a new content version")
	}
	old := r.putPos(t, r.userA, r.posBody(uuid.NewString(), "1", v, r.cfi("/6/30!/4/2")))
	p := problemMap(t, old)
	if old.StatusCode != 412 || p["code"] != "content_changed" || p["currentContentVersion"] != ed.File.ContentVersion || p["conflictId"] == nil {
		t.Fatalf("old version: %d %s", old.StatusCode, old.Body)
	}
	use := e.Do("POST", "/personal-conflicts/"+p["conflictId"].(string)+"/resolve", r.userA,
		map[string]any{"operationId": uuid.NewString(), "baseRevision": "1", "choice": "use_candidate", "contentVersion": ed.File.ContentVersion})
	if use.StatusCode != 412 || problemMap(t, use)["code"] != "content_changed" {
		t.Fatalf("candidate transferred to changed bytes: %d %s", use.StatusCode, use.Body)
	}
	e.Do("GET", "/editions/"+r.ed.ID+"/position", r.userA, nil).JSON(t, &st)
	if st.Revision != "1" {
		t.Fatalf("position changed on a refused resolve: %+v", st)
	}
	// A write against the new version succeeds from the same revision.
	if ok := r.putPos(t, r.userA, r.posBody(uuid.NewString(), "1", ed.File.ContentVersion, r.cfi("/6/2!/4/2"))); ok.StatusCode != 200 {
		t.Fatalf("new version write: %d %s", ok.StatusCode, ok.Body)
	}
}

// Concurrent writers from the same base: exactly one wins, the rest get durable
// stale conflicts; concurrent retries of one operation all replay one result.
func TestEditionPositionConcurrency(t *testing.T) {
	r := newReadingEnv(t)
	v := r.ed.File.ContentVersion
	type res struct {
		status int
		body   string
	}
	run := func(bodies []map[string]any) []res {
		out := make([]res, len(bodies))
		done := make(chan struct{})
		for i := range bodies {
			go func(i int) {
				x := r.putPos(t, r.userA, bodies[i])
				out[i] = res{x.StatusCode, string(x.Body)}
				done <- struct{}{}
			}(i)
		}
		for range bodies {
			<-done
		}
		return out
	}
	var bodies []map[string]any
	for i := 0; i < 8; i++ {
		bodies = append(bodies, r.posBody(uuid.NewString(), "0", v, r.cfi("/6/"+string(rune('2'+2*i))+"!/4/2")))
	}
	wins, stale := 0, 0
	for _, x := range run(bodies) {
		switch x.status {
		case 200:
			wins++
		case 409:
			stale++
		default:
			t.Fatalf("unexpected: %d %s", x.status, x.body)
		}
	}
	if wins != 1 || stale != 7 {
		t.Fatalf("wins=%d stale=%d", wins, stale)
	}
	var st wire.ReadingPositionState
	r.e.Do("GET", "/editions/"+r.ed.ID+"/position", r.userA, nil).JSON(t, &st)
	if st.Revision != "1" || st.UnresolvedConflictCount != 7 {
		t.Fatalf("state: %+v", st)
	}
	same := r.posBody(uuid.NewString(), "1", v, r.cfi("/6/40!/4/2"))
	results := run([]map[string]any{same, same, same, same, same, same})
	for _, x := range results {
		if x.status != 200 || x.body != results[0].body {
			t.Fatalf("concurrent retries differ: %+v", results)
		}
	}
	r.e.Do("GET", "/editions/"+r.ed.ID+"/position", r.userA, nil).JSON(t, &st)
	if st.Revision != "2" {
		t.Fatalf("retries advanced the revision more than once: %s", st.Revision)
	}
}
