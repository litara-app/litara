package httpapi_test

import (
	"bytes"
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

func TestDamagedEditionKeepsIdentityAndClearsOnReplacement(t *testing.T) {
	e := apitest.New(t)
	admin := e.Login(seed.AdminName, "cli").AccessToken
	root := filepath.Join(e.Cfg.MediaRoot, "damaged-epub-test")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	lib := setupLibrary(t, e, admin, root).Library.ID
	file := filepath.Join(root, "book.epub")
	good := epubIn(t, file, "Damaged edition fixture", "Ada", "", "en")
	bad := good[:len(good)/2]
	if err := os.WriteFile(file, bad, 0644); err != nil {
		t.Fatal(err)
	}
	scanTwice(t, e, admin, lib)

	assertDamaged := func(ed wire.Edition) {
		t.Helper()
		if ed.Readiness != "incomplete" || ed.Capabilities.Read.State != "incomplete" ||
			len(ed.Issues) != 1 || ed.Issues[0].Code != "file_damaged" || ed.File.ContentPath == nil ||
			ed.Capabilities.Download.State != "supported" {
			t.Fatalf("unexpected damaged edition: %+v", ed)
		}
	}
	var list wire.Editions
	e.Do("GET", "/editions?libraryId="+lib, admin, nil).JSON(t, &list)
	if len(list.Items) != 1 {
		t.Fatalf("expected one edition: %+v", list)
	}
	before := list.Items[0]
	assertDamaged(before)
	endpoint := "/editions/" + before.ID
	ungranted := e.Login(seed.UserBName, "phone").AccessToken
	if response := e.Do("GET", endpoint+"/reader", ungranted, nil); response.StatusCode != http.StatusForbidden {
		t.Fatalf("ungranted reader status: %d", response.StatusCode)
	}
	var snapshot wire.ReaderSnapshot
	e.Do("GET", endpoint+"/reader", admin, nil).JSON(t, &snapshot)
	assertDamaged(snapshot.Edition)
	if response := e.Do("GET", api(*before.File.ContentPath), admin, nil); response.StatusCode != http.StatusOK || !bytes.Equal(response.Body, bad) {
		t.Fatalf("damaged original download: %d, %d bytes", response.StatusCode, len(response.Body))
	}

	// A catalog produced before this feature gets a verdict on its next scan.
	if _, err := e.Pool.Exec(t.Context(), "UPDATE file_metadata SET result = NULL WHERE content_version = $1", uuid.MustParse(before.File.ContentVersion)); err != nil {
		t.Fatal(err)
	}
	scanTwice(t, e, admin, lib)
	var backfilled wire.Edition
	e.Do("GET", endpoint, admin, nil).JSON(t, &backfilled)
	assertDamaged(backfilled)
	if backfilled.File.ContentVersion != before.File.ContentVersion {
		t.Fatal("backfilling changed the file version")
	}
	body := map[string]any{"operationId": uuid.NewString(), "baseRevision": before.Completion.Revision,
		"fileId": before.File.ID, "contentVersion": before.File.ContentVersion, "event": "manual_finish",
		"capturedAt": e.Clock.Now().Format(time.RFC3339)}
	if response := e.Do("PUT", endpoint+"/completion", admin, body); response.StatusCode != http.StatusOK {
		t.Fatalf("finish: %d %s", response.StatusCode, response.Body)
	}

	if err := os.WriteFile(file, good, 0644); err != nil {
		t.Fatal(err)
	}
	scanTwice(t, e, admin, lib)
	scanTwice(t, e, admin, lib)
	var repaired wire.Edition
	e.Do("GET", endpoint, admin, nil).JSON(t, &repaired)
	if repaired.ID != before.ID || repaired.File.ID != before.File.ID || repaired.TitleID != before.TitleID ||
		repaired.File.ContentVersion == before.File.ContentVersion || repaired.Readiness != "ready" ||
		len(repaired.Issues) != 0 || !repaired.Completion.Finished {
		t.Fatalf("replacement did not clear damage and retain edition history: %+v", repaired)
	}
}
