package httpapi_test

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func TestEditionDetailsFromProtectedEdits(t *testing.T) {
	r := newReadingEnv(t)
	e, ed := r.e, r.ed.ID

	var d wire.EditionDetails
	e.Do("GET", "/editions/"+ed+"/details", r.userA, nil).JSON(t, &d)
	if d.EditionID != ed || d.AddedAt == "" || d.Publisher != nil || d.Description != nil {
		t.Fatalf("a file without those tags must report nothing: %+v", d)
	}

	rev := "0"
	set := func(field string, v any) {
		t.Helper()
		x := r.metaPut(r.admin, ed, field, mw(rev, v, false))
		if x.StatusCode != http.StatusOK {
			t.Fatalf("%s: %d %s", field, x.StatusCode, x.Body)
		}
		var rep wire.EditionMetadataReport
		x.JSON(t, &rep)
		rev = rep.Revision
	}
	set("publisher", "Old House")
	set("published", "1895-05")
	set("page_count", 118)
	set("isbn", "9783161484100")
	set("description", "A traveller builds a machine.")

	// A person without administrator rights still reads the effective values.
	e.Do("GET", "/editions/"+ed+"/details", r.userA, nil).JSON(t, &d)
	if d.Publisher == nil || *d.Publisher != "Old House" || d.Published == nil || *d.Published != "1895-05" ||
		d.PageCount == nil || *d.PageCount != 118 || d.ISBN == nil || *d.ISBN != "9783161484100" || d.Description == nil {
		t.Fatalf("effective details: %+v", d)
	}

	for name, c := range map[string]struct {
		field string
		value any
	}{
		"bad date":      {"published", "1895-13"},
		"bad isbn":      {"isbn", "978-3-16-148410-0"},
		"zero pages":    {"page_count", 0},
		"fractional":    {"page_count", 3.5},
		"empty summary": {"description", "  "},
		"number name":   {"publisher", 5},
	} {
		if x := r.metaPut(r.admin, ed, c.field, mw(rev, c.value, false)); x.StatusCode != http.StatusUnprocessableEntity && x.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s accepted: %d %s", name, x.StatusCode, x.Body)
		}
	}

	// A protected clear is an intentional value, not a gap: the field disappears from the details.
	if x := r.metaPut(r.admin, ed, "publisher", mw(rev, nil, true)); x.StatusCode != http.StatusOK {
		t.Fatalf("clear: %d %s", x.StatusCode, x.Body)
	}
	e.Do("GET", "/editions/"+ed+"/details", r.userA, nil).JSON(t, &d)
	if d.Publisher != nil {
		t.Fatalf("cleared publisher still shown: %+v", d)
	}
	if x := e.Do("GET", "/editions/"+uuid.NewString()+"/details", r.userA, nil); x.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown edition: %d", x.StatusCode)
	}
}

