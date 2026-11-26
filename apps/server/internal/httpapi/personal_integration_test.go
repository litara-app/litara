package httpapi_test

import (
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func (r *readingEnv) annBody(op, base, version, kind, text string, sel any) map[string]any {
	return map[string]any{"operationId": op, "baseRevision": base, "capturedAt": "2026-11-14T10:00:00Z",
		"data": map[string]any{"kind": kind, "text": text, "quote": "quoted words", "selection": sel,
			"anchor": map[string]any{"fileId": r.ed.File.ID, "contentVersion": version, "locator": r.cfi("/6/8!/4/2")}}}
}

func (r *readingEnv) putAnn(token, id string, body map[string]any) apitest.Response {
	return r.e.Do("PUT", "/editions/"+r.ed.ID+"/annotations/"+id, token, body)
}

func delBody(op, base string) map[string]any {
	return map[string]any{"operationId": op, "baseRevision": base, "capturedAt": "2026-11-14T10:00:00Z"}
}

var rangeSel = map[string]any{"kind": "foliate-range", "version": 1, "cfi": "epubcfi(/6/8!/4/2,/1:0,/1:5)"}

func TestAnnotationLifecyclePrivacyAndSupersession(t *testing.T) {
	r := newReadingEnv(t)
	e, v := r.e, r.ed.File.ContentVersion
	id := uuid.NewString()

	// Creation: base 0 only; the client UUID makes it replayable.
	op := uuid.NewString()
	create := r.annBody(op, "0", v, "highlight", "my thought", rangeSel)
	x := r.putAnn(r.userA, id, create)
	var ann wire.Annotation
	x.JSON(t, &ann)
	if x.StatusCode != 200 || ann.Revision != "1" || ann.Deleted || ann.Data.Value == nil || ann.Data.Value.Selection.Value == nil {
		t.Fatalf("create: %d %s", x.StatusCode, x.Body)
	}
	if replay := r.putAnn(r.userA, id, create); replay.StatusCode != 200 || string(replay.Body) != string(x.Body) {
		t.Fatalf("replay: %d %s", replay.StatusCode, replay.Body)
	}
	// Creating again at base 0 with a new operation is stale (the ID exists).
	if dup := r.putAnn(r.userA, id, r.annBody(uuid.NewString(), "0", v, "highlight", "x", rangeSel)); dup.StatusCode != 409 || dup.Code() != "stale_revision" {
		t.Fatalf("duplicate create: %d %s", dup.StatusCode, dup.Body)
	}

	// Validation: each failure is 422 and creates no receipt or candidate.
	for name, body := range map[string]map[string]any{
		"highlight without selection": r.annBody(uuid.NewString(), "0", v, "highlight", "", nil),
		"empty note":                  r.annBody(uuid.NewString(), "0", v, "note", "  ", nil),
		"bookmark with selection":     r.annBody(uuid.NewString(), "0", v, "bookmark", "", rangeSel),
	} {
		if y := r.putAnn(r.userA, uuid.NewString(), body); y.StatusCode != 422 {
			t.Fatalf("%s: %d %s", name, y.StatusCode, y.Body)
		}
	}
	if y := r.putAnn(r.userA, id, r.annBody(uuid.NewString(), "1", v, "note", "now a note", nil)); y.StatusCode != 422 {
		t.Fatalf("kind change: %d %s", y.StatusCode, y.Body)
	}
	bm := r.putAnn(r.userA, uuid.NewString(), r.annBody(uuid.NewString(), "0", v, "bookmark", "", nil))
	if bm.StatusCode != 200 {
		t.Fatalf("bookmark may have empty text: %d %s", bm.StatusCode, bm.Body)
	}

	// Update at the right base, then a stale update keeps its candidate.
	up := r.putAnn(r.userA, id, r.annBody(uuid.NewString(), "1", v, "highlight", "edited", rangeSel))
	up.JSON(t, &ann)
	if up.StatusCode != 200 || ann.Revision != "2" || ann.Data.Value.Text != "edited" {
		t.Fatalf("update: %d %s", up.StatusCode, up.Body)
	}
	stale := r.putAnn(r.userA, id, r.annBody(uuid.NewString(), "1", v, "highlight", "from an old tab", rangeSel))
	sp := problemMap(t, stale)
	if stale.StatusCode != 409 || sp["code"] != "stale_revision" || sp["currentRevision"] != "2" || sp["conflictId"] == nil {
		t.Fatalf("stale: %d %s", stale.StatusCode, stale.Body)
	}
	var conflicts wire.PersonalConflicts
	e.Do("GET", "/personal-conflicts?resourceId="+id, r.userA, nil).JSON(t, &conflicts)
	if len(conflicts.Items) != 2 || conflicts.Items[1].ResourceKind != "annotation" || conflicts.Items[1].Candidate.Annotation == nil ||
		conflicts.Items[1].Candidate.Annotation.Data.Text != "from an old tab" { // [0] is the duplicate-create attempt
		t.Fatalf("conflict list: %+v", conflicts)
	}
	// Choosing the candidate reapplies it as a normal revision.
	res := e.Do("POST", "/personal-conflicts/"+sp["conflictId"].(string)+"/resolve", r.userA,
		map[string]any{"operationId": uuid.NewString(), "baseRevision": "2", "choice": "use_candidate", "contentVersion": v})
	var rv wire.ResolvedPersonalConflict
	res.JSON(t, &rv)
	if res.StatusCode != 200 || rv.Revision != "3" {
		t.Fatalf("resolve: %d %s", res.StatusCode, res.Body)
	}

	// Privacy: annotations never cross accounts. The administrator holds a grant
	// but has no access to a private annotation; a user without a grant is refused.
	if g := e.Do("GET", "/editions/"+r.ed.ID+"/annotations/"+id, r.admin, nil); g.StatusCode != 404 {
		t.Fatalf("admin read of a private annotation: %d %s", g.StatusCode, g.Body)
	}
	var adminList wire.Annotations
	e.Do("GET", "/editions/"+r.ed.ID+"/annotations", r.admin, nil).JSON(t, &adminList)
	if adminList.Total != 0 {
		t.Fatalf("admin saw another user annotations: %+v", adminList)
	}
	if g := e.Do("GET", "/editions/"+r.ed.ID+"/annotations", r.userB, nil); g.StatusCode != 403 {
		t.Fatalf("ungranted user: %d %s", g.StatusCode, g.Body)
	}
	if d := e.Do("DELETE", "/editions/"+r.ed.ID+"/annotations/"+id, r.admin, delBody(uuid.NewString(), "3")); d.StatusCode != 404 {
		t.Fatalf("admin delete of a private annotation: %d %s", d.StatusCode, d.Body)
	}

	// Replace the bytes: the annotation stays recoverable but detached, cannot be
	// edited against the old anchor, and can still be deleted.
	time.Sleep(10 * time.Millisecond)
	b, _ := os.ReadFile(r.book)
	_ = os.WriteFile(r.book, append(b, []byte("PADDING")...), 0o644)
	scanTwice(t, e, r.admin, r.lib)
	scanTwice(t, e, r.admin, r.lib)
	var ed wire.Edition
	e.Do("GET", "/editions/"+r.ed.ID, r.userA, nil).JSON(t, &ed)
	nv := ed.File.ContentVersion
	if nv == v {
		t.Fatal("expected a new content version")
	}
	var list wire.Annotations
	e.Do("GET", "/editions/"+r.ed.ID+"/annotations", r.userA, nil).JSON(t, &list)
	detached := 0
	for _, a := range list.Items {
		if a.ID == id && a.Data.Value != nil && a.Data.Value.Anchor.ContentVersion == v {
			detached++
		}
	}
	if detached != 1 {
		t.Fatalf("old-version annotation must stay listed with its old anchor: %+v", list)
	}
	if y := r.putAnn(r.userA, id, r.annBody(uuid.NewString(), "3", nv, "highlight", "repaint", rangeSel)); y.StatusCode != 412 || y.Code() != "content_changed" {
		t.Fatalf("edit of a detached annotation: %d %s", y.StatusCode, y.Body)
	}
	if y := r.putAnn(r.userA, id, r.annBody(uuid.NewString(), "3", v, "highlight", "old", rangeSel)); y.StatusCode != 412 {
		t.Fatalf("old-version write: %d %s", y.StatusCode, y.Body)
	}
	fresh := r.putAnn(r.userA, uuid.NewString(), r.annBody(uuid.NewString(), "0", nv, "note", "on the new text", nil))
	if fresh.StatusCode != 200 {
		t.Fatalf("new-version annotation: %d %s", fresh.StatusCode, fresh.Body)
	}

	// Delete keeps a tombstone; the content is gone from the wire.
	dop := uuid.NewString()
	d := e.Do("DELETE", "/editions/"+r.ed.ID+"/annotations/"+id, r.userA, delBody(dop, "3"))
	d.JSON(t, &ann)
	if d.StatusCode != 200 || !ann.Deleted || ann.Revision != "4" || ann.Data.Value != nil {
		t.Fatalf("delete: %d %s", d.StatusCode, d.Body)
	}
	if rep := e.Do("DELETE", "/editions/"+r.ed.ID+"/annotations/"+id, r.userA, delBody(dop, "3")); rep.StatusCode != 200 || string(rep.Body) != string(d.Body) {
		t.Fatalf("delete replay: %d %s", rep.StatusCode, rep.Body)
	}
	var hidden, all wire.Annotations
	e.Do("GET", "/editions/"+r.ed.ID+"/annotations?includeDeleted=false", r.userA, nil).JSON(t, &hidden)
	e.Do("GET", "/editions/"+r.ed.ID+"/annotations", r.userA, nil).JSON(t, &all)
	if hidden.Total+1 != all.Total {
		t.Fatalf("tombstone filter: hidden %d all %d", hidden.Total, all.Total)
	}
	// A stale edit cannot resurrect it, and choosing that candidate does not either.
	late := r.putAnn(r.userA, id, r.annBody(uuid.NewString(), "3", nv, "highlight", "zombie", rangeSel))
	lp := problemMap(t, late)
	if late.StatusCode != 409 || lp["code"] != "deleted" || lp["conflictId"] == nil {
		t.Fatalf("edit after delete: %d %s", late.StatusCode, late.Body)
	}
	z := e.Do("POST", "/personal-conflicts/"+lp["conflictId"].(string)+"/resolve", r.userA,
		map[string]any{"operationId": uuid.NewString(), "baseRevision": "4", "choice": "use_candidate", "contentVersion": nv})
	if z.StatusCode != 409 || z.Code() != "deleted" {
		t.Fatalf("resurrection through resolve: %d %s", z.StatusCode, z.Body)
	}
	if g := e.Do("GET", "/editions/"+r.ed.ID+"/annotations/"+id, r.userA, nil); g.StatusCode != 200 {
		t.Fatalf("tombstone read: %d", g.StatusCode)
	} else {
		g.JSON(t, &ann)
		if !ann.Deleted || ann.Data.Value != nil {
			t.Fatalf("tombstone was resurrected: %s", g.Body)
		}
	}
}

func (r *readingEnv) shelfBody(op, base, kind, vis, name string, filter any) map[string]any {
	return map[string]any{"operationId": op, "baseRevision": base, "capturedAt": "2026-11-14T10:00:00Z",
		"data": map[string]any{"name": name, "visibility": vis, "kind": kind, "filter": filter}}
}

// rule and group build the library filter format that smart shelves use (ADR-0107).
func rule(field, op string, value any) map[string]any {
	r := map[string]any{"type": "rule", "field": field, "operator": op}
	if value != nil {
		r["value"] = value
	}
	return r
}

func group(join string, rules ...any) map[string]any {
	if rules == nil {
		rules = []any{}
	}
	return map[string]any{"type": "group", "join": join, "rules": rules}
}

func (r *readingEnv) shelfTitles(t *testing.T, token, shelf string) wire.Titles {
	t.Helper()
	var out wire.Titles
	x := r.e.Do("GET", "/shelves/"+shelf+"/titles", token, nil)
	if x.StatusCode != 200 {
		t.Fatalf("shelf titles: %d %s", x.StatusCode, x.Body)
	}
	x.JSON(t, &out)
	return out
}

func titleNames(ts wire.Titles) []string {
	out := []string{}
	for _, x := range ts.Items {
		out = append(out, x.Title)
	}
	return out
}

func TestShelvesPermissionsMembershipOrderAndSmartFilters(t *testing.T) {
	r := newReadingEnv(t)
	e := r.e
	// A second library (granted to the owner) with a third title.
	root2, _ := filepath.Abs(filepath.Join(e.Cfg.MediaRoot, "ebooks2"))
	_ = os.MkdirAll(root2, 0o755)
	cl := e.Do("POST", "/admin/libraries", r.admin, map[string]any{"name": "Second shelf", "config": map[string]any{
		"mode": "managed", "rootPath": root2, "followSymlinks": false, "writebackBackups": false, "providerOrder": []string{}}})
	var d2 wire.LibraryDetail
	cl.JSON(t, &d2)
	if cl.StatusCode != http.StatusCreated {
		t.Fatalf("second library: %d %s", cl.StatusCode, cl.Body)
	}
	if x := e.Do("PUT", "/admin/users/"+e.Fix.AdminID.String()+"/libraries/"+d2.Library.ID, r.admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("admin grant 2: %d", x.StatusCode)
	}
	if x := e.Do("PUT", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+d2.Library.ID, r.admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("grant 2: %d", x.StatusCode)
	}
	epub(t, filepath.Join(r.root, "Saga", "vol3.epub"), "Third Tale", "Bob Writer", "978-0-306-40615-7")
	epub(t, filepath.Join(root2, "Other", "other.epub"), "Fourth Folio", "Cy Scribe", "978-3-16-148410-0")
	scanTwice(t, e, r.admin, r.lib)
	scanTwice(t, e, r.admin, d2.Library.ID)
	if x := e.Do("DELETE", "/admin/users/"+e.Fix.AdminID.String()+"/libraries/"+d2.Library.ID, r.admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("admin revoke 2: %d", x.StatusCode) // the administrator must not see the second library
	}
	var titles wire.Titles
	e.Do("GET", "/titles", r.userA, nil).JSON(t, &titles)
	byName := map[string]string{}
	for _, x := range titles.Items {
		byName[x.Title] = x.ID
	}
	if byName["Second Volume"] == "" || byName["Third Tale"] == "" || byName["Fourth Folio"] == "" {
		t.Fatalf("titles: %+v", byName)
	}
	t2, t3, t4 := byName["Second Volume"], byName["Third Tale"], byName["Fourth Folio"]

	// Create a private manual shelf; only the owner can see or touch it.
	sid := uuid.NewString()
	cr := e.Do("PUT", "/shelves/"+sid, r.userA, r.shelfBody(uuid.NewString(), "0", "manual", "private", "To read", nil))
	var sh wire.Shelf
	cr.JSON(t, &sh)
	if cr.StatusCode != 200 || sh.Revision != "1" || !sh.CanEdit || sh.Evaluation != "manual" || sh.OwnerID != e.Fix.UserAID.String() {
		t.Fatalf("create shelf: %d %s", cr.StatusCode, cr.Body)
	}
	for _, tok := range []string{r.admin, r.userB} {
		if g := e.Do("GET", "/shelves/"+sid, tok, nil); g.StatusCode != 404 {
			t.Fatalf("private shelf visible to another user: %d %s", g.StatusCode, g.Body)
		}
		if p := e.Do("PUT", "/shelves/"+sid, tok, r.shelfBody(uuid.NewString(), "1", "manual", "shared", "hijack", nil)); p.StatusCode != 404 {
			t.Fatalf("private shelf writable by another user: %d %s", p.StatusCode, p.Body)
		}
	}
	// A wrong-kind filter combination is rejected without a receipt.
	if x := e.Do("PUT", "/shelves/"+uuid.NewString(), r.userA, r.shelfBody(uuid.NewString(), "0", "manual", "private", "bad", rule("title", "contains", "x"))); x.StatusCode != 422 {
		t.Fatalf("manual with filter: %d", x.StatusCode)
	}
	if x := e.Do("PUT", "/shelves/"+uuid.NewString(), r.userA, r.shelfBody(uuid.NewString(), "0", "smart", "private", "bad", nil)); x.StatusCode != 422 {
		t.Fatalf("smart without filter: %d", x.StatusCode)
	}

	// Membership appends in order; each change spends a revision.
	add := func(token, shelf, title, base string) apitest.Response {
		return e.Do("PUT", "/shelves/"+shelf+"/titles/"+title, token, delBody(uuid.NewString(), base))
	}
	for i, tt := range []string{t2, t3, t4} {
		x := add(r.userA, sid, tt, string(rune('1'+i)))
		x.JSON(t, &sh)
		if x.StatusCode != 200 || sh.VisibleTitleCount != int64(i+1) || sh.Revision != string(rune('2'+i)) {
			t.Fatalf("add %d: %d %s", i, x.StatusCode, x.Body)
		}
	}
	if got := titleNames(r.shelfTitles(t, r.userA, sid)); len(got) != 3 || got[0] != "Second Volume" || got[2] != "Fourth Folio" {
		t.Fatalf("order: %v", got)
	}
	// Adding an existing member is a no-op that spends no revision; a stale add keeps a candidate.
	if x := add(r.userA, sid, t2, "4"); x.StatusCode != 200 {
		t.Fatalf("re-add: %d %s", x.StatusCode, x.Body)
	} else if x.JSON(t, &sh); sh.Revision != "4" {
		t.Fatalf("re-add spent a revision: %s", sh.Revision)
	}
	staleAdd := add(r.userA, sid, t2, "1")
	sp := problemMap(t, staleAdd)
	if staleAdd.StatusCode != 409 || sp["code"] != "stale_revision" {
		t.Fatalf("stale membership: %d %s", staleAdd.StatusCode, staleAdd.Body)
	}
	var cs wire.PersonalConflicts
	e.Do("GET", "/personal-conflicts?resourceId="+sid, r.userA, nil).JSON(t, &cs)
	if len(cs.Items) != 1 || cs.Items[0].ResourceKind != "membership" || cs.Items[0].Candidate.Membership == nil ||
		cs.Items[0].Candidate.Membership.Action != "add" || cs.Items[0].Candidate.Membership.TitleID != t2 || cs.Items[0].EditionID != nil {
		t.Fatalf("membership conflict: %+v", cs)
	}
	if k := e.Do("POST", "/personal-conflicts/"+sp["conflictId"].(string)+"/resolve", r.userA,
		map[string]any{"operationId": uuid.NewString(), "baseRevision": "4", "choice": "keep_server", "contentVersion": nil}); k.StatusCode != 200 {
		t.Fatalf("keep_server: %d %s", k.StatusCode, k.Body)
	}
	// An owner cannot add a title they cannot see.
	if x := add(r.userA, sid, uuid.NewString(), "4"); x.StatusCode != 404 {
		t.Fatalf("unknown title: %d", x.StatusCode)
	}

	// Reorder visible members; hidden members keep their slots and their IDs never leak.
	if x := e.Do("DELETE", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+d2.Library.ID, r.admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke: %d %s", x.StatusCode, x.Body)
	}
	vis := r.shelfTitles(t, r.userA, sid)
	if len(vis.Items) != 2 || vis.Total != 2 {
		t.Fatalf("hidden member leaked: %+v", titleNames(vis))
	}
	e.Do("GET", "/shelves/"+sid, r.userA, nil).JSON(t, &sh)
	if sh.VisibleTitleCount != 2 {
		t.Fatalf("count includes a hidden title: %d", sh.VisibleTitleCount)
	}
	ord := func(base string, ids ...string) apitest.Response {
		return e.Do("PUT", "/shelves/"+sid+"/order", r.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": base,
			"visibleTitleIds": ids, "capturedAt": "2026-11-14T10:00:00Z"})
	}
	if x := ord("4", t3, t3); x.StatusCode != 422 {
		t.Fatalf("duplicate ids: %d", x.StatusCode)
	}
	if x := ord("4", t3); x.StatusCode != 409 {
		t.Fatalf("incomplete permutation: %d %s", x.StatusCode, x.Body)
	}
	if x := ord("4", t3, t4); x.StatusCode != 409 { // t4 is hidden from the owner now, not a permutation of the visible set
		t.Fatalf("hidden id accepted: %d %s", x.StatusCode, x.Body)
	}
	if x := ord("4", t3, t2); x.StatusCode != 200 {
		t.Fatalf("reorder: %d %s", x.StatusCode, x.Body)
	}
	if got := titleNames(r.shelfTitles(t, r.userA, sid)); len(got) != 2 || got[0] != "Third Tale" || got[1] != "Second Volume" {
		t.Fatalf("after reorder: %v", got)
	}
	// Removing a hidden member through its ID is not possible; regranting restores it in its slot.
	if x := e.Do("DELETE", "/shelves/"+sid+"/titles/"+t4, r.userA, delBody(uuid.NewString(), "5")); x.StatusCode != 404 {
		t.Fatalf("hidden remove: %d %s", x.StatusCode, x.Body)
	}
	if x := e.Do("PUT", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+d2.Library.ID, r.admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("regrant: %d", x.StatusCode)
	}
	if got := titleNames(r.shelfTitles(t, r.userA, sid)); len(got) != 3 || got[0] != "Third Tale" || got[1] != "Second Volume" || got[2] != "Fourth Folio" {
		t.Fatalf("hidden member lost its slot: %v", got)
	}
	if x := e.Do("DELETE", "/shelves/"+sid+"/titles/"+t3, r.userA, delBody(uuid.NewString(), "5")); x.StatusCode != 200 {
		t.Fatalf("remove: %d %s", x.StatusCode, x.Body)
	}

	// Sharing: others can read but not edit; their counts honor their own grants.
	e.Do("GET", "/shelves/"+sid, r.userA, nil).JSON(t, &sh)
	up := e.Do("PUT", "/shelves/"+sid, r.userA, r.shelfBody(uuid.NewString(), sh.Revision, "manual", "shared", "To read", nil))
	if up.StatusCode != 200 {
		t.Fatalf("share: %d %s", up.StatusCode, up.Body)
	}
	var seen wire.Shelf
	e.Do("GET", "/shelves/"+sid, r.userB, nil).JSON(t, &seen)
	if seen.CanEdit || seen.OwnerID != e.Fix.UserAID.String() || seen.VisibleTitleCount != 0 || seen.Data.Value == nil {
		t.Fatalf("viewer without grants: %+v", seen)
	}
	e.Do("GET", "/shelves/"+sid, r.admin, nil).JSON(t, &seen)
	if seen.CanEdit || seen.VisibleTitleCount != 1 { // the administrator holds the first library only
		t.Fatalf("admin view: %+v", seen)
	}
	if got := r.shelfTitles(t, r.admin, sid); len(got.Items) != 1 || got.Items[0].Title != "Second Volume" {
		t.Fatalf("admin titles: %v", titleNames(got))
	}
	if x := e.Do("PUT", "/shelves/"+sid, r.admin, r.shelfBody(uuid.NewString(), seen.Revision, "manual", "shared", "mine now", nil)); x.StatusCode != 403 {
		t.Fatalf("admin edit of another shelf: %d %s", x.StatusCode, x.Body)
	}
	if x := add(r.admin, sid, t2, seen.Revision); x.StatusCode != 403 {
		t.Fatalf("admin membership edit: %d %s", x.StatusCode, x.Body)
	}
	if x := e.Do("DELETE", "/shelves/"+sid, r.admin, delBody(uuid.NewString(), seen.Revision)); x.StatusCode != 403 {
		t.Fatalf("admin delete: %d %s", x.StatusCode, x.Body)
	}
	var shared wire.Shelves
	e.Do("GET", "/shelves?scope=shared", r.admin, nil).JSON(t, &shared)
	if shared.Total != 1 || shared.Items[0].ID != sid {
		t.Fatalf("shared listing: %+v", shared)
	}
	e.Do("GET", "/shelves?scope=shared", r.userA, nil).JSON(t, &shared)
	if shared.Total != 0 {
		t.Fatalf("own shelves belong to scope=mine: %+v", shared)
	}

	// Smart shelves: viewer-specific evaluation, no manual membership, bounded grammar.
	smart := uuid.NewString()
	filter := group("AND", rule("title", "contains", "VOLUME"), rule("author", "is_not", "bob writer"))
	cr = e.Do("PUT", "/shelves/"+smart, r.userA, r.shelfBody(uuid.NewString(), "0", "smart", "shared", "Volumes", filter))
	cr.JSON(t, &sh)
	if cr.StatusCode != 200 || sh.Evaluation != "viewer-specific" || sh.VisibleTitleCount != 1 {
		t.Fatalf("smart create: %d %s", cr.StatusCode, cr.Body)
	}
	if got := r.shelfTitles(t, r.userA, smart); len(got.Items) != 1 || got.Items[0].Title != "Second Volume" {
		t.Fatalf("smart titles: %v", titleNames(got))
	}
	if got := r.shelfTitles(t, r.userB, smart); got.Total != 0 {
		t.Fatalf("smart evaluation used the owner's grants: %v", titleNames(got))
	}
	if x := add(r.userA, smart, t2, "1"); x.StatusCode != 422 {
		t.Fatalf("smart membership: %d %s", x.StatusCode, x.Body)
	}
	if x := e.Do("PUT", "/shelves/"+smart, r.userA, r.shelfBody(uuid.NewString(), "1", "manual", "shared", "Volumes", nil)); x.StatusCode != 422 {
		t.Fatalf("kind change: %d %s", x.StatusCode, x.Body)
	}
	count := func(f any) (int64, int) {
		x := e.Do("PUT", "/shelves/"+uuid.NewString(), r.userA, r.shelfBody(uuid.NewString(), "0", "smart", "private", "probe", f))
		if x.StatusCode != 200 {
			return -1, x.StatusCode
		}
		x.JSON(t, &sh)
		return sh.VisibleTitleCount, 200
	}
	// Personal-state predicates use the viewer's own state. Seeded audio fixtures
	// exist in the database, so semantic probes are scoped to the three test titles.
	scoped := func(f any) (int64, int) {
		return count(group("AND", f, group("OR",
			rule("title", "is", "second volume"), rule("title", "is", "third tale"), rule("title", "is", "fourth folio"))))
	}
	want := func(name string, f any, n int64) {
		t.Helper()
		if got, code := scoped(f); code != 200 || got != n {
			t.Fatalf("%s: got %d (status %d), want %d", name, got, code, n)
		}
	}
	want("finished before any state", rule("status", "is", "finished"), 0)
	e.Do("PUT", "/editions/"+r.ed.ID+"/completion", r.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "0",
		"fileId": r.ed.File.ID, "contentVersion": r.ed.File.ContentVersion, "event": "manual_finish", "capturedAt": "2026-11-14T10:00:00Z"})
	want("finished after finishing", rule("status", "is", "finished"), 1)
	want("not finished", rule("status", "is_not", "finished"), 2)
	if x := r.putPos(t, r.userA, r.posBody(uuid.NewString(), "0", r.ed.File.ContentVersion, r.cfi("/6/8!/4/2"))); x.StatusCode != 200 {
		t.Fatalf("position: %d %s", x.StatusCode, x.Body)
	}
	want("a finished title with a position is not reading", rule("status", "is", "reading"), 0)
	want("format", rule("format", "is", "epub"), 3)
	want("format negated", rule("format", "is_not", "epub"), 0)
	want("has ebook", rule("has_ebook", "is", true), 3)
	want("no ebook", rule("has_ebook", "is", false), 0)
	want("has audio", rule("has_audio", "is", true), 0)
	if n, _ := count(rule("has_audio", "is", true)); n < 1 {
		t.Fatalf("seeded audio titles are visible to the viewer: %d", n)
	}
	want("author contains", rule("author", "contains", "SCRIBE"), 1)
	want("author does not contain", rule("author", "not_contains", "SCRIBE"), 2)
	want("absent series must not match", rule("series", "contains", "anything"), 0)
	want("absent series matches the negation", rule("series", "not_contains", "anything"), 3)
	if n, _ := count(group("OR", rule("title", "is", "third tale"), rule("title", "is", "fourth folio"))); n != 2 {
		t.Fatalf("any: %d", n)
	}
	// Grammar limits, typing and empty groups are 422.
	many := []any{}
	for i := 0; i < 31; i++ {
		many = append(many, rule("title", "contains", "x"))
	}
	long := []any{}
	for i := 0; i < 20; i++ {
		long = append(long, strings.Repeat("a", 512))
	}
	for name, f := range map[string]any{
		"four group levels":   group("AND", group("AND", group("AND", group("AND", rule("title", "contains", "x"))))),
		"31 rules":            group("AND", many...),
		"over 32 KiB":         group("AND", rule("title", "is", long), rule("author", "is", long), rule("series", "is", long), rule("publisher", "is", long)),
		"empty filter":        group("AND"),
		"empty nested group":  group("OR", rule("title", "contains", "x"), group("AND")),
		"operator not valid":  rule("status", "contains", "finished"),
		"bad status value":    rule("status", "is", "paused"),
		"unknown field":       rule("nonsense", "is", "x"),
		"the old shelf shape": map[string]any{"kind": "predicate", "field": "title", "operator": "equals", "value": "x"},
	} {
		if _, code := count(f); code != 422 {
			t.Fatalf("%s: %d", name, code)
		}
	}
	if _, code := count(group("AND", many[:30]...)); code != 200 {
		t.Fatalf("30 rules: %d", code)
	}
	if _, code := count(group("AND", group("AND", group("AND", rule("title", "contains", "x"))))); code != 200 {
		t.Fatalf("three group levels: %d", code)
	}

	// Delete keeps an owner-only tombstone: others get 404, stale writes get a durable deleted conflict.
	e.Do("GET", "/shelves/"+sid, r.userA, nil).JSON(t, &sh)
	dop, preDelete := uuid.NewString(), sh.Revision
	dd := e.Do("DELETE", "/shelves/"+sid, r.userA, delBody(dop, preDelete))
	dd.JSON(t, &sh)
	if dd.StatusCode != 200 || !sh.Deleted || sh.Data.Value != nil || sh.CanEdit {
		t.Fatalf("delete: %d %s", dd.StatusCode, dd.Body)
	}
	if rep := e.Do("DELETE", "/shelves/"+sid, r.userA, delBody(dop, preDelete)); rep.StatusCode != 200 {
		t.Fatalf("delete replay: %d", rep.StatusCode)
	}
	if g := e.Do("GET", "/shelves/"+sid, r.admin, nil); g.StatusCode != 404 {
		t.Fatalf("tombstone visible to others: %d", g.StatusCode)
	}
	if g := e.Do("GET", "/shelves/"+sid+"/titles", r.userA, nil); g.StatusCode != 404 {
		t.Fatalf("tombstone titles: %d", g.StatusCode)
	}
	var mine wire.Shelves
	e.Do("GET", "/shelves?includeDeleted=true", r.userA, nil).JSON(t, &mine)
	hasTomb := false
	for _, s := range mine.Items {
		hasTomb = hasTomb || (s.ID == sid && s.Deleted)
	}
	if !hasTomb {
		t.Fatalf("owner list lost the tombstone: %+v", mine)
	}
	late := e.Do("PUT", "/shelves/"+sid, r.userA, r.shelfBody(uuid.NewString(), sh.Revision, "manual", "private", "zombie", nil))
	if late.StatusCode != 409 || late.Code() != "deleted" {
		t.Fatalf("write to a tombstone: %d %s", late.StatusCode, late.Body)
	}
}

