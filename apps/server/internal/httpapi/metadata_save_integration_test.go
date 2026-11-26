package httpapi_test

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func change(fieldName, action string, value any) map[string]any {
	c := map[string]any{"field": fieldName, "action": action}
	if value != nil {
		c["value"] = value
	}
	return c
}

func saveBody(base string, changes ...map[string]any) map[string]any {
	return map[string]any{"operationId": uuid.NewString(), "baseRevision": base, "changes": changes}
}

func textOf(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		t.Fatalf("value %s: %v", raw, err)
	}
	return s
}

// An edition save applies every change together under one revision, keeps a value when it is unlocked, and refuses
// stale or locked changes without storing any part of them (ADR-0095 decision 4, ADR-0097).
func TestEditionMetadataSaveLocksAndRevisions(t *testing.T) {
	r := newReadingEnv(t)
	e, ed := r.e, r.ed.ID
	path := "/admin/editions/" + ed + "/metadata"
	var rep wire.EditionMetadataReport
	e.Do("GET", path, r.admin, nil).JSON(t, &rep)
	base := rep.Revision

	// Several fields in one save.
	resp := e.Do("PATCH", path, r.admin, saveBody(base,
		change("publisher", "set", "House"), change("subtitle", "set", "A Subtitle"), change("description", "set", "Long text")))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save: %d %s", resp.StatusCode, resp.Body)
	}
	resp.JSON(t, &rep)
	for _, f := range []string{"publisher", "subtitle", "description"} {
		if got := field(rep, f); got == nil || got.Source != "user" || got.Locked {
			t.Fatalf("%s after save: %+v", f, got)
		}
	}
	if rep.Revision == base {
		t.Fatalf("revision did not advance")
	}

	// A stale save stores nothing.
	if resp := e.Do("PATCH", path, r.admin, saveBody(base, change("publisher", "set", "Other"))); resp.StatusCode != 409 || resp.Code() != "stale_revision" {
		t.Fatalf("stale: %d %s", resp.StatusCode, resp.Body)
	}

	// Locking the edited title freezes the file-derived value; locking keeps the value.
	body := saveBody(rep.Revision, change("publisher", "lock", nil), change("title", "lock", nil))
	resp = e.Do("PATCH", path, r.admin, body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("lock: %d %s", resp.StatusCode, resp.Body)
	}
	resp.JSON(t, &rep)
	if p := field(rep, "publisher"); !p.Locked || textOf(t, p.Value.Raw) != "House" {
		t.Fatalf("locked publisher: %+v", p)
	}
	if ti := field(rep, "title"); !ti.Locked || ti.Source != "user" || textOf(t, ti.Value.Raw) != "Second Volume" {
		t.Fatalf("locked title: %+v", ti)
	}
	// An identical retry returns the first result.
	if again := e.Do("PATCH", path, r.admin, body); again.StatusCode != http.StatusOK || string(again.Body) != string(resp.Body) {
		t.Fatalf("replay: %d %s", again.StatusCode, again.Body)
	}

	// Any change to a locked field is refused, with the rest of the save, through every write path.
	locked := rep.Revision
	if resp := e.Do("PATCH", path, r.admin, saveBody(locked, change("subtitle", "set", "Changed"), change("publisher", "set", "Changed"))); resp.StatusCode != 409 || resp.Code() != "field_locked" {
		t.Fatalf("set locked: %d %s", resp.StatusCode, resp.Body)
	}
	if resp := e.Do("PATCH", path, r.admin, saveBody(locked, change("publisher", "reset", nil))); resp.StatusCode != 409 || resp.Code() != "field_locked" {
		t.Fatalf("reset locked: %d %s", resp.StatusCode, resp.Body)
	}
	if resp := r.metaPut(r.admin, ed, "publisher", mw(locked, "Changed", false)); resp.StatusCode != 409 || resp.Code() != "field_locked" {
		t.Fatalf("put locked: %d %s", resp.StatusCode, resp.Body)
	}
	if resp := e.Do("DELETE", path+"/publisher", r.admin, map[string]any{"operationId": uuid.NewString(), "baseRevision": locked}); resp.StatusCode != 409 || resp.Code() != "field_locked" {
		t.Fatalf("delete locked: %d %s", resp.StatusCode, resp.Body)
	}
	e.Do("GET", path, r.admin, nil).JSON(t, &rep)
	if rep.Revision != locked || textOf(t, field(rep, "subtitle").Value.Raw) != "A Subtitle" || textOf(t, field(rep, "publisher").Value.Raw) != "House" {
		t.Fatalf("a refused save changed something: %+v", rep)
	}

	// Unlock keeps the value; reset then lets the file's values apply again.
	resp = e.Do("PATCH", path, r.admin, saveBody(locked, change("publisher", "unlock", nil), change("title", "unlock", nil)))
	resp.JSON(t, &rep)
	if p := field(rep, "publisher"); resp.StatusCode != 200 || p.Locked || p.Source != "user" || textOf(t, p.Value.Raw) != "House" {
		t.Fatalf("unlock: %d %s", resp.StatusCode, resp.Body)
	}
	resp = e.Do("PATCH", path, r.admin, saveBody(rep.Revision, change("publisher", "reset", nil), change("title", "reset", nil)))
	resp.JSON(t, &rep)
	if resp.StatusCode != 200 || field(rep, "publisher") != nil || field(rep, "title").Source == "user" {
		t.Fatalf("reset: %d %s", resp.StatusCode, resp.Body)
	}

	// Shape checks.
	for name, b := range map[string]map[string]any{
		"duplicate":   saveBody(rep.Revision, change("subtitle", "reset", nil), change("subtitle", "lock", nil)),
		"lock value":  saveBody(rep.Revision, change("subtitle", "lock", "x")),
		"set nothing": saveBody(rep.Revision, change("subtitle", "set", nil)),
		"clear title": saveBody(rep.Revision, map[string]any{"field": "title", "action": "set", "clear": true}),
	} {
		if resp := e.Do("PATCH", path, r.admin, b); resp.StatusCode != http.StatusUnprocessableEntity && resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: %d %s", name, resp.StatusCode, resp.Body)
		}
	}
	// Only a managing administrator may save.
	if resp := e.Do("PATCH", path, r.userA, saveBody(rep.Revision, change("subtitle", "reset", nil))); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-admin: %d %s", resp.StatusCode, resp.Body)
	}
}

