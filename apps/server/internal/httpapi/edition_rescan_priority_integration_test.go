package httpapi_test

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// ADR-0047: when a book file's own tags change, what is displayed still follows source priority, so a sidecar keeps
// winning for the fields it has and the new file tags show only where nothing outranks them.
func TestRescanOfAChangedFileKeepsSidecarValuesOnDisplay(t *testing.T) {
	r := newReadingEnv(t)
	side := filepath.Join(r.root, "Saga", "vol2.litara.json")
	if err := os.WriteFile(side, []byte(`{"title":"Sidecar Title","authors":["Sidecar Author"],"language":"de"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	scanTwice(t, r.e, r.admin, r.lib)

	// The file gets a new title, author and ISBN; its series stays.
	epub(t, r.book, "Changed In File", "Changed Author", "978-0-306-40615-7")
	scanTwice(t, r.e, r.admin, r.lib)
	scanTwice(t, r.e, r.admin, r.lib)

	var ts wire.Titles
	r.e.Do("GET", "/titles?libraryId="+r.lib, r.userA, nil).JSON(t, &ts)
	if ts.Total != 1 {
		t.Fatalf("titles: %+v", ts)
	}
	got := ts.Items[0]
	if got.Title != "Sidecar Title" || fmt.Sprint(got.Authors) != "[Sidecar Author]" || fmt.Sprint(got.Languages) != "[de]" {
		t.Fatalf("the sidecar must stay on display: %q %v %v", got.Title, got.Authors, got.Languages)
	}

	// The new file tags were still recorded: without the sidecar they show.
	if err := os.Remove(side); err != nil {
		t.Fatal(err)
	}
	scanTwice(t, r.e, r.admin, r.lib)
	r.e.Do("GET", "/titles?libraryId="+r.lib, r.userA, nil).JSON(t, &ts)
	got = ts.Items[0]
	if got.Title != "Changed In File" || fmt.Sprint(got.Authors) != "[Changed Author]" || fmt.Sprint(got.Languages) != "[en]" {
		t.Fatalf("the file's new tags must show once the sidecar is gone: %q %v %v", got.Title, got.Authors, got.Languages)
	}
}