func TestTitlePersonalRatingReviewAndDates(t *testing.T) {
	r := newReadingEnv(t)
	e := r.e
	title := r.ed.TitleID
	path := "/titles/" + title + "/personal"
	put := func(token, base string, op string, data map[string]any) apitest.Response {
		return e.Do("PUT", path, token, map[string]any{"operationId": op, "baseRevision": base, "capturedAt": time.Now().UTC().Format(time.RFC3339), "data": data})
	}

	var p wire.TitlePersonal
	e.Do("GET", path, r.userA, nil).JSON(t, &p)
	if p.Revision != "0" || p.Data.RatingHalves != nil || p.Data.Review != "" || p.DerivedStartedAt != nil {
		t.Fatalf("empty state: %+v", p)
	}

	op := uuid.NewString()
	data := map[string]any{"ratingHalves": 7, "review": "Short and bleak.", "startedAt": nil, "finishedAt": nil}
	first := put(r.userA, "0", op, data)
	first.JSON(t, &p)
	if first.StatusCode != http.StatusOK || p.Revision != "1" || p.Data.RatingHalves == nil || *p.Data.RatingHalves != 7 || p.Data.Review != "Short and bleak." {
		t.Fatalf("set: %d %s", first.StatusCode, first.Body)
	}
	if again := put(r.userA, "0", op, data); again.StatusCode != http.StatusOK || string(again.Body) != string(first.Body) {
		t.Fatalf("replay must return the first answer: %d", again.StatusCode)
	}
	stale := put(r.userA, "0", uuid.NewString(), map[string]any{"ratingHalves": 3, "review": "", "startedAt": nil, "finishedAt": nil})
	if stale.StatusCode != http.StatusConflict || problemMap(t, stale)["currentRevision"] != "1" {
		t.Fatalf("stale write: %d %s", stale.StatusCode, stale.Body)
	}

	for name, bad := range map[string]map[string]any{
		"eleven half stars": {"ratingHalves": 11, "review": "", "startedAt": nil, "finishedAt": nil},
		"zero half stars":   {"ratingHalves": 0, "review": "", "startedAt": nil, "finishedAt": nil},
		"finished before":   {"ratingHalves": nil, "review": "", "startedAt": "2026-02-01T00:00:00Z", "finishedAt": "2026-01-01T00:00:00Z"},
	} {
		if x := put(r.userA, "1", uuid.NewString(), bad); x.StatusCode != http.StatusUnprocessableEntity && x.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s accepted: %d %s", name, x.StatusCode, x.Body)
		}
	}

	// Privacy: an administrator with a grant sees only their own (empty) state, and a person without a grant is refused.
	var other wire.TitlePersonal
	e.Do("GET", path, r.admin, nil).JSON(t, &other)
	if other.Revision != "0" || other.Data.RatingHalves != nil || other.Data.Review != "" {
		t.Fatalf("another account saw personal state: %+v", other)
	}
	if x := e.Do("GET", path, r.userB, nil); x.StatusCode != http.StatusForbidden && x.StatusCode != http.StatusNotFound {
		t.Fatalf("an account without access: %d %s", x.StatusCode, x.Body)
	}

	// Derived dates follow reading history until the person overrides them.
	f := r.ed.File
	fin := e.Do("PUT", "/editions/"+r.ed.ID+"/completion", r.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "0",
		"fileId": f.ID, "contentVersion": f.ContentVersion, "event": "manual_finish", "capturedAt": time.Now().UTC().Format(time.RFC3339)})
	if fin.StatusCode != http.StatusOK {
		t.Fatalf("finish: %d %s", fin.StatusCode, fin.Body)
	}
	e.Do("GET", path, r.userA, nil).JSON(t, &p)
	if p.DerivedFinishedAt == nil || p.Data.FinishedAt != nil {
		t.Fatalf("derived finish: %+v", p)
	}
	over := put(r.userA, "1", uuid.NewString(), map[string]any{"ratingHalves": nil, "review": "", "startedAt": "2026-01-02T03:04:05Z", "finishedAt": "2026-01-09T03:04:05Z"})
	over.JSON(t, &p)
	if over.StatusCode != http.StatusOK || p.Data.RatingHalves != nil || p.Data.StartedAt == nil || p.Revision != "2" || p.DerivedFinishedAt == nil {
		t.Fatalf("override and clear rating: %d %s", over.StatusCode, over.Body)
	}
	if x := e.Do("GET", "/titles/"+uuid.NewString()+"/personal", r.userA, nil); x.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown title: %d", x.StatusCode)
	}
}