// A recording save carries the title's metadata revision, which advances on every real change (user edits, lock
// changes, rescans that change embedded values) and refuses a stale form.
func TestRecordingMetadataSaveLocksAndRevisions(t *testing.T) {
	e := apitest.New(t)
	root, _ := filepath.Abs(t.TempDir())
	admin := e.Login(seed.AdminName, "cli").AccessToken
	lib := setupLibrary(t, e, admin, root).Library.ID
	file := filepath.Join(root, "Book", "1.mp3")
	audioAt(t, file, 440, "album", "Original Title", "artist", "An Author")
	scanTwice(t, e, admin, lib)
	var rec string
	if err := e.Pool.QueryRow(t.Context(), `SELECT id FROM recordings WHERE library_id=$1`, lib).Scan(&rec); err != nil {
		t.Fatal(err)
	}
	path := "/admin/recordings/" + rec + "/metadata"
	get := func() wire.MetadataReport {
		var rep wire.MetadataReport
		if resp := e.Do("GET", path, admin, nil); resp.StatusCode != 200 {
			t.Fatalf("get: %d %s", resp.StatusCode, resp.Body)
		} else {
			resp.JSON(t, &rep)
		}
		return rep
	}
	find := func(rep wire.MetadataReport, name string) *wire.MetadataField {
		for i := range rep.Fields {
			if rep.Fields[i].Field == name {
				return &rep.Fields[i]
			}
		}
		return nil
	}
	rep := get()
	base := rep.Revision

	// A title-level and a recording-level field in one save.
	resp := e.Do("PATCH", path, admin, saveBody(base, change("publisher", "set", "House"), change("narrators", "set", []string{"A Reader"})))
	if resp.StatusCode != 200 {
		t.Fatalf("save: %d %s", resp.StatusCode, resp.Body)
	}
	resp.JSON(t, &rep)
	if find(rep, "publisher").Source != "user" || find(rep, "narrators").Source != "user" || rep.Revision == base {
		t.Fatalf("after save: %s", resp.Body)
	}
	if resp := e.Do("PATCH", path, admin, saveBody(base, change("publisher", "set", "Other"))); resp.StatusCode != 409 || resp.Code() != "stale_revision" {
		t.Fatalf("stale: %d %s", resp.StatusCode, resp.Body)
	}

	// Lock the embedded title and the edit; the values stay.
	resp = e.Do("PATCH", path, admin, saveBody(rep.Revision, change("title", "lock", nil), change("publisher", "lock", nil)))
	resp.JSON(t, &rep)
	if ti := find(rep, "title"); resp.StatusCode != 200 || !ti.Locked || ti.Source != "user" || textOf(t, ti.Value) != "Original Title" {
		t.Fatalf("lock: %d %s", resp.StatusCode, resp.Body)
	}
	locked := rep.Revision

	// A rescan that changes the embedded title advances the revision but cannot change the locked title.
	audioAt(t, file, 440, "album", "Retagged Title", "artist", "An Author")
	scanTwice(t, e, admin, lib)
	rep = get()
	if ti := find(rep, "title"); textOf(t, ti.Value) != "Original Title" || !ti.Locked {
		t.Fatalf("rescan changed a locked title: %+v", ti)
	}
	if rep.Revision == locked {
		t.Fatalf("a rescan that changed embedded values did not advance the revision")
	}
	if resp := e.Do("PATCH", path, admin, saveBody(locked, change("description", "set", "x"))); resp.StatusCode != 409 || resp.Code() != "stale_revision" {
		t.Fatalf("stale after rescan: %d %s", resp.StatusCode, resp.Body)
	}
	cur := rep.Revision
	// A rescan that changes nothing leaves the revision alone.
	scanTwice(t, e, admin, lib)
	if rep = get(); rep.Revision != cur {
		t.Fatalf("an unchanged rescan advanced the revision: %s -> %s", cur, rep.Revision)
	}

	// Locked fields refuse every write path, and a refused save stores nothing.
	if resp := e.Do("PATCH", path, admin, saveBody(cur, change("description", "set", "x"), change("title", "set", "New"))); resp.StatusCode != 409 || resp.Code() != "field_locked" {
		t.Fatalf("set locked: %d %s", resp.StatusCode, resp.Body)
	}
	if resp := e.Do("PUT", path+"/publisher", admin, map[string]any{"value": "Other"}); resp.StatusCode != 409 || resp.Code() != "field_locked" {
		t.Fatalf("put locked: %d %s", resp.StatusCode, resp.Body)
	}
	if resp := e.Do("DELETE", path+"/publisher", admin, nil); resp.StatusCode != 409 || resp.Code() != "field_locked" {
		t.Fatalf("delete locked: %d %s", resp.StatusCode, resp.Body)
	}
	if rep = get(); rep.Revision != cur || find(rep, "description") != nil {
		t.Fatalf("a refused save changed something: %+v", rep)
	}

	// The older unrevisioned write still advances the revision.
	if resp := e.Do("PUT", path+"/description", admin, map[string]any{"value": "Text"}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("put: %d %s", resp.StatusCode, resp.Body)
	}
	if rep = get(); rep.Revision == cur {
		t.Fatalf("PUT did not advance the revision")
	}

	// Unlock keeps the value, then reset returns to the embedded title.
	resp = e.Do("PATCH", path, admin, saveBody(rep.Revision, change("title", "unlock", nil)))
	resp.JSON(t, &rep)
	if ti := find(rep, "title"); resp.StatusCode != 200 || ti.Locked || textOf(t, ti.Value) != "Original Title" {
		t.Fatalf("unlock: %d %s", resp.StatusCode, resp.Body)
	}
	resp = e.Do("PATCH", path, admin, saveBody(rep.Revision, change("title", "reset", nil)))
	resp.JSON(t, &rep)
	if ti := find(rep, "title"); resp.StatusCode != 200 || ti.Source != "embedded" || textOf(t, ti.Value) != "Retagged Title" {
		t.Fatalf("reset: %d %s", resp.StatusCode, resp.Body)
	}
}

