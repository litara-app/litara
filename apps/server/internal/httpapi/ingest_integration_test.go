package httpapi_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func audioAt(t *testing.T, p string, freq int, tags ...string) {
	t.Helper()
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	args := []string{"-f", "lavfi", "-i", fmt.Sprintf("sine=frequency=%d:duration=1", freq)}
	for i := 0; i+1 < len(tags); i += 2 {
		args = append(args, "-metadata", tags[i]+"="+tags[i+1])
	}
	testutil.FFmpeg(t, append(args, "-c:a", "libmp3lame", "-b:a", "32k", p)...)
}

// setup creates a managed library through the API and grants the fixture admin.
func setupLibrary(t *testing.T, e *apitest.Env, admin string, root string) wire.LibraryDetail {
	t.Helper()
	r := e.Do("POST", "/admin/libraries", admin, map[string]any{"name": "Shelf", "config": map[string]any{
		"mode": "managed", "rootPath": root, "followSymlinks": false, "writebackBackups": false, "providerOrder": []string{}}})
	if r.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %s", r.StatusCode, r.Body)
	}
	var d wire.LibraryDetail
	r.JSON(t, &d)
	if r = e.Do("PUT", "/admin/users/"+e.Fix.AdminID.String()+"/libraries/"+d.Library.ID, admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d %s", r.StatusCode, r.Body)
	}
	return d
}

// Every T004 management route refuses a non-admin, and an administrator
// without a grant on the library (ADR-0056).
func TestEveryManagementRouteNeedsAdminAndGrant(t *testing.T) {
	e := apitest.New(t)
	root, _ := filepath.Abs(t.TempDir())
	admin := e.Login(seed.AdminName, "cli").AccessToken
	user := e.Login("fixture-user-a", "phone").AccessToken
	// A library the administrator has NOT been granted.
	r := e.Do("POST", "/admin/libraries", admin, map[string]any{"name": "Ungranted", "config": map[string]any{
		"mode": "managed", "rootPath": root, "followSymlinks": false, "writebackBackups": false, "providerOrder": []string{}}})
	var d wire.LibraryDetail
	r.JSON(t, &d)
	lib := d.Library.ID
	rec := e.Fix.ThreeFile.String() // recording in a library the admin has no grant for
	file := e.Fix.Files["r1-f1"].ID.String()
	zero := uuid.NewString()

	type route struct {
		m, p string
		body any
	}
	routes := []route{
		{"POST", "/admin/libraries/" + lib + "/scans", map[string]any{}},
		{"GET", "/admin/libraries/" + lib + "/scans", nil},
		{"GET", "/admin/libraries/" + lib + "/reviews", nil},
		{"POST", "/admin/libraries/" + lib + "/reviews/" + zero + "/resolve", map[string]any{"action": "reject"}},
		{"POST", "/admin/libraries/" + lib + "/imports", map[string]any{"sourcePath": root}},
		{"GET", "/admin/libraries/" + lib + "/imports/" + zero, nil},
		{"PUT", "/admin/libraries/" + lib + "/imports/" + zero + "/items/" + zero, map[string]any{"decision": "skip"}},
		{"POST", "/admin/libraries/" + lib + "/imports/" + zero + "/approve", nil},
		{"POST", "/admin/libraries/" + lib + "/imports/" + zero + "/execute", nil},
		{"GET", "/admin/recordings/" + rec + "/metadata", nil},
		{"PUT", "/admin/recordings/" + rec + "/metadata/title", map[string]any{"value": "x"}},
		{"DELETE", "/admin/recordings/" + rec + "/metadata/title", nil},
		{"POST", "/admin/recordings/" + rec + "/writebacks/sidecar", nil},
		{"POST", "/admin/files/" + file + "/writebacks", map[string]any{"changes": map[string]any{"title": "x"}}},
		{"GET", "/admin/writebacks/" + zero, nil},
		{"POST", "/admin/writebacks/" + zero + "/approve", nil},
		{"POST", "/admin/writebacks/" + zero + "/execute", nil},
		{"GET", "/admin/writers", nil},
	}
	for _, rt := range routes {
		// A non-admin is refused outright.
		if got := e.Do(rt.m, rt.p, user, rt.body); got.StatusCode != http.StatusForbidden || got.Code() != "admin_required" {
			t.Errorf("%s %s as user: %d %s", rt.m, rt.p, got.StatusCode, got.Body)
		}
		// No credentials at all.
		if got := e.Do(rt.m, rt.p, "", rt.body); got.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s anonymous: %d", rt.m, rt.p, got.StatusCode)
		}
	}
	// Library-scoped routes and recording/file routes: an administrator without a
	// grant on the owning library is refused (the writers list is global, so skipped).
	for _, rt := range routes[:14] {
		if got := e.Do(rt.m, rt.p, admin, rt.body); got.StatusCode != http.StatusForbidden || got.Code() != "library_access_denied" {
			t.Errorf("%s %s as ungranted admin: %d %s", rt.m, rt.p, got.StatusCode, got.Body)
		}
	}
}

