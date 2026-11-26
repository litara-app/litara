package apicompat

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// docAt is the test API stamped with a version, edited by e.
func docAt(t *testing.T, version string, e edit) []byte {
	t.Helper()
	return variant(t, func(d obj) {
		d["info"] = obj{"title": "t", "version": version}
		if e != nil {
			e(d)
		}
	})
}

func newDir(t *testing.T, st State, baseline []byte) string {
	t.Helper()
	dir := t.TempDir()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.MkdirAll(filepath.Join(dir, historyDir), 0o755))
	must(writeJSON(filepath.Join(dir, stateFile), st))
	must(writeJSON(filepath.Join(dir, ledgerFile), Ledger{Releases: []Release{}}))
	must(writeJSON(filepath.Join(dir, waiversFile), waivers{Waivers: []Waiver{}}))
	if baseline != nil {
		must(os.WriteFile(filepath.Join(dir, baselineFile), baseline, 0o644))
	}
	return dir
}

func problems(t *testing.T, dir string, current []byte) string {
	t.Helper()
	return strings.Join(Verify(os.DirFS(dir), current), "\n")
}

func TestDevelopmentBaseline(t *testing.T) {
	const v = "1.0.0-development"
	dir := newDir(t, State{"development", v}, docAt(t, v, nil))
	if p := problems(t, dir, docAt(t, v, nil)); p != "" {
		t.Fatalf("unchanged API: %s", p)
	}
	// Documentation changes are not API changes.
	if p := problems(t, dir, docAt(t, v, func(d obj) { getOp(d)["summary"] = "words" })); p != "" {
		t.Fatalf("docs-only change: %s", p)
	}
	// An addition must be recorded, so it shows up in review.
	add := docAt(t, v, func(d obj) { thing(d)["extra"] = obj{"type": "string"} })
	if p := problems(t, dir, add); !strings.Contains(p, "api-baseline update") {
		t.Fatalf("an unrecorded addition must fail: %q", p)
	}
	// A break fails, with no way around it except a waiver.
	brk := docAt(t, v, func(d obj) { delete(thing(d), "status") })
	if p := problems(t, dir, brk); !strings.Contains(p, "BREAKING") || !strings.Contains(p, "response-property-removed") {
		t.Fatalf("a break must fail: %q", p)
	}
	// The version in the document must be the recorded one.
	if p := problems(t, dir, docAt(t, "0.9.0", nil)); !strings.Contains(p, "does not match the recorded API version") {
		t.Fatalf("version drift: %q", p)
	}
}