// A description may be up to 8,000 characters (metadata.MaxDescription) on both save paths; the shared value schema
// must not refuse it first.
func TestMetadataSaveAcceptsLongDescriptions(t *testing.T) {
	r := newReadingEnv(t)
	long := strings.Repeat("é", 8000) // characters, not bytes
	path := "/admin/editions/" + r.ed.ID + "/metadata"
	var rep wire.EditionMetadataReport
	r.e.Do("GET", path, r.admin, nil).JSON(t, &rep)
	if resp := r.e.Do("PATCH", path, r.admin, saveBody(rep.Revision, change("description", "set", long))); resp.StatusCode != http.StatusOK {
		t.Fatalf("edition save: %d %s", resp.StatusCode, resp.Body)
	} else {
		resp.JSON(t, &rep)
	}
	if resp := r.metaPut(r.admin, r.ed.ID, "description", mw(rep.Revision, long+"x", false)); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("8,001 characters: %d %s", resp.StatusCode, resp.Body)
	}

	audioAt(t, filepath.Join(r.root, "Audio", "1.mp3"), 440, "album", "A Title")
	scanTwice(t, r.e, r.admin, r.lib)
	var rec string
	if err := r.e.Pool.QueryRow(t.Context(), `SELECT id FROM recordings WHERE library_id=$1`, r.lib).Scan(&rec); err != nil {
		t.Fatal(err)
	}
	var rr wire.MetadataReport
	r.e.Do("GET", "/admin/recordings/"+rec+"/metadata", r.admin, nil).JSON(t, &rr)
	if resp := r.e.Do("PATCH", "/admin/recordings/"+rec+"/metadata", r.admin, saveBody(rr.Revision, change("description", "set", long))); resp.StatusCode != http.StatusOK {
		t.Fatalf("recording save: %d %s", resp.StatusCode, resp.Body)
	}
}