func TestScanReviewMetadataExportFlowOverHTTP(t *testing.T) {
	e := apitest.New(t)
	root, _ := filepath.Abs(t.TempDir())
	admin := e.Login(seed.AdminName, "cli").AccessToken
	d := setupLibrary(t, e, admin, root)
	lib := d.Library.ID
	audioAt(t, filepath.Join(root, "Book", "1.mp3"), 440, "album", "Original Title", "artist", "An Author")

	scan := func() wire.ScanRun {
		r := e.Do("POST", "/admin/libraries/"+lib+"/scans", admin, map[string]any{})
		if r.StatusCode != http.StatusAccepted {
			t.Fatalf("scan: %d %s", r.StatusCode, r.Body)
		}
		var run wire.ScanRun
		r.JSON(t, &run)
		// A second request while one is queued is a typed conflict.
		if again := e.Do("POST", "/admin/libraries/"+lib+"/scans", admin, map[string]any{}); again.StatusCode != http.StatusConflict || again.Code() != "scan_active" {
			t.Fatalf("second scan: %d %s", again.StatusCode, again.Body)
		}
		e.RunQueued()
		e.Clock.Advance(time.Minute)
		return run
	}
	scan()
	scan()

	r := e.Do("GET", "/admin/libraries/"+lib+"/scans", admin, nil)
	var runs wire.ScanRunList
	r.JSON(t, &runs)
	if len(runs.Items) != 2 || runs.Items[0].State != "completed" || runs.Items[0].Health == nil || *runs.Items[0].Health != "healthy" {
		t.Fatalf("scans: %s", r.Body)
	}

	// The cataloged recording is visible to a granted reader only after an explicit grant.
	var recID string
	if err := e.Pool.QueryRow(t.Context(), `SELECT id FROM recordings WHERE library_id=$1`, lib).Scan(&recID); err != nil {
		t.Fatalf("recording was not created: %v", err)
	}

	r = e.Do("GET", "/admin/recordings/"+recID+"/metadata", admin, nil)
	var rep wire.MetadataReport
	r.JSON(t, &rep)
	if r.StatusCode != 200 || len(rep.Fields) < 2 {
		t.Fatalf("metadata: %d %s", r.StatusCode, r.Body)
	}

	// Protected edit, then a protected clear, then removal.
	if r = e.Do("PUT", "/admin/recordings/"+recID+"/metadata/title", admin, map[string]any{"value": "My Title"}); r.StatusCode != http.StatusNoContent {
		t.Fatalf("edit: %d %s", r.StatusCode, r.Body)
	}
	if r = e.Do("PUT", "/admin/recordings/"+recID+"/metadata/title", admin, map[string]any{"clear": true}); r.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("the title cannot be cleared: %d %s", r.StatusCode, r.Body)
	}
	if r = e.Do("PUT", "/admin/recordings/"+recID+"/metadata/series_name", admin, map[string]any{"clear": true}); r.StatusCode != http.StatusNoContent {
		t.Fatalf("clear: %d %s", r.StatusCode, r.Body)
	}
	if r = e.Do("PUT", "/admin/recordings/"+recID+"/metadata/title", admin, map[string]any{"value": "x", "clear": true}); r.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("value and clear together: %d", r.StatusCode)
	}
	r = e.Do("GET", "/admin/recordings/"+recID+"/metadata", admin, nil)
	r.JSON(t, &rep)
	var gotTitle, clearedSeries bool
	for _, f := range rep.Fields {
		if f.Field == "title" && f.Source == "user" && string(f.Value) == `"My Title"` {
			gotTitle = true
		}
		if f.Field == "series_name" && f.Cleared {
			clearedSeries = true
		}
	}
	if !gotTitle || !clearedSeries {
		t.Fatalf("provenance: %s", r.Body)
	}

	// Sidecar export: plan -> (nothing written) -> approve -> execute.
	r = e.Do("POST", "/admin/recordings/"+recID+"/writebacks/sidecar", admin, nil)
	if r.StatusCode != http.StatusCreated {
		t.Fatalf("plan: %d %s", r.StatusCode, r.Body)
	}
	var wb wire.Writeback
	r.JSON(t, &wb)
	if _, err := os.Stat(filepath.Join(root, "Book", "litara.json")); err == nil {
		t.Fatal("planning must not write")
	}
	if r = e.Do("POST", "/admin/writebacks/"+wb.ID+"/execute", admin, nil); r.StatusCode != http.StatusConflict {
		t.Fatalf("an unapproved plan must not run: %d %s", r.StatusCode, r.Body)
	}
	if r = e.Do("POST", "/admin/writebacks/"+wb.ID+"/approve", admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("approve: %d %s", r.StatusCode, r.Body)
	}
	r = e.Do("POST", "/admin/writebacks/"+wb.ID+"/execute", admin, nil)
	r.JSON(t, &wb)
	if r.StatusCode != 200 || wb.Stage != "published" || wb.BackedUp {
		t.Fatalf("execute: %d %s", r.StatusCode, r.Body)
	}
	b, _ := os.ReadFile(filepath.Join(root, "Book", "litara.json"))
	if !strings.Contains(string(b), "My Title") {
		t.Fatalf("sidecar content: %s", b)
	}

	// In-file writing is off for every format.
	r = e.Do("GET", "/admin/writers", admin, nil)
	var ws wire.WriterCapabilityList
	r.JSON(t, &ws)
	for _, c := range ws.Items {
		if c.Enabled {
			t.Fatalf("no writer may be enabled by default: %+v", c)
		}
	}
	fileID := ""
	_ = e.Pool.QueryRow(t.Context(), `SELECT file_id FROM recording_files rf JOIN recordings r ON r.id=rf.recording_id WHERE r.id=$1`, recID).Scan(&fileID)
	if r = e.Do("POST", "/admin/files/"+fileID+"/writebacks", admin, map[string]any{"changes": map[string]any{"title": "x"}}); r.StatusCode != http.StatusConflict || r.Code() != "writer_disabled" {
		t.Fatalf("in-file plan: %d %s", r.StatusCode, r.Body)
	}
}