func TestASchemaRenameNeedsAWaiver(t *testing.T) {
	const v = "1.0.0-development"
	dir := newDir(t, State{"development", v}, docAt(t, v, nil))
	renamed := docAt(t, v, func(d obj) { rename(d, "Thing", "Item") })
	const id = "schema-name-changed Thing -> Item"
	if p := problems(t, dir, renamed); !strings.Contains(p, id) {
		t.Fatalf("an unrecorded rename must fail: %q", p)
	}
	if _, err := Update(dir, renamed); err == nil || !strings.Contains(err.Error(), id) {
		t.Fatalf("an unwaived rename must be refused: %v", err)
	}
	if err := writeJSON(filepath.Join(dir, waiversFile), waivers{Waivers: []Waiver{{ID: id, Reason: "test"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := Update(dir, renamed); err != nil {
		t.Fatalf("a waived rename: %v", err)
	}
	if p := problems(t, dir, renamed); p != "" {
		t.Fatalf("after the update: %s", p)
	}
}

func TestUpdateRefusesBreaksAndConsumesWaivers(t *testing.T) {
	const v = "1.0.0-development"
	dir := newDir(t, State{"development", v}, docAt(t, v, nil))
	brk := docAt(t, v, func(d obj) { delete(thing(d), "status") })
	if _, err := Update(dir, brk); err == nil || !strings.Contains(err.Error(), "refusing") {
		t.Fatalf("an unwaived break must be refused: %v", err)
	}
	if _, err := Update(dir, docAt(t, v, func(d obj) { thing(d)["extra"] = obj{"type": "string"} })); err != nil {
		t.Fatalf("an addition: %v", err)
	}

	// Waive the break: the waiver must name it exactly and give a reason. (The shared schema is reached by two operations.)
	brk = docAt(t, v, func(d obj) { thing(d)["extra"] = obj{"type": "string"}; delete(thing(d), "status") })
	id := "response-property-removed GET /things/{id} response 200 application/json.status"
	id2 := "response-property-removed POST /things response 201 application/json.status"
	writeWaivers := func(w ...Waiver) {
		if err := writeJSON(filepath.Join(dir, waiversFile), waivers{Waivers: w}); err != nil {
			t.Fatal(err)
		}
	}
	writeWaivers(Waiver{ID: id, Reason: ""}, Waiver{ID: id2, Reason: "x"})
	if _, err := Update(dir, brk); err == nil {
		t.Fatal("a waiver without a reason must not count")
	}
	writeWaivers(Waiver{ID: "something else", Reason: "x"})
	if _, err := Update(dir, brk); err == nil {
		t.Fatal("a waiver for a different change must not count")
	}
	writeWaivers(Waiver{ID: id, Reason: "status was never used by any client"}, Waiver{ID: id2, Reason: "same field, other operation"})
	if p := problems(t, dir, brk); strings.Contains(p, "BREAKING") {
		t.Fatalf("a waived break must pass the check: %q", p)
	}
	if _, err := Update(dir, brk); err != nil {
		t.Fatalf("waived break: %v", err)
	}
	if p := problems(t, dir, brk); p != "" {
		t.Fatalf("after the update: %q", p)
	}
	b, _ := os.ReadFile(filepath.Join(dir, historyDir, "waived.json"))
	if !strings.Contains(string(b), "never used by any client") {
		t.Fatalf("the waiver must stay on record: %s", b)
	}
	// An unused waiver is an error, so waivers cannot pile up.
	writeWaivers(Waiver{ID: "operation-removed GET /nowhere", Reason: "x"})
	if p := problems(t, dir, brk); !strings.Contains(p, "does not match any current breaking change") {
		t.Fatalf("unused waiver: %q", p)
	}
}

func release(t *testing.T, dir, version string, doc []byte) error {
	t.Helper()
	_, err := ReleaseVersion(dir, doc, version)
	return err
}

func TestReleasesAreImmutableAndOnlyGrow(t *testing.T) {
	dir := newDir(t, State{"development", "1.0.0-development"}, docAt(t, "1.0.0-development", nil))
	cur := docAt(t, "1.0.0-development", nil)
	if err := release(t, dir, "2.0.0", cur); err == nil {
		t.Fatal("only major version 1 lives at /api/v1")
	}
	if err := release(t, dir, "1.0.0", cur); err != nil {
		t.Fatalf("first release: %v", err)
	}
	st, _ := ReadState(os.DirFS(dir))
	if st != (State{"stable", "1.0.0"}) {
		t.Fatalf("state: %+v", st)
	}
	if _, err := os.Stat(filepath.Join(dir, baselineFile)); err == nil {
		t.Fatal("the working baseline must be gone once released")
	}
	rel := docAt(t, "1.0.0", nil)
	if p := problems(t, dir, rel); p != "" {
		t.Fatalf("right after release: %q", p)
	}

	// Waivers are not allowed any more.
	_ = writeJSON(filepath.Join(dir, waiversFile), waivers{Waivers: []Waiver{{ID: "x", Reason: "y"}}})
	if p := problems(t, dir, rel); !strings.Contains(p, "waivers are not allowed") {
		t.Fatalf("waiver after release: %q", p)
	}
	_ = writeJSON(filepath.Join(dir, waiversFile), waivers{Waivers: []Waiver{}})

	// A break fails and cannot be released.
	brk := docAt(t, "1.0.0", func(d obj) { delete(thing(d), "status") })
	if p := problems(t, dir, brk); !strings.Contains(p, "BREAKS released API 1.0.0") {
		t.Fatalf("break after release: %q", p)
	}
	if err := release(t, dir, "1.1.0", brk); err == nil || !strings.Contains(err.Error(), "breaks release") {
		t.Fatalf("releasing a break: %v", err)
	}

	// An addition is not silently accepted: it needs a new minor release.
	add := func(v string) []byte { return docAt(t, v, func(d obj) { thing(d)["extra"] = obj{"type": "string"} }) }
	if p := problems(t, dir, add("1.0.0")); !strings.Contains(p, "surface grew after release 1.0.0") {
		t.Fatalf("addition after release: %q", p)
	}
	if err := release(t, dir, "1.0.1", add("1.0.0")); err == nil {
		t.Fatal("an addition needs a minor bump, not a patch")
	}
	if err := release(t, dir, "1.0.0", add("1.0.0")); err == nil {
		t.Fatal("a version cannot be released twice")
	}
	if err := release(t, dir, "1.1.0", add("1.0.0")); err != nil {
		t.Fatalf("minor release: %v", err)
	}
	if p := problems(t, dir, add("1.1.0")); p != "" {
		t.Fatalf("after 1.1.0: %q", p)
	}

	// The break is measured against EVERY release, so hiding it by editing the newest snapshot does not help.
	led := filepath.Join(dir, ledgerFile)
	var l Ledger
	b, _ := os.ReadFile(led)
	_ = json.Unmarshal(b, &l)
	if len(l.Releases) != 2 {
		t.Fatalf("ledger: %+v", l)
	}
	old, _ := os.ReadFile(filepath.Join(dir, l.Releases[0].File))
	tampered := strings.Replace(string(old), `"status"`, `"statusX"`, 1)
	if err := os.WriteFile(filepath.Join(dir, l.Releases[0].File), []byte(tampered), 0o644); err != nil {
		t.Fatal(err)
	}
	if p := problems(t, dir, add("1.1.0")); !strings.Contains(p, "was changed after release") {
		t.Fatalf("tampered snapshot: %q", p)
	}
	_ = os.WriteFile(filepath.Join(dir, l.Releases[0].File), old, 0o644)

	// Even if both the snapshot and the ledger were forged, the later release still holds the old shape.
	l.Releases[1].SHA256 = "0000"
	_ = writeJSON(led, l)
	if p := problems(t, dir, add("1.1.0")); !strings.Contains(p, "was changed after release") {
		t.Fatalf("forged ledger hash: %q", p)
	}
}

func TestStateMustBeConsistent(t *testing.T) {
	dir := newDir(t, State{"development", "1.0.0"}, docAt(t, "1.0.0", nil))
	if p := problems(t, dir, docAt(t, "1.0.0", nil)); !strings.Contains(p, "must look like 1.0.0-development") {
		t.Fatalf("%q", p)
	}
	dir = newDir(t, State{"stable", "1.0.0"}, docAt(t, "1.0.0", nil))
	if p := problems(t, dir, docAt(t, "1.0.0", nil)); !strings.Contains(p, "nothing has been released") {
		t.Fatalf("%q", p)
	}
	dir = newDir(t, State{"unknown", "1.0.0"}, nil)
	if p := problems(t, dir, docAt(t, "1.0.0", nil)); !strings.Contains(p, "development or stable") {
		t.Fatalf("%q", p)
	}
}