// Concurrent creators of one annotation, and concurrent members of one shelf at
// the same base revision: exactly one wins, the rest keep durable candidates.
func TestAnnotationAndShelfConcurrency(t *testing.T) {
	r := newReadingEnv(t)
	e, v := r.e, r.ed.File.ContentVersion
	fan := func(n int, f func(i int) apitest.Response) (wins, stale int) {
		codes := make([]int, n)
		done := make(chan struct{})
		for i := 0; i < n; i++ {
			go func(i int) { codes[i] = f(i).StatusCode; done <- struct{}{} }(i)
		}
		for i := 0; i < n; i++ {
			<-done
		}
		for _, c := range codes {
			switch c {
			case 200:
				wins++
			case 409:
				stale++
			default:
				t.Fatalf("unexpected status %d", c)
			}
		}
		return
	}
	id := uuid.NewString()
	if w, s := fan(8, func(i int) apitest.Response {
		return r.putAnn(r.userA, id, r.annBody(uuid.NewString(), "0", v, "note", "n", nil))
	}); w != 1 || s != 7 {
		t.Fatalf("annotation creators: wins=%d stale=%d", w, s)
	}
	same := r.annBody(uuid.NewString(), "1", v, "note", "edit", nil)
	if w, s := fan(6, func(int) apitest.Response { return r.putAnn(r.userA, id, same) }); w != 6 || s != 0 {
		t.Fatalf("identical annotation retries: wins=%d stale=%d", w, s)
	}
	var ann wire.Annotation
	e.Do("GET", "/editions/"+r.ed.ID+"/annotations/"+id, r.userA, nil).JSON(t, &ann)
	if ann.Revision != "2" {
		t.Fatalf("annotation revision %s", ann.Revision)
	}

	sid := uuid.NewString()
	e.Do("PUT", "/shelves/"+sid, r.userA, r.shelfBody(uuid.NewString(), "0", "manual", "private", "Race", nil))
	var titles wire.Titles
	e.Do("GET", "/titles", r.userA, nil).JSON(t, &titles)
	if len(titles.Items) < 3 {
		t.Fatalf("need three titles: %d", len(titles.Items))
	}
	if w, s := fan(3, func(i int) apitest.Response {
		return e.Do("PUT", "/shelves/"+sid+"/titles/"+titles.Items[i].ID, r.userA, delBody(uuid.NewString(), "1"))
	}); w != 1 || s != 2 {
		t.Fatalf("shelf members: wins=%d stale=%d", w, s)
	}
	var sh wire.Shelf
	e.Do("GET", "/shelves/"+sid, r.userA, nil).JSON(t, &sh)
	if sh.Revision != "2" {
		t.Fatalf("shelf revision %s", sh.Revision)
	}
}