func TestImportFlowOverHTTP(t *testing.T) {
	e := apitest.New(t)
	root, _ := filepath.Abs(t.TempDir())
	src, _ := filepath.Abs(t.TempDir())
	admin := e.Login(seed.AdminName, "cli").AccessToken
	d := setupLibrary(t, e, admin, root)
	lib := d.Library.ID
	audioAt(t, filepath.Join(src, "a.mp3"), 440, "album", "Imported", "artist", "Someone")

	r := e.Do("POST", "/admin/libraries/"+lib+"/imports", admin, map[string]any{"sourcePath": src})
	if r.StatusCode != http.StatusCreated {
		t.Fatalf("plan: %d %s", r.StatusCode, r.Body)
	}
	var plan wire.ImportPlan
	r.JSON(t, &plan)
	if len(plan.Items) != 1 || plan.Items[0].TargetRel != "Someone/Imported/a.mp3" || plan.State != "planned" {
		t.Fatalf("plan: %s", r.Body)
	}
	base := "/admin/libraries/" + lib + "/imports/" + plan.ID
	if r = e.Do("POST", base+"/execute", admin, nil); r.StatusCode != http.StatusConflict {
		t.Fatalf("an unapproved import must not queue: %d", r.StatusCode)
	}
	if r = e.Do("POST", base+"/approve", admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("approve: %d %s", r.StatusCode, r.Body)
	}
	if r = e.Do("POST", base+"/execute", admin, nil); r.StatusCode != http.StatusAccepted {
		t.Fatalf("execute: %d %s", r.StatusCode, r.Body)
	}
	e.RunQueued()
	r = e.Do("GET", base, admin, nil)
	r.JSON(t, &plan)
	if plan.State != "completed" || plan.Items[0].State != "published" {
		t.Fatalf("after run: %s", r.Body)
	}
	if _, err := os.Stat(filepath.Join(root, "Someone", "Imported", "a.mp3")); err != nil {
		t.Fatalf("copied file missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(src, "a.mp3")); err != nil {
		t.Fatal("the source must be retained")
	}
	// An index-mode library refuses imports with a typed error.
	r = e.Do("POST", "/admin/libraries", admin, map[string]any{"name": "Index", "config": map[string]any{"mode": "index", "rootPath": root, "followSymlinks": false, "writebackBackups": false, "providerOrder": []string{}}})
	var idx wire.LibraryDetail
	r.JSON(t, &idx)
	_ = e.Do("PUT", "/admin/users/"+e.Fix.AdminID.String()+"/libraries/"+idx.Library.ID, admin, nil)
	if r = e.Do("POST", "/admin/libraries/"+idx.Library.ID+"/imports", admin, map[string]any{"sourcePath": src}); r.StatusCode != http.StatusConflict || r.Code() != "library_not_managed" {
		t.Fatalf("index import: %d %s", r.StatusCode, r.Body)
	}
	_ = json.RawMessage(nil)
}

func TestAmbiguousMoveReviewOverHTTP(t *testing.T) {
	e := apitest.New(t)
	root, _ := filepath.Abs(t.TempDir())
	admin := e.Login(seed.AdminName, "cli").AccessToken
	d := setupLibrary(t, e, admin, root)
	lib := d.Library.ID
	a := filepath.Join(root, "a.mp3")
	audioAt(t, a, 440)
	data, _ := os.ReadFile(a)
	_ = os.WriteFile(filepath.Join(root, "b.mp3"), data, 0o644)
	run := func() {
		if r := e.Do("POST", "/admin/libraries/"+lib+"/scans", admin, map[string]any{}); r.StatusCode != http.StatusAccepted {
			t.Fatalf("scan: %d %s", r.StatusCode, r.Body)
		}
		e.RunQueued()
		e.Clock.Advance(time.Minute)
	}
	run()
	run()
	_ = os.Rename(a, filepath.Join(root, "c.mp3"))
	_ = os.Rename(filepath.Join(root, "b.mp3"), filepath.Join(root, "d.mp3"))
	run()
	run()
	r := e.Do("GET", "/admin/libraries/"+lib+"/reviews", admin, nil)
	var list wire.ReviewList
	r.JSON(t, &list)
	if len(list.Items) != 1 || list.Items[0].Kind != "move" {
		t.Fatalf("reviews: %s", r.Body)
	}
	id := list.Items[0].ID
	if r = e.Do("POST", "/admin/libraries/"+lib+"/reviews/"+id+"/resolve", admin, map[string]any{"action": "keep_separate"}); r.StatusCode != http.StatusNoContent {
		t.Fatalf("resolve: %d %s", r.StatusCode, r.Body)
	}
	if r = e.Do("POST", "/admin/libraries/"+lib+"/reviews/"+id+"/resolve", admin, map[string]any{"action": "keep_separate"}); r.StatusCode != http.StatusConflict {
		t.Fatalf("resolving twice: %d %s", r.StatusCode, r.Body)
	}
	// A review id from another library is not found, not leaked.
	other := uuid.NewString()
	if r = e.Do("POST", "/admin/libraries/"+lib+"/reviews/"+other+"/resolve", admin, map[string]any{"action": "keep_separate"}); r.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown review: %d", r.StatusCode)
	}
}