func TestOPDSCarriesTheDescriptiveFields(t *testing.T) {
	o := newOPDSEnv(t)
	var ts wire.Titles
	o.e.Do("GET", "/titles?q=zebra", o.admin, nil).JSON(t, &ts)
	if ts.Total != 1 {
		t.Fatalf("titles: %+v", ts)
	}
	var eds wire.Editions
	o.e.Do("GET", "/editions?titleId="+ts.Items[0].ID, o.admin, nil).JSON(t, &eds)
	ed := eds.Items[0].ID

	// The file's own ISBN is already visible without any edit.
	if body := string(o.asA("/opds/v1/publications?q=zebra").Body); !strings.Contains(body, "<dc:identifier>urn:isbn:9783161484100</dc:identifier>") {
		t.Fatalf("embedded ISBN missing from Atom: %s", body)
	}

	rev := "0"
	for field, v := range map[string]any{"publisher": "Old House", "published": "1895-05", "page_count": 118, "description": "A traveller builds a machine."} {
		x := o.e.Do("PUT", "/admin/editions/"+ed+"/metadata/"+field, o.admin, mw(rev, v, false))
		if x.StatusCode != 200 {
			t.Fatalf("%s: %d %s", field, x.StatusCode, x.Body)
		}
		var rep wire.EditionMetadataReport
		x.JSON(t, &rep)
		rev = rep.Revision
	}
	atom := string(o.asA("/opds/v1/publications?q=zebra").Body)
	for _, want := range []string{"<dc:publisher>Old House</dc:publisher>", "<dc:issued>1895-05</dc:issued>", "<summary type=\"text\">A traveller builds a machine."} {
		if !strings.Contains(atom, want) {
			t.Fatalf("Atom lacks %q:\n%s", want, atom)
		}
	}
	js := string(o.asA("/opds/v2/publications?q=zebra").Body)
	for _, want := range []string{`"publisher":"Old House"`, `"published":"1895-05"`, `"numberOfPages":118`, `"description":"A traveller builds a machine.`} {
		if !strings.Contains(js, want) {
			t.Fatalf("JSON lacks %q:\n%s", want, js)
		}
	}
	// A protected clear removes the value from the feeds too.
	if x := o.e.Do("PUT", "/admin/editions/"+ed+"/metadata/publisher", o.admin, mw(rev, nil, true)); x.StatusCode != 200 {
		t.Fatalf("clear: %d", x.StatusCode)
	}
	if strings.Contains(string(o.asA("/opds/v1/publications?q=zebra").Body), "<dc:publisher>") {
		t.Fatal("a cleared publisher is still in the feed")
	}
}