// ADR-0107: shared smart shelves are evaluated for each viewer, including rating and library rules, and the filter
// fields shelves gained work the same in library search.
func TestSmartShelfSharedViewersAndNewFields(t *testing.T) {
	r := newReadingEnv(t)
	e := r.e
	// A decomposed e plus combining accent in the file, matched by the composed form and the other way round.
	const composed, decomposed = "Caf\u00e9 Noir", "Cafe\u0301 Noir"
	epub(t, filepath.Join(r.root, "Saga", "cafe.epub"), decomposed, "Zo\u00eb Writer", "978-0-306-40615-7")
	scanTwice(t, e, r.admin, r.lib)

	var titles wire.Titles
	e.Do("GET", "/titles?size=200", r.userA, nil).JSON(t, &titles)
	id := map[string]string{}
	for _, x := range titles.Items {
		id[x.Title] = x.ID
	}
	second := id["Second Volume"]
	if second == "" {
		t.Fatalf("titles: %v", titleNames(titles))
	}

	search := func(token string, f any) int64 {
		t.Helper()
		x := e.Do("POST", "/titles/search", token, map[string]any{"filter": f, "size": 200})
		if x.StatusCode != 200 {
			t.Fatalf("search %v: %d %s", f, x.StatusCode, x.Body)
		}
		var out wire.TitleRows
		x.JSON(t, &out)
		return out.Total
	}
	for _, v := range []string{composed, decomposed, strings.ToUpper(composed)} {
		if n := search(r.userA, rule("title", "is", v)); n != 1 {
			t.Fatalf("is %q: %d", v, n)
		}
		if n := search(r.userA, rule("title", "contains", v)); n != 1 {
			t.Fatalf("contains %q: %d", v, n)
		}
	}
	if n := search(r.userA, rule("author", "is", "zoe\u0308 writer")); n != 1 {
		t.Fatalf("decomposed author: %d", n)
	}
	if n := search(r.userA, rule("language", "contains", "E")); n < 1 {
		t.Fatalf("language contains: %d", n)
	}
	all := search(r.userA, group("AND"))
	if a, b := search(r.userA, rule("language", "contains", "en")), search(r.userA, rule("language", "not_contains", "en")); a+b != all {
		t.Fatalf("language negation is not the complement: %d + %d != %d", a, b, all)
	}
	// Audio file formats are filterable, while "audio" still means any recording.
	audio := search(r.userA, rule("format", "is", "audio"))
	if ext := search(r.userA, rule("format", "is", []string{"mp3", "m4a", "m4b", "aac", "ogg", "opus", "flac", "wav"})); audio < 1 || ext != audio {
		t.Fatalf("audio extensions: %d of %d audio titles", ext, audio)
	}

	// Tags: edition tags, with every operator and its negation.
	if y := r.metaPut(r.admin, r.ed.ID, "tags", mw("0", []string{"Space Opera"}, false)); y.StatusCode != 200 {
		t.Fatalf("tags: %d %s", y.StatusCode, y.Body)
	}
	for _, c := range []struct {
		op    string
		value any
		want  int64
	}{{"is", "space opera", 1}, {"is_not", "space opera", all - 1}, {"contains", "OPERA", 1}, {"not_contains", "OPERA", all - 1},
		{"not_empty", nil, 1}, {"is_empty", nil, all - 1}} {
		if n := search(r.userA, rule("tag", c.op, c.value)); n != c.want {
			t.Fatalf("tag %s: got %d want %d", c.op, n, c.want)
		}
	}

	shelf := func(name string, f any) string {
		t.Helper()
		sid := uuid.NewString()
		x := e.Do("PUT", "/shelves/"+sid, r.userA, r.shelfBody(uuid.NewString(), "0", "smart", "shared", name, f))
		if x.StatusCode != 200 {
			t.Fatalf("shelf %s: %d %s", name, x.StatusCode, x.Body)
		}
		return sid
	}

	// Rating rules use the viewer's own rating, never the owner's.
	rated := shelf("Loved", rule("rating", "gte", 4))
	if x := e.Do("PUT", "/titles/"+second+"/personal", r.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "0",
		"capturedAt": "2026-11-14T10:00:00Z", "data": map[string]any{"ratingHalves": 9, "review": "", "startedAt": nil, "finishedAt": nil}}); x.StatusCode != 200 {
		t.Fatalf("rate: %d %s", x.StatusCode, x.Body)
	}
	if got := r.shelfTitles(t, r.userA, rated); got.Total != 1 {
		t.Fatalf("owner rating: %v", titleNames(got))
	}
	if got := r.shelfTitles(t, r.admin, rated); got.Total != 0 { // the administrator holds the library but rated nothing
		t.Fatalf("the owner's rating reached another viewer: %v", titleNames(got))
	}

	// A shared shelf may filter on a library. A viewer without it receives the rule unchanged and gains nothing.
	root2, _ := filepath.Abs(filepath.Join(e.Cfg.MediaRoot, "private-comics"))
	_ = os.MkdirAll(root2, 0o755)
	cl := e.Do("POST", "/admin/libraries", r.admin, map[string]any{"name": "Private comics", "config": map[string]any{
		"mode": "managed", "rootPath": root2, "followSymlinks": false, "writebackBackups": false, "providerOrder": []string{}}})
	var d2 wire.LibraryDetail
	cl.JSON(t, &d2)
	if cl.StatusCode != http.StatusCreated {
		t.Fatalf("second library: %d %s", cl.StatusCode, cl.Body)
	}
	if x := e.Do("PUT", "/admin/users/"+e.Fix.AdminID.String()+"/libraries/"+d2.Library.ID, r.admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("admin grant: %d", x.StatusCode)
	}
	if x := e.Do("PUT", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+d2.Library.ID, r.admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d", x.StatusCode)
	}
	epub(t, filepath.Join(root2, "Other", "secret.epub"), "Secret Folio", "Cy Scribe", "978-3-16-148410-0")
	scanTwice(t, e, r.admin, d2.Library.ID)
	if x := e.Do("DELETE", "/admin/users/"+e.Fix.AdminID.String()+"/libraries/"+d2.Library.ID, r.admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke: %d", x.StatusCode)
	}
	adminAll := search(r.admin, group("AND"))
	for _, c := range []struct {
		op           string
		owner, admin int64
	}{{"is", 1, 0}, {"is_not", all, adminAll}} {
		sid := shelf("By library "+c.op, rule("library", c.op, d2.Library.ID))
		if got := r.shelfTitles(t, r.userA, sid); got.Total != c.owner {
			t.Fatalf("owner library %s: %v", c.op, titleNames(got))
		}
		x := e.Do("GET", "/shelves/"+sid, r.admin, nil)
		var seen wire.Shelf
		x.JSON(t, &seen)
		if x.StatusCode != 200 || seen.VisibleTitleCount != c.admin || seen.Data.Value == nil || seen.Data.Value.Filter.Value == nil ||
			seen.Data.Value.Filter.Value.Value != d2.Library.ID {
			t.Fatalf("viewer of library %s: %d %s", c.op, x.StatusCode, x.Body)
		}
		got := r.shelfTitles(t, r.admin, sid)
		if got.Total != c.admin || slices.Contains(titleNames(got), "Secret Folio") || strings.Contains(string(x.Body), "Private comics") {
			t.Fatalf("a viewer saw into a library without a grant: %v %s", titleNames(got), x.Body)
		}
	}
}
