package httpapi_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// A moved file keeps its edition, file ID and content version, so every saved
// location, annotation and completion stays usable (ADR-0065).
func TestEditionSurvivesFileMoveAndRename(t *testing.T) {
	r := newReadingEnv(t)
	e, v := r.e, r.ed.File.ContentVersion
	if x := r.putPos(t, r.userA, r.posBody(uuid.NewString(), "0", v, r.cfi("/6/8!/4/2"))); x.StatusCode != 200 {
		t.Fatalf("position: %d %s", x.StatusCode, x.Body)
	}
	ann := e.Do("PUT", "/editions/"+r.ed.ID+"/annotations/"+uuid.NewString(), r.userA, r.annBody(uuid.NewString(), "0", v, "bookmark", "", nil))
	if ann.StatusCode != 200 {
		t.Fatalf("annotation: %d %s", ann.StatusCode, ann.Body)
	}

	moved := filepath.Join(r.root, "Elsewhere", "Renamed Second Volume.epub")
	if err := os.MkdirAll(filepath.Dir(moved), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(r.book, moved); err != nil {
		t.Fatal(err)
	}
	scanTwice(t, e, r.admin, r.lib)
	scanTwice(t, e, r.admin, r.lib)

	var eds wire.T005Editions
	e.Do("GET", "/editions?libraryId="+r.lib, r.userA, nil).JSON(t, &eds)
	if eds.Total != 1 || eds.Items[0].ID != r.ed.ID || eds.Items[0].File.ID != r.ed.File.ID || eds.Items[0].File.ContentVersion != v {
		t.Fatalf("a move created or replaced an edition: %+v", eds)
	}
	if eds.Items[0].TitleID != r.ed.TitleID {
		t.Fatal("the title changed with the move")
	}
	// The exact version is still served from its new path.
	if x := e.Do("GET", api(*eds.Items[0].File.ContentPath), r.userA, nil); x.StatusCode != 200 {
		t.Fatalf("bytes after the move: %d", x.StatusCode)
	}
	// The saved location is still current and usable; the next write continues the same revision line.
	var st wire.T005PositionState
	e.Do("GET", "/editions/"+r.ed.ID+"/position", r.userA, nil).JSON(t, &st)
	if st.Revision != "1" || st.Position.Value == nil || st.Position.Value.Anchor.ContentVersion != v {
		t.Fatalf("position after the move: %+v", st)
	}
	if x := r.putPos(t, r.userA, r.posBody(uuid.NewString(), "1", v, r.cfi("/6/10!/4/2"))); x.StatusCode != 200 {
		t.Fatalf("write after the move: %d %s", x.StatusCode, x.Body)
	}
	var list wire.T005Annotations
	e.Do("GET", "/editions/"+r.ed.ID+"/annotations", r.userA, nil).JSON(t, &list)
	if list.Total != 1 || list.Items[0].Data.Value == nil {
		t.Fatalf("annotations after the move: %+v", list)
	}
	// Only one edition ever existed for the file: a rescan must not add a second.
	var title wire.T005Titles
	e.Do("GET", "/titles?q=second", r.userA, nil).JSON(t, &title)
	if title.Total != 1 {
		t.Fatalf("titles after the move: %+v", title)
	}
}
