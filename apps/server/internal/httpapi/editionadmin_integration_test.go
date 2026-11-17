package httpapi_test

import (
	"path/filepath"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func (r *readingEnv) metaPut(token, edition, field string, body map[string]any) apitest.Response {
	return r.e.Do("PUT", "/admin/editions/"+edition+"/metadata/"+field, token, body)
}

func mw(base string, value any, clear bool) map[string]any {
	return map[string]any{"operationId": uuid.NewString(), "baseRevision": base, "clear": clear, "value": value}
}

func field(rep wire.T005MetadataReport, name string) *wire.T005MetadataField {
	for i := range rep.Fields {
		if rep.Fields[i].Field == name {
			return &rep.Fields[i]
		}
	}
	return nil
}

func TestEditionMetadataAndTitleLinking(t *testing.T) {
	r := newReadingEnv(t)
	e := r.e
	ed := r.ed.ID

	// Authority: administrator AND a grant. A plain user is refused.
	if x := e.Do("GET", "/admin/editions/"+ed+"/metadata", r.userA, nil); x.StatusCode != 403 {
		t.Fatalf("non-admin: %d %s", x.StatusCode, x.Body)
	}
	if x := e.Do("GET", "/admin/editions/"+uuid.NewString()+"/metadata", r.admin, nil); x.StatusCode != 404 {
		t.Fatalf("unknown edition: %d", x.StatusCode)
	}
	var rep wire.T005MetadataReport
	e.Do("GET", "/admin/editions/"+ed+"/metadata", r.admin, nil).JSON(t, &rep)
	title := field(rep, "title")
	if rep.Revision != "0" || title == nil || title.Source != "embedded" || string(title.Value.Raw) != `"Second Volume"` {
		t.Fatalf("initial report: %+v", rep)
	}
	foundFilename := false
	for _, c := range title.Conflicts {
		foundFilename = foundFilename || (c.Source == "filename" && string(c.Value.Raw) == `"vol2"`)
	}
	if !foundFilename {
		t.Fatalf("the file name must appear only as lowest-precedence evidence: %+v", title.Conflicts)
	}

	// Protected edit outranks embedded; the title list follows because this is the title's only edition.
	x := r.metaPut(r.admin, ed, "title", mw("0", "Edited Title", false))
	x.JSON(t, &rep)
	if x.StatusCode != 200 || rep.Revision != "1" || field(rep, "title").Source != "user" || string(field(rep, "title").Value.Raw) != `"Edited Title"` {
		t.Fatalf("set title: %d %s", x.StatusCode, x.Body)
	}
	var ts wire.T005Titles
	e.Do("GET", "/titles?q=edited", r.userA, nil).JSON(t, &ts)
	if ts.Total != 1 {
		t.Fatalf("title display did not follow the edit: %+v", ts)
	}
	// Replay returns the original body; a stale base is 409 with the current revision.
	op := uuid.NewString()
	body := map[string]any{"operationId": op, "baseRevision": "1", "clear": false, "value": []string{"Ada Author", "Co Author"}}
	first := r.metaPut(r.admin, ed, "authors", body)
	if first.StatusCode != 200 {
		t.Fatalf("authors: %d %s", first.StatusCode, first.Body)
	}
	if again := r.metaPut(r.admin, ed, "authors", body); again.StatusCode != 200 || string(again.Body) != string(first.Body) {
		t.Fatalf("replay: %d", again.StatusCode)
	}
	if st := r.metaPut(r.admin, ed, "series_name", mw("1", "Saga", false)); st.StatusCode != 409 || problemMap(t, st)["currentRevision"] != "2" {
		t.Fatalf("stale: %d %s", st.StatusCode, st.Body)
	}

	// Validation never creates a receipt or advances the revision.
	for name, c := range map[string]struct {
		field string
		body  map[string]any
	}{
		"title clear":        {"title", mw("2", nil, true)},
		"clear with value":   {"tags", mw("2", []string{"x"}, true)},
		"missing value":      {"tags", mw("2", nil, false)},
		"string for authors": {"authors", mw("2", "Ada", false)},
		"negative index":     {"series_index", mw("2", -1, false)},
		"array for language": {"language", mw("2", []string{"en"}, false)},
		"empty author entry": {"authors", mw("2", []string{" "}, false)},
		"number for series":  {"series_name", mw("2", 4, false)},
	} {
		if y := r.metaPut(r.admin, ed, c.field, c.body); y.StatusCode != 422 {
			t.Fatalf("%s: %d %s", name, y.StatusCode, y.Body)
		}
	}
	// A protected clear is distinct from removing the override.
	cl := r.metaPut(r.admin, ed, "series_name", mw("2", nil, true))
	cl.JSON(t, &rep)
	if cl.StatusCode != 200 || !field(rep, "series_name").Cleared || string(field(rep, "series_name").Value.Raw) != "null" {
		t.Fatalf("clear: %d %s", cl.StatusCode, cl.Body)
	}
	del := func(f, base string) apitest.Response {
		return e.Do("DELETE", "/admin/editions/"+ed+"/metadata/"+f, r.admin, map[string]any{"operationId": uuid.NewString(), "baseRevision": base})
	}
	d := del("series_name", "3")
	d.JSON(t, &rep)
	if d.StatusCode != 200 || field(rep, "series_name").Cleared || field(rep, "series_name").Source != "embedded" {
		t.Fatalf("remove clear: %d %s", d.StatusCode, d.Body)
	}
	if y := del("series_name", "4"); y.StatusCode != 404 {
		t.Fatalf("remove absent: %d", y.StatusCode)
	}
	if y := del("title", "4"); y.StatusCode != 200 {
		t.Fatalf("remove title override: %d %s", y.StatusCode, y.Body)
	}
	e.Do("GET", "/titles?q=second", r.userA, nil).JSON(t, &ts)
	if ts.Total != 1 {
		t.Fatalf("title should fall back to embedded: %+v", ts)
	}

	// Tags feed smart-shelf evaluation.
	if y := r.metaPut(r.admin, ed, "tags", mw("5", []string{"Space Opera"}, false)); y.StatusCode != 200 {
		t.Fatalf("tags: %d %s", y.StatusCode, y.Body)
	}
	if n := e.Do("PUT", "/shelves/"+uuid.NewString(), r.userA, r.shelfBody(uuid.NewString(), "0", "smart", "private", "p",
		pred("tag", "equals", "space opera"))); n.StatusCode != 200 {
		t.Fatalf("smart tag: %d", n.StatusCode)
	} else {
		var sh wire.T005Shelf
		n.JSON(t, &sh)
		if sh.VisibleTitleCount != 1 {
			t.Fatalf("edition tags not matched: %d", sh.VisibleTitleCount)
		}
	}

	// Title linking: another book of the same library.
	epub(t, filepath.Join(r.root, "Saga", "vol3.epub"), "Third Tale", "Bob Writer", "978-0-306-40615-7")
	scanTwice(t, e, r.admin, r.lib)
	var eds wire.T005Editions
	e.Do("GET", "/editions?libraryId="+r.lib, r.userA, nil).JSON(t, &eds)
	var other wire.T005Edition
	for _, x := range eds.Items {
		if x.ID != ed {
			other = x
		}
	}
	if other.ID == "" || other.TitleID == r.ed.TitleID {
		t.Fatalf("expected a second edition on its own title: %+v", eds)
	}
	link := func(token, edition string, title any, base string) apitest.Response {
		return e.Do("PUT", "/admin/editions/"+edition+"/title", token, map[string]any{"operationId": uuid.NewString(), "baseRevision": base, "titleId": title})
	}
	if y := link(r.userA, other.ID, r.ed.TitleID, "0"); y.StatusCode != 403 {
		t.Fatalf("non-admin link: %d", y.StatusCode)
	}
	if y := link(r.admin, other.ID, uuid.NewString(), "0"); y.StatusCode != 422 {
		t.Fatalf("unknown title: %d %s", y.StatusCode, y.Body)
	}
	pos := r.putPos(t, r.userA, r.posBody(uuid.NewString(), "0", r.ed.File.ContentVersion, r.cfi("/6/8!/4/2")))
	if pos.StatusCode != 200 {
		t.Fatalf("position: %d", pos.StatusCode)
	}
	lk := link(r.admin, other.ID, r.ed.TitleID, "0")
	var moved wire.T005Edition
	lk.JSON(t, &moved)
	if lk.StatusCode != 200 || moved.TitleID != r.ed.TitleID || moved.Revision != "1" {
		t.Fatalf("link: %d %s", lk.StatusCode, lk.Body)
	}
	var td wire.T005TitleDetail
	e.Do("GET", "/titles/"+r.ed.TitleID, r.userA, nil).JSON(t, &td)
	if td.Title.EditionCount != 2 {
		t.Fatalf("title children: %+v", td.Title)
	}
	// Personal state and file identity are untouched by relinking.
	var st wire.T005PositionState
	e.Do("GET", "/editions/"+ed+"/position", r.userA, nil).JSON(t, &st)
	if st.Revision != "1" || st.Position.Value == nil {
		t.Fatalf("relinking changed personal state: %+v", st)
	}
	// With two editions the title row no longer follows one edition's metadata edit.
	if y := r.metaPut(r.admin, ed, "title", mw("5", "Should Not Rename", false)); y.StatusCode != 409 && y.StatusCode != 200 {
		t.Fatalf("metadata edit: %d", y.StatusCode)
	}
	e.Do("GET", "/titles?q=should+not+rename", r.userA, nil).JSON(t, &ts)
	if ts.Total != 0 {
		t.Fatalf("a shared title was renamed by one edition: %+v", ts)
	}
	// Separation creates a new title; a sole-edition title cannot be separated again.
	sp := link(r.admin, other.ID, nil, "1")
	sp.JSON(t, &moved)
	if sp.StatusCode != 200 || moved.TitleID == r.ed.TitleID || moved.TitleID == other.TitleID {
		t.Fatalf("separate: %d %s", sp.StatusCode, sp.Body)
	}
	if y := link(r.admin, other.ID, nil, "2"); y.StatusCode != 422 {
		t.Fatalf("separate a lone edition: %d %s", y.StatusCode, y.Body)
	}
	if y := link(r.admin, other.ID, r.ed.TitleID, "1"); y.StatusCode != 409 {
		t.Fatalf("stale link: %d", y.StatusCode)
	}
}