func TestEbookSidecarReadRankAndExport(t *testing.T) {
	r := newReadingEnv(t)
	e, ed := r.e, r.ed.ID
	side := filepath.Join(r.root, "Saga", "vol2.litara.json")
	details := func() wire.EditionDetails {
		var d wire.EditionDetails
		e.Do("GET", "/editions/"+ed+"/details", r.userA, nil).JSON(t, &d)
		return d
	}
	titleOf := func() string {
		var d wire.TitleDetail
		e.Do("GET", "/titles/"+r.ed.TitleID, r.userA, nil).JSON(t, &d)
		return d.Title.Title
	}

	// A sidecar named after the book is read: it outranks the file's own tags and fills what the file lacks.
	if err := os.WriteFile(side, []byte(`{"title":"Sidecar Title","publisher":"Sidecar House","published":"1895-05","description":"From the sidecar.","pageCount":412,"tags":["Classic"],"language":"de"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	scanTwice(t, e, r.admin, r.lib)
	if d := details(); d.Publisher == nil || *d.Publisher != "Sidecar House" || d.PageCount == nil || *d.PageCount != 412 || d.Description == nil {
		t.Fatalf("sidecar values not shown: %+v", d)
	}
	if got := titleOf(); got != "Sidecar Title" {
		t.Fatalf("the sidecar title should win over the file's: %q", got)
	}
	var rep wire.EditionMetadataReport
	e.Do("GET", "/admin/editions/"+ed+"/metadata", r.admin, nil).JSON(t, &rep)
	if f := field(rep, "title"); f == nil || f.Source != "sidecar" || len(f.Conflicts) == 0 {
		t.Fatalf("provenance: %+v", f)
	}

	// A protected edit still outranks it; removing the edit lets the sidecar show again.
	x := r.metaPut(r.admin, ed, "publisher", mw(rep.Revision, "Edited House", false))
	x.JSON(t, &rep)
	if d := details(); d.Publisher == nil || *d.Publisher != "Edited House" {
		t.Fatalf("edit must win: %+v", d)
	}

	// Deleting the sidecar removes its evidence on the next scan; the edit and the file's own tags remain.
	if err := os.Remove(side); err != nil {
		t.Fatal(err)
	}
	scanTwice(t, e, r.admin, r.lib)
	if d := details(); d.PageCount != nil || d.Description != nil || d.Publisher == nil || *d.Publisher != "Edited House" {
		t.Fatalf("after removing the sidecar: %+v", d)
	}
	if got := titleOf(); got != "Second Volume" {
		t.Fatalf("title should fall back to the file's: %q", got)
	}

	// Export: plan (nothing written), approve, execute; the new file is named after the book and is read back on the next scan.
	pr := e.Do("POST", "/admin/editions/"+ed+"/writebacks/sidecar", r.admin, nil)
	if pr.StatusCode != http.StatusCreated {
		t.Fatalf("plan: %d %s", pr.StatusCode, pr.Body)
	}
	var wb wire.Writeback
	pr.JSON(t, &wb)
	if _, err := os.Stat(side); err == nil {
		t.Fatal("planning must not write")
	}
	if a := e.Do("POST", "/admin/writebacks/"+wb.ID+"/approve", r.admin, nil); a.StatusCode != http.StatusNoContent {
		t.Fatalf("approve: %d %s", a.StatusCode, a.Body)
	}
	ex := e.Do("POST", "/admin/writebacks/"+wb.ID+"/execute", r.admin, nil)
	ex.JSON(t, &wb)
	if ex.StatusCode != 200 || wb.Stage != "published" {
		t.Fatalf("execute: %d %s", ex.StatusCode, ex.Body)
	}
	b, err := os.ReadFile(side)
	if err != nil || !strings.Contains(string(b), `"publisher": "Edited House"`) || !strings.Contains(string(b), `"title": "Second Volume"`) {
		t.Fatalf("exported sidecar: %v %s", err, b)
	}
	if x := e.Do("POST", "/admin/editions/"+uuid.NewString()+"/writebacks/sidecar", r.admin, nil); x.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown edition: %d", x.StatusCode)
	}
	if x := e.Do("POST", "/admin/editions/"+ed+"/writebacks/sidecar", r.userA, nil); x.StatusCode != http.StatusForbidden {
		t.Fatalf("a non-admin planned an export: %d", x.StatusCode)
	}
}

func TestRecordingDetailsAndTagWriteBack(t *testing.T) {
	e := apitest.New(t)
	root, _ := filepath.Abs(t.TempDir())
	admin := e.Login(seed.AdminName, "cli").AccessToken
	d := setupLibrary(t, e, admin, root)
	lib := d.Library.ID
	audioAt(t, filepath.Join(root, "Book", "1.mp3"), 440, "album", "Original Title", "artist", "An Author", "publisher", "Tag House", "date", "2019-03-12")
	scanTwice(t, e, admin, lib)
	var rec string
	if err := e.Pool.QueryRow(t.Context(), `SELECT id FROM recordings WHERE library_id=$1`, lib).Scan(&rec); err != nil {
		t.Fatal(err)
	}
	if r := e.Do("PUT", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+lib, admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d", r.StatusCode)
	}
	userA := e.Login(seed.UserAName, "phone").AccessToken
	var rd wire.RecordingDetails
	e.Do("GET", "/recordings/"+rec+"/details", userA, nil).JSON(t, &rd)
	if rd.RecordingID != rec || rd.Publisher == nil || *rd.Publisher != "Tag House" || rd.Published == nil || *rd.Published != "2019-03-12" || rd.AddedAt == "" {
		t.Fatalf("the files' own tags should show: %+v", rd)
	}
	for field, v := range map[string]any{"publisher": "Edited House", "isbn": "9783161484100", "description": "A recording about a machine."} {
		if r := e.Do("PUT", "/admin/recordings/"+rec+"/metadata/"+field, admin, map[string]any{"value": v}); r.StatusCode != http.StatusNoContent {
			t.Fatalf("%s: %d %s", field, r.StatusCode, r.Body)
		}
	}
	e.Do("GET", "/recordings/"+rec+"/details", userA, nil).JSON(t, &rd)
	if *rd.Publisher != "Edited House" || rd.ISBN == nil || rd.Description == nil {
		t.Fatalf("edits: %+v", rd)
	}
	if x := e.Do("GET", "/recordings/"+uuid.NewString()+"/details", userA, nil); x.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown recording: %d", x.StatusCode)
	}
}

func TestLibraryTableSortsFiltersAndShowsColumns(t *testing.T) {
	o := newOPDSEnv(t)
	e := o.e
	list := func(query string) wire.TitleRows {
		t.Helper()
		var out wire.TitleRows
		r := e.Do("GET", "/titles?libraryId="+o.lib+"&"+query, o.userA, nil)
		if r.StatusCode != http.StatusOK {
			t.Fatalf("%s: %d %s", query, r.StatusCode, r.Body)
		}
		r.JSON(t, &out)
		return out
	}
	names := func(l wire.TitleRows) []string {
		var n []string
		for _, i := range l.Items {
			n = append(n, i.Title.Title)
		}
		return n
	}
	all := list("sort=title")
	if all.Total != 3 || len(all.Items[0].LibraryIDs) != 1 || all.Items[0].AddedAt == "" || all.Items[0].Status != "unread" {
		t.Fatalf("columns: %+v", all)
	}
	asc, desc := names(list("sort=title&order=asc")), names(list("sort=title&order=desc"))
	if len(asc) != 3 || asc[0] != desc[2] || asc[2] != desc[0] {
		t.Fatalf("title order: %v / %v", asc, desc)
	}
	// Formats and the format filter.
	if l := list("format=epub"); l.Total != 2 {
		t.Fatalf("epub filter: %+v", names(l))
	}
	if l := list("format=cbz"); l.Total != 1 || l.Items[0].Formats[0] != "cbz" {
		t.Fatalf("cbz filter: %+v", l)
	}
	// Text filters are literal substrings.
	if l := list("author=zed"); l.Total != 1 || l.Items[0].Title.Title != "Zebra Tales" {
		t.Fatalf("author filter: %v", names(l))
	}
	if l := list("author=%25"); l.Total != 0 {
		t.Fatalf("a wildcard matched: %v", names(l))
	}
	if l := list("series=saga"); l.Total != 2 {
		t.Fatalf("series filter: %v", names(l))
	}
	first := func(r wire.TitleRow) string {
		if len(r.Authors) == 0 {
			return ""
		}
		return strings.ToLower(string(r.Authors[0]))
	}
	by := list("sort=author")
	for i := 1; i < len(by.Items); i++ {
		if first(by.Items[i-1]) > first(by.Items[i]) {
			t.Fatalf("author order: %q before %q", first(by.Items[i-1]), first(by.Items[i]))
		}
	}

	// The caller's own rating and status, sortable and filterable; another account's are never shown.
	zebra := e.Do("GET", "/titles?libraryId="+o.lib+"&q=zebra", o.userA, nil)
	var z wire.TitleRows
	zebra.JSON(t, &z)
	zid := z.Items[0].ID
	put := e.Do("PUT", "/titles/"+zid+"/personal", o.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "0",
		"capturedAt": time.Now().UTC().Format(time.RFC3339), "data": map[string]any{"ratingHalves": 9, "review": "", "startedAt": nil, "finishedAt": nil}})
	if put.StatusCode != http.StatusOK {
		t.Fatalf("rate: %d %s", put.StatusCode, put.Body)
	}
	if l := list("rated=rated"); l.Total != 1 || l.Items[0].RatingHalves == nil || *l.Items[0].RatingHalves != 9 {
		t.Fatalf("rated filter: %+v", l)
	}
	if l := list("rated=unrated"); l.Total != 2 {
		t.Fatalf("unrated filter: %v", names(l))
	}
	if l := list("sort=rating&order=desc"); l.Items[0].Title.Title != "Zebra Tales" {
		t.Fatalf("rating order: %v", names(l))
	}
	if l := list("sort=rating&order=asc"); l.Items[0].Title.Title != "Zebra Tales" {
		t.Fatalf("unrated titles sort last in both directions, so the one rated title is first: %v", names(l))
	}
	if l := list("status=unread"); l.Total != 3 {
		t.Fatalf("status: %v", names(l))
	}

	// Paging keeps the total, even past the end.
	if l := list("sort=title&size=2&page=1"); l.Total != 3 || len(l.Items) != 1 {
		t.Fatalf("page 2: %+v", l)
	}
	if l := list("sort=title&size=2&page=5"); l.Total != 3 || len(l.Items) != 0 {
		t.Fatalf("past the end: %+v", l)
	}
	if r := e.Do("GET", "/titles?sort=bogus", o.userA, nil); r.StatusCode != http.StatusUnprocessableEntity && r.StatusCode != http.StatusBadRequest {
		t.Fatalf("an unknown sort key: %d", r.StatusCode)
	}
}

func TestLibraryIconIsSetByAdministratorsAndShownToEveryone(t *testing.T) {
	o := newOPDSEnv(t)
	e := o.e
	var libs wire.LibraryList
	iconOf := func() *string {
		t.Helper()
		e.Do("GET", "/libraries", o.userA, nil).JSON(t, &libs)
		for _, l := range libs.Items {
			if l.ID == o.lib {
				return l.Icon
			}
		}
		t.Fatalf("library missing: %+v", libs)
		return nil
	}
	if iconOf() != nil {
		t.Fatalf("the default is no icon: %+v", libs)
	}
	path := "/admin/libraries/" + o.lib + "/icon"
	set := func(token string, icon any) apitest.Response {
		return e.Do("PUT", path, token, map[string]any{"icon": icon})
	}
	if r := set(o.userA, "books"); r.StatusCode != http.StatusForbidden {
		t.Fatalf("a non-admin set an icon: %d", r.StatusCode)
	}
	if r := set(o.admin, "Not An Icon!"); r.StatusCode != http.StatusUnprocessableEntity && r.StatusCode != http.StatusBadRequest {
		t.Fatalf("a bad name: %d %s", r.StatusCode, r.Body)
	}
	if r := set(o.admin, "castle"); r.StatusCode != http.StatusOK {
		t.Fatalf("set: %d %s", r.StatusCode, r.Body)
	}
	if got := iconOf(); got == nil || *got != "castle" {
		t.Fatalf("everyone sees it: %+v", libs)
	}
	if r := set(o.admin, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("clear: %d", r.StatusCode)
	}
	if iconOf() != nil {
		t.Fatalf("cleared: %+v", libs)
	}
	if r := e.Do("PUT", "/admin/libraries/"+uuid.NewString()+"/icon", o.admin, map[string]any{"icon": "books"}); r.StatusCode != http.StatusForbidden && r.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown library: %d", r.StatusCode)
	}
}

// ADR-0085: filter trees. The single-value filters and the tree share one compiler, so GET results are the oracle.
func TestTitleSearchFilterTree(t *testing.T) {
	o := newOPDSEnv(t)
	e := o.e
	search := func(body map[string]any) (wire.TitleRows, int) {
		t.Helper()
		body["libraryId"] = o.lib
		r := e.Do("POST", "/titles/search", o.userA, body)
		var out wire.TitleRows
		if r.StatusCode == http.StatusOK {
			r.JSON(t, &out)
		}
		return out, r.StatusCode
	}
	get := func(query string) wire.TitleRows {
		t.Helper()
		var out wire.TitleRows
		r := e.Do("GET", "/titles?libraryId="+o.lib+"&"+query, o.userA, nil)
		r.JSON(t, &out)
		return out
	}
	ids := func(l wire.TitleRows) string {
		var s []string
		for _, i := range l.Items {
			s = append(s, i.ID)
		}
		return strings.Join(s, ",")
	}
	rule := func(field, op string, v any) map[string]any {
		m := map[string]any{"type": "rule", "field": field, "operator": op}
		if v != nil {
			m["value"] = v
		}
		return m
	}
	group := func(join string, rules ...map[string]any) map[string]any {
		return map[string]any{"type": "group", "join": join, "rules": rules}
	}

	// No tree means everything; the sort keys order exactly as GET does.
	if l, code := search(map[string]any{}); code != http.StatusOK || l.Total != 3 {
		t.Fatalf("empty search: %d %+v", code, l)
	}
	for _, k := range []string{"title", "author", "series", "added", "editions"} {
		for _, ord := range []string{"asc", "desc"} {
			l, _ := search(map[string]any{"sort": k, "order": ord})
			if want := get("sort=" + k + "&order=" + ord); ids(l) != ids(want) {
				t.Fatalf("sort %s %s differs from GET: %s vs %s", k, ord, ids(l), ids(want))
			}
		}
	}

	// AND, OR, NOT and nesting against the single-value oracle.
	and, _ := search(map[string]any{"filter": group("AND", rule("format", "is", "epub"), rule("series", "contains", "saga"))})
	if want := get("format=epub&series=saga"); ids(and) != ids(want) || and.Total == 0 {
		t.Fatalf("AND: %s vs %s", ids(and), ids(want))
	}
	or, _ := search(map[string]any{"filter": group("OR", rule("author", "contains", "zed"), rule("format", "is", "cbz"))})
	union := map[string]bool{}
	for _, l := range []wire.TitleRows{get("author=zed"), get("format=cbz")} {
		for _, i := range l.Items {
			union[i.ID] = true
		}
	}
	if int(or.Total) != len(union) || or.Total == 0 {
		t.Fatalf("OR: %d vs %d", or.Total, len(union))
	}
	not, _ := search(map[string]any{"filter": rule("format", "is_not", "cbz")})
	if want := get("format=epub"); not.Total != want.Total {
		t.Fatalf("is_not: %d vs %d", not.Total, want.Total)
	}
	nested, _ := search(map[string]any{"filter": group("AND", group("OR", rule("author", "contains", "zed"), rule("format", "is", "cbz")), rule("format", "is_not", "cbz"))})
	if want := get("author=zed&format=epub"); ids(nested) != ids(want) {
		t.Fatalf("nested: %s vs %s", ids(nested), ids(want))
	}
	if l, _ := search(map[string]any{"filter": rule("format", "is", []string{"epub", "cbz"})}); l.Total != 3 {
		t.Fatalf("list value: %d", l.Total)
	}
	if l, _ := search(map[string]any{"filter": rule("has_audio", "is", true)}); l.Total != get("mediaKind=audio").Total {
		t.Fatalf("flag: %d", l.Total)
	}
	if l, _ := search(map[string]any{"filter": rule("author", "is_empty", nil)}); l.Total > 3 {
		t.Fatalf("is_empty: %d", l.Total)
	}

	// Hostile values are data: they match nothing and change nothing.
	for _, v := range []string{"'; DROP TABLE titles; --", "\" OR 1=1 --", "%", "\\"} {
		if l, code := search(map[string]any{"filter": rule("title", "contains", v)}); code != http.StatusOK || l.Total != 0 {
			t.Fatalf("hostile %q: %d %d", v, code, l.Total)
		}
	}
	if get("sort=title").Total != 3 {
		t.Fatal("titles were damaged")
	}

	// The caller's own rating, in stars.
	zebra := get("q=zebra")
	put := e.Do("PUT", "/titles/"+zebra.Items[0].ID+"/personal", o.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "0",
		"capturedAt": time.Now().UTC().Format(time.RFC3339), "data": map[string]any{"ratingHalves": 9, "review": "", "startedAt": nil, "finishedAt": nil}})
	if put.StatusCode != http.StatusOK {
		t.Fatalf("rate: %d %s", put.StatusCode, put.Body)
	}
	for _, c := range []struct {
		rule map[string]any
		want int64
	}{
		{rule("rating", "gt", 4), 1}, {rule("rating", "gt", 4.5), 0}, {rule("rating", "is", 4.5), 1}, {rule("rating", "between", 4), 0},
		{rule("rating", "is_empty", nil), 2}, {rule("rating", "not_empty", nil), 1},
	} {
		if c.rule["operator"] == "between" {
			c.rule["valueTo"] = 5
			c.want = 1
		}
		if l, code := search(map[string]any{"filter": c.rule}); code != http.StatusOK || l.Total != c.want {
			t.Fatalf("rating %v: %d total %d want %d", c.rule, code, l.Total, c.want)
		}
	}
	// Dates: everything was added today, so "after" a past day matches and "before" it does not.
	if l, _ := search(map[string]any{"filter": rule("added", "after", "2000-01-01")}); l.Total != 3 {
		t.Fatalf("added after: %d", l.Total)
	}
	if l, _ := search(map[string]any{"filter": rule("added", "before", "2000-01-01")}); l.Total != 0 {
		t.Fatalf("added before: %d", l.Total)
	}

	// Refusals are 422 with nothing run.
	many := make([]map[string]any, 0, 31)
	for i := 0; i < 31; i++ {
		many = append(many, rule("title", "contains", "x"))
	}
	deep := group("AND", group("AND", group("AND", group("AND", rule("title", "contains", "x")))))
	for name, f := range map[string]map[string]any{
		"unknown field":      rule("nope", "is", "x"),
		"bad operator":       rule("has_audio", "contains", "x"),
		"number for text":    rule("title", "contains", 5),
		"empty value":        rule("title", "is", ""),
		"bad status":         rule("status", "is", "lost"),
		"bad library":        rule("library", "is", "not-a-uuid"),
		"bad rating step":    rule("rating", "is", 4.3),
		"bad date":           rule("added", "before", "yesterday"),
		"too deep":           deep,
		"too many rules":     group("OR", group("AND", many[:16]...), group("AND", many[16:]...)),
		"group without join": {"type": "group", "rules": []map[string]any{}},
	} {
		if _, code := search(map[string]any{"filter": f}); code != http.StatusUnprocessableEntity {
			t.Fatalf("%s: got %d, want 422", name, code)
		}
	}
}
