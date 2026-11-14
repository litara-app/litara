package httpapi_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func repairFiles(s wire.Recording) []map[string]any {
	out := []map[string]any{}
	for _, f := range s.Files {
		out = append(out, map[string]any{"fileId": f.ID, "contentVersion": f.ContentVersion})
	}
	return out
}

func repairPlan(op, kind string, sources []wire.Recording, outputs ...map[string]any) map[string]any {
	srcs := []map[string]any{}
	for _, s := range sources {
		srcs = append(srcs, map[string]any{"recordingId": s.ID, "layoutRevision": s.LayoutRevision})
	}
	return map[string]any{"operationId": op, "kind": kind, "sources": srcs, "outputs": outputs}
}

func out(key string, files ...[]map[string]any) map[string]any {
	all := []map[string]any{}
	for _, f := range files {
		all = append(all, f...)
	}
	return map[string]any{"key": key, "label": "Label " + key, "files": all}
}

func apply(base string) map[string]any {
	return map[string]any{"operationId": uuid.NewString(), "baseRevision": base}
}

func TestRecordingRepairMergeSplitAndRetainedState(t *testing.T) {
	e := apitest.New(t)
	admin := e.Login(seed.AdminName, "cli").AccessToken
	a := e.Login(seed.UserAName, "phone A").AccessToken
	b := e.Login(seed.UserBName, "tablet B").AccessToken
	lib1 := e.Fix.Lib1.String()
	tf, alt := snapshot(t, e, a, e.Fix.ThreeFile), snapshot(t, e, a, e.Fix.Alternate)
	incomplete := snapshot(t, e, a, e.Fix.Incomplete)

	// Authority: the administrator needs a grant on the library as well.
	merge := repairPlan(uuid.NewString(), "merge", []wire.Recording{tf, alt}, out("m", repairFiles(tf), repairFiles(alt)))
	if x := e.Do("POST", "/admin/recording-repairs", a, merge); x.StatusCode != 403 {
		t.Fatalf("non-admin: %d %s", x.StatusCode, x.Body)
	}
	if x := e.Do("POST", "/admin/recording-repairs", admin, merge); x.StatusCode != 403 {
		t.Fatalf("admin without a grant: %d %s", x.StatusCode, x.Body)
	}
	for _, u := range []string{e.Fix.AdminID.String(), e.Fix.UserBID.String()} {
		if x := e.Do("PUT", "/admin/users/"+u+"/libraries/"+lib1, admin, nil); x.StatusCode != http.StatusNoContent {
			t.Fatalf("grant %s: %d %s", u, x.StatusCode, x.Body)
		}
	}

	// Two accounts with different source state.
	pos := func(token string, rec wire.Recording, file wire.File, offset int64) {
		x := e.Do("PUT", "/recordings/"+rec.ID+"/position", token, wire.PositionWrite{OperationID: uuid.NewString(), BaseRevision: "0", LayoutRevision: rec.LayoutRevision,
			Position: wire.PositionInput{FileID: file.ID, ContentVersion: file.ContentVersion, OffsetMs: offset, CapturedAt: "2026-11-14T10:00:00Z"}})
		if x.StatusCode != 200 {
			t.Fatalf("position: %d %s", x.StatusCode, x.Body)
		}
	}
	pos(a, tf, tf.Files[1], 5000)
	pos(b, alt, alt.Files[0], 1000)
	fin := e.Do("PUT", "/recordings/"+tf.ID+"/completion", b, wire.CompletionWrite{OperationID: uuid.NewString(), BaseRevision: "0", LayoutRevision: tf.LayoutRevision,
		Event: "manual_finish", CapturedAt: "2026-11-14T10:00:00Z"})
	if fin.StatusCode != 200 {
		t.Fatalf("finish: %d %s", fin.StatusCode, fin.Body)
	}

	// Validation: nothing but a complete one-to-one partition of same-title, same-library sources is accepted.
	bad := map[string]map[string]any{
		"one source merge":    repairPlan(uuid.NewString(), "merge", []wire.Recording{tf}, out("m", repairFiles(tf))),
		"duplicate source":    repairPlan(uuid.NewString(), "merge", []wire.Recording{tf, tf}, out("m", repairFiles(tf))),
		"dropped file":        repairPlan(uuid.NewString(), "merge", []wire.Recording{tf, alt}, out("m", repairFiles(tf)[:2], repairFiles(alt))),
		"duplicated file":     repairPlan(uuid.NewString(), "merge", []wire.Recording{tf, alt}, out("m", repairFiles(tf), repairFiles(tf)[:1], repairFiles(alt))),
		"unknown file":        repairPlan(uuid.NewString(), "merge", []wire.Recording{tf, alt}, out("m", repairFiles(tf), repairFiles(alt), []map[string]any{{"fileId": uuid.NewString(), "contentVersion": uuid.NewString()}})),
		"wrong version":       repairPlan(uuid.NewString(), "merge", []wire.Recording{tf, alt}, out("m", []map[string]any{{"fileId": tf.Files[0].ID, "contentVersion": uuid.NewString()}}, repairFiles(tf)[1:], repairFiles(alt))),
		"two outputs merge":   repairPlan(uuid.NewString(), "merge", []wire.Recording{tf, alt}, out("a", repairFiles(tf)), out("b", repairFiles(alt))),
		"one output split":    repairPlan(uuid.NewString(), "split", []wire.Recording{tf}, out("a", repairFiles(tf))),
		"duplicate keys":      repairPlan(uuid.NewString(), "split", []wire.Recording{tf}, out("a", repairFiles(tf)[:1]), out("a", repairFiles(tf)[1:])),
		"cross title/library": repairPlan(uuid.NewString(), "merge", []wire.Recording{tf, snapshot(t, e, b, e.Fix.OtherLibrary)}, out("m", repairFiles(tf))),
	}
	for name, body := range bad {
		if x := e.Do("POST", "/admin/recording-repairs", admin, body); x.StatusCode != 422 && x.StatusCode != 403 {
			t.Fatalf("%s: %d %s", name, x.StatusCode, x.Body)
		}
	}
	stale := repairPlan(uuid.NewString(), "merge", []wire.Recording{tf, alt}, out("m", repairFiles(tf), repairFiles(alt)))
	stale["sources"].([]map[string]any)[0]["layoutRevision"] = uuid.NewString()
	if x := e.Do("POST", "/admin/recording-repairs", admin, stale); x.StatusCode != 412 || x.Code() != "layout_changed" {
		t.Fatalf("stale layout: %d %s", x.StatusCode, x.Body)
	}

	// A valid merge: plan, replay, approve, execute.
	pl := e.Do("POST", "/admin/recording-repairs", admin, merge)
	var plan wire.T005RepairPlan
	pl.JSON(t, &plan)
	if pl.StatusCode != 201 || plan.State != "planned" || plan.Revision != "0" || len(plan.Warnings) == 0 || plan.Kind != "merge" || len(plan.Sources) != 2 {
		t.Fatalf("plan: %d %s", pl.StatusCode, pl.Body)
	}
	if again := e.Do("POST", "/admin/recording-repairs", admin, merge); again.StatusCode != 201 || string(again.Body) != string(pl.Body) {
		t.Fatalf("plan replay: %d", again.StatusCode)
	}
	path := "/admin/recording-repairs/" + plan.ID
	if x := e.Do("GET", path, a, nil); x.StatusCode != 403 {
		t.Fatalf("non-admin plan read: %d", x.StatusCode)
	}
	if x := e.Do("POST", path+"/execute", admin, apply("0")); x.StatusCode != 409 || x.Code() != "plan_state" {
		t.Fatalf("execute before approval: %d %s", x.StatusCode, x.Body)
	}
	if x := e.Do("POST", path+"/approve", admin, apply("7")); x.StatusCode != 409 || x.Code() != "stale_revision" {
		t.Fatalf("stale approve: %d %s", x.StatusCode, x.Body)
	}
	ap := e.Do("POST", path+"/approve", admin, apply("0"))
	ap.JSON(t, &plan)
	if ap.StatusCode != 200 || plan.State != "approved" || plan.Revision != "1" {
		t.Fatalf("approve: %d %s", ap.StatusCode, ap.Body)
	}
	exOp := map[string]any{"operationId": uuid.NewString(), "baseRevision": "1"}
	ex := e.Do("POST", path+"/execute", admin, exOp)
	var done wire.T005RepairPlan
	ex.JSON(t, &done)
	if ex.StatusCode != 200 || done.State != "applied" || len(done.Result) != 1 || done.Result[0].Key != "m" {
		t.Fatalf("execute: %d %s", ex.StatusCode, ex.Body)
	}
	succ := done.Result[0].RecordingID
	if again := e.Do("POST", path+"/execute", admin, exOp); again.StatusCode != 200 || string(again.Body) != string(ex.Body) {
		t.Fatalf("execute replay changed the successor IDs: %d %s", again.StatusCode, again.Body)
	}
	if x := e.Do("POST", path+"/execute", admin, apply(done.Revision)); x.StatusCode != 409 || x.Code() != "plan_state" {
		t.Fatalf("second execute: %d %s", x.StatusCode, x.Body)
	}
	if x := e.Do("POST", path+"/cancel", admin, apply(done.Revision)); x.StatusCode != 409 {
		t.Fatalf("cancel after apply: %d %s", x.StatusCode, x.Body)
	}

	// Active listings show the successor, never the tombstoned sources.
	var list wire.Recordings
	e.Do("GET", "/recordings?size=200", a, nil).JSON(t, &list)
	ids := map[string]bool{}
	for _, r := range list.Items {
		ids[r.ID] = true
	}
	if !ids[succ] || ids[tf.ID] || ids[alt.ID] || !ids[incomplete.ID] {
		t.Fatalf("listing: %v", ids)
	}
	var ssnap wire.Recording
	e.Do("GET", "/recordings/"+succ, a, nil).JSON(t, &ssnap)
	if len(ssnap.Files) != len(tf.Files)+len(alt.Files) || ssnap.Completion.Finished || ssnap.Completion.Revision != "0" {
		t.Fatalf("successor snapshot: files %d finished %v", len(ssnap.Files), ssnap.Completion.Finished)
	}
	for i, f := range append(append([]wire.File{}, tf.Files...), alt.Files...) {
		if ssnap.Files[i].ID != f.ID || ssnap.Files[i].ContentVersion != f.ContentVersion {
			t.Fatalf("file identity or order changed at %d", i)
		}
	}

	// No canonical resume; each account is offered only its own source position as an explicit candidate.
	var st wire.PositionState
	e.Do("GET", "/recordings/"+succ+"/position", a, nil).JSON(t, &st)
	if st.Revision != "0" || st.Position.Value != nil || len(st.UnresolvedConflicts) != 1 || st.UnresolvedConflicts[0].Candidate.Value.OffsetMs != 5000 ||
		st.UnresolvedConflicts[0].Candidate.Value.LayoutRevision != ssnap.LayoutRevision {
		t.Fatalf("A candidates: %+v", st)
	}
	var stB wire.PositionState
	e.Do("GET", "/recordings/"+succ+"/position", b, nil).JSON(t, &stB)
	if len(stB.UnresolvedConflicts) != 1 || stB.UnresolvedConflicts[0].Candidate.Value.OffsetMs != 1000 {
		t.Fatalf("B candidates: %+v", stB)
	}
	var compB wire.CompletionState
	e.Do("GET", "/recordings/"+succ+"/completion", b, nil).JSON(t, &compB)
	if compB.Finished {
		t.Fatal("a source completion was applied to the successor")
	}
	// Explicitly choosing the candidate yields normal revisioned state.
	rs := e.Do("POST", "/recordings/"+succ+"/conflicts/"+st.UnresolvedConflicts[0].ID+"/resolve", a, wire.ResolveConflict{OperationID: uuid.NewString(), BaseRevision: "0",
		LayoutRevision: ssnap.LayoutRevision, Choice: "use_candidate"})
	var after wire.PositionState
	rs.JSON(t, &after)
	if rs.StatusCode != 200 || after.Revision != "1" || after.Position.Value == nil || after.Position.Value.OffsetMs != 5000 {
		t.Fatalf("resolve: %d %s", rs.StatusCode, rs.Body)
	}

	// Old clients get explicit errors and the sources' retained state stays readable.
	old := e.Do("GET", "/recordings/"+tf.ID, a, nil)
	if old.StatusCode != 409 || old.Code() != "recording_repaired" || problemMap(t, old)["successorRecordingIds"].([]any)[0] != succ {
		t.Fatalf("old snapshot: %d %s", old.StatusCode, old.Body)
	}
	w := e.Do("PUT", "/recordings/"+tf.ID+"/position", a, wire.PositionWrite{OperationID: uuid.NewString(), BaseRevision: "1", LayoutRevision: tf.LayoutRevision,
		Position: wire.PositionInput{FileID: tf.Files[0].ID, ContentVersion: tf.Files[0].ContentVersion, OffsetMs: 100, CapturedAt: "2026-11-14T11:00:00Z"}})
	wp := problemMap(t, w)
	if w.StatusCode != 412 || wp["code"] != "recording_repaired" || wp["conflictId"] == nil || wp["successorRecordingIds"].([]any)[0] != succ {
		t.Fatalf("old write: %d %s", w.StatusCode, w.Body)
	}
	var oldState wire.PositionState
	e.Do("GET", "/recordings/"+tf.ID+"/position", a, nil).JSON(t, &oldState)
	if oldState.Revision != "1" || oldState.Position.Value == nil || oldState.Position.Value.OffsetMs != 5000 || len(oldState.UnresolvedConflicts) != 1 {
		t.Fatalf("retained source state or candidate lost: %+v", oldState)
	}
	var oldComp wire.CompletionState
	e.Do("GET", "/recordings/"+tf.ID+"/completion", b, nil).JSON(t, &oldComp)
	if !oldComp.Finished {
		t.Fatal("source completion was not retained")
	}
	cw := e.Do("PUT", "/recordings/"+tf.ID+"/completion", b, wire.CompletionWrite{OperationID: uuid.NewString(), BaseRevision: "1", LayoutRevision: tf.LayoutRevision,
		Event: "manual_unfinish", CapturedAt: "2026-11-14T11:00:00Z"})
	if cw.StatusCode != 412 || cw.Code() != "recording_repaired" {
		t.Fatalf("old completion write: %d %s", cw.StatusCode, cw.Body)
	}
	var hist wire.History
	e.Do("GET", "/titles/"+tf.TitleID+"/history", b, nil).JSON(t, &hist)
	if hist.Total != 1 {
		t.Fatalf("source history was not retained: %+v", hist)
	}
	if x := snapshot(t, e, a, e.Fix.Incomplete); x.ID != incomplete.ID {
		t.Fatal("an unrelated recording changed")
	}
	// A user who loses access never sees successor hints.
	if x := e.Do("DELETE", "/admin/users/"+e.Fix.UserBID.String()+"/libraries/"+lib1, admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke: %d", x.StatusCode)
	}
	if x := e.Do("GET", "/recordings/"+tf.ID, b, nil); x.StatusCode != 403 || problemMap(t, x)["successorRecordingIds"] != nil {
		t.Fatalf("successor hint without access: %d %s", x.StatusCode, x.Body)
	}

	// Split the successor two ways with two competing plans: the second is obsolete after the first applies.
	time.Sleep(5 * time.Millisecond)
	s1 := repairPlan(uuid.NewString(), "split", []wire.Recording{ssnap}, out("head", repairFiles(ssnap)[:1]), out("tail", repairFiles(ssnap)[1:]))
	s2 := repairPlan(uuid.NewString(), "split", []wire.Recording{ssnap}, out("x", repairFiles(ssnap)[:2]), out("y", repairFiles(ssnap)[2:]))
	var p1, p2 wire.T005RepairPlan
	e.Do("POST", "/admin/recording-repairs", admin, s1).JSON(t, &p1)
	e.Do("POST", "/admin/recording-repairs", admin, s2).JSON(t, &p2)
	for _, p := range []wire.T005RepairPlan{p1, p2} {
		if x := e.Do("POST", "/admin/recording-repairs/"+p.ID+"/approve", admin, apply("0")); x.StatusCode != 200 {
			t.Fatalf("approve split: %d %s", x.StatusCode, x.Body)
		}
	}
	var d1 wire.T005RepairPlan
	e.Do("POST", "/admin/recording-repairs/"+p1.ID+"/execute", admin, apply("1")).JSON(t, &d1)
	if d1.State != "applied" || len(d1.Result) != 2 {
		t.Fatalf("split: %+v", d1)
	}
	lose := e.Do("POST", "/admin/recording-repairs/"+p2.ID+"/execute", admin, apply("1"))
	if lose.StatusCode != 412 || lose.Code() != "recording_repaired" {
		t.Fatalf("obsolete plan: %d %s", lose.StatusCode, lose.Body)
	}
	var stalePlan wire.T005RepairPlan
	e.Do("GET", "/admin/recording-repairs/"+p2.ID, admin, nil).JSON(t, &stalePlan)
	if stalePlan.State != "stale" {
		t.Fatalf("plan state after a lost race: %s", stalePlan.State)
	}
	// Split successors carry A's resolved position only where the file belongs; the one the split sent file 0 to is "head".
	var head wire.PositionState
	e.Do("GET", "/recordings/"+d1.Result[0].RecordingID+"/position", a, nil).JSON(t, &head)
	var tail wire.PositionState
	e.Do("GET", "/recordings/"+d1.Result[1].RecordingID+"/position", a, nil).JSON(t, &tail)
	if len(head.UnresolvedConflicts)+len(tail.UnresolvedConflicts) != 1 {
		t.Fatalf("expected exactly one candidate across the split successors: %d + %d", len(head.UnresolvedConflicts), len(tail.UnresolvedConflicts))
	}

	// Cancel works before application and blocks execution.
	var tailSnap wire.Recording
	e.Do("GET", "/recordings/"+d1.Result[1].RecordingID, a, nil).JSON(t, &tailSnap)
	if len(tailSnap.Files) >= 2 {
		cp := e.Do("POST", "/admin/recording-repairs", admin, repairPlan(uuid.NewString(), "split", []wire.Recording{tailSnap},
			out("c1", repairFiles(tailSnap)[:1]), out("c2", repairFiles(tailSnap)[1:])))
		var cplan wire.T005RepairPlan
		cp.JSON(t, &cplan)
		cc := e.Do("POST", "/admin/recording-repairs/"+cplan.ID+"/cancel", admin, apply("0"))
		var cancelled wire.T005RepairPlan
		cc.JSON(t, &cancelled)
		if cc.StatusCode != 200 || cancelled.State != "cancelled" {
			t.Fatalf("cancel: %d %s", cc.StatusCode, cc.Body)
		}
		if x := e.Do("POST", "/admin/recording-repairs/"+cplan.ID+"/approve", admin, apply(cancelled.Revision)); x.StatusCode != 409 || x.Code() != "plan_state" {
			t.Fatalf("approve after cancel: %d %s", x.StatusCode, x.Body)
		}
		if x := e.Do("GET", "/recordings/"+tailSnap.ID, a, nil); x.StatusCode != 200 {
			t.Fatalf("cancelling changed the recording: %d", x.StatusCode)
		}
	}
}
