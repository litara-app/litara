package httpapi_test

import (
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func (r *readingEnv) addCopy(token string, body map[string]any) (wire.PhysicalCopy, apitest.Response) {
	if _, ok := body["operationId"]; !ok {
		body["operationId"] = uuid.NewString()
	}
	if _, ok := body["libraryId"]; !ok {
		body["libraryId"] = r.lib
	}
	if _, ok := body["copy"]; !ok {
		body["copy"] = map[string]any{}
	}
	x := r.e.Do("POST", "/admin/physical-copies", token, body)
	var c wire.PhysicalCopy
	if x.StatusCode == http.StatusOK {
		x.JSON(r.t, &c)
	}
	return c, x
}

func (r *readingEnv) rows(t *testing.T, token, query string) []wire.TitleRow {
	t.Helper()
	var out wire.TitleRows
	x := r.e.Do("GET", "/titles?size=200&"+query, token, nil)
	if x.StatusCode != http.StatusOK {
		t.Fatalf("titles %s: %d %s", query, x.StatusCode, x.Body)
	}
	x.JSON(t, &out)
	return out.Items
}

func rowFor(rows []wire.TitleRow, id string) *wire.TitleRow {
	for i := range rows {
		if rows[i].ID == id {
			return &rows[i]
		}
	}
	return nil
}

func paperWrite(base, status string, page any) map[string]any {
	m := map[string]any{"operationId": uuid.NewString(), "baseRevision": base, "status": status, "capturedAt": "2026-11-20T10:00:00Z"}
	if page != nil {
		m["page"] = page
	}
	return m
}

// ADR-0116: a paper-only title is held through its copy, follows library access and keeps each reader's own reading.
func TestPhysicalCopiesAndPaperReading(t *testing.T) {
	r := newReadingEnv(t)
	r.t = t
	e := r.e

	newBook := map[string]any{"title": "Paper Walls", "authors": []string{"Nell Printed"}, "series": "Stacks", "seriesIndex": 2, "publisher": "Quire", "published": "1999"}
	// Only an administrator adds copies.
	if _, x := r.addCopy(r.userA, map[string]any{"newTitle": newBook}); x.StatusCode != http.StatusForbidden {
		t.Fatalf("a reader added a copy: %d %s", x.StatusCode, x.Body)
	}
	body := map[string]any{"operationId": uuid.NewString(), "newTitle": newBook, "copy": map[string]any{"binding": "paperback", "isbn": "978-0-306-40615-7",
		"language": "en", "pageCount": 320, "location": "  Study, second shelf ", "acquiredOn": "2026-01-31"}}
	c, x := r.addCopy(r.admin, body)
	if x.StatusCode != 200 || c.Revision != "1" || *c.ISBN != "9780306406157" || *c.Location != "Study, second shelf" || *c.PageCount != 320 {
		t.Fatalf("add: %d %s", x.StatusCode, x.Body)
	}
	// A retry of the same operation returns the same copy and adds nothing.
	again, x := r.addCopy(r.admin, body)
	if x.StatusCode != 200 || again.ID != c.ID {
		t.Fatalf("replay: %d %s", x.StatusCode, x.Body)
	}

	row := rowFor(r.rows(t, r.userA, ""), c.TitleID)
	if row == nil || row.PhysicalCopyCount != 1 || row.EditionCount != 0 || row.RecordingCount != 0 || !slices.Equal(row.Formats, []string{"paper"}) ||
		row.Status != "unread" || row.PageCount == nil || *row.PageCount != 320 || row.Publisher == nil || *row.Publisher != "Quire" || len(row.LibraryIDs) != 1 {
		t.Fatalf("row: %+v", row)
	}
	if rowFor(r.rows(t, r.userB, ""), c.TitleID) != nil {
		t.Fatal("an account without the library sees the paper title")
	}
	var detail wire.TitleDetail
	x = e.Do("GET", "/titles/"+c.TitleID, r.userA, nil)
	if x.StatusCode != 200 {
		t.Fatalf("title: %d %s", x.StatusCode, x.Body)
	}
	x.JSON(t, &detail)
	if detail.Title.PhysicalCopyCount != 1 || detail.Publisher == nil || *detail.Publisher != "Quire" || detail.Published == nil || *detail.Published != "1999" || detail.Description != nil {
		t.Fatalf("title details: %+v", detail)
	}
	for _, path := range []string{"/titles/" + c.TitleID, "/titles/" + c.TitleID + "/physical-copies", "/physical-copies/" + c.ID + "/reading"} {
		if x := e.Do("GET", path, r.userB, nil); x.StatusCode != 403 {
			t.Fatalf("%s without access: %d %s", path, x.StatusCode, x.Body)
		}
	}
	for query, want := range map[string]bool{"format=paper": true, "format=epub": false, "q=paper%20walls": true, "series=stacks": true, "language=en": true} {
		if got := rowFor(r.rows(t, r.userA, query), c.TitleID) != nil; got != want {
			t.Fatalf("filter %s: %v", query, got)
		}
	}
	var found wire.TitleRows
	e.Do("POST", "/titles/search", r.userA, map[string]any{"filter": rule("has_physical", "is", true)}).JSON(t, &found)
	if found.Total != 1 || found.Items[0].ID != c.TitleID {
		t.Fatalf("owned on paper: %+v", found)
	}
	var authors struct {
		Total int64 `json:"total"`
	}
	e.Do("GET", "/authors?q=printed", r.userA, nil).JSON(t, &authors)
	if authors.Total != 1 {
		t.Fatalf("authors: %+v", authors)
	}
	var series wire.DirectorySeriesPage
	e.Do("GET", "/series?q=stacks", r.userA, nil).JSON(t, &series)
	if series.Total != 1 || series.Items[0].Covers[0].Medium != "ebook" {
		t.Fatalf("series: %+v", series)
	}
	// There is nothing to open, so it is never the book to continue.
	var cont wire.ContinueReading
	e.Do("GET", "/continue-reading?by=series&name=Stacks", r.userA, nil).JSON(t, &cont)
	// Everything the title page asks for answers for a paper-only title, and still needs library access.
	for _, tail := range []string{"/history", "/reading-history", "/reading-sessions", "/listening-sessions", "/paper-history", "/personal", "/recordings"} {
		if x := e.Do("GET", "/titles/"+c.TitleID+tail, r.userA, nil); x.StatusCode != 200 {
			t.Fatalf("%s: %d %s", tail, x.StatusCode, x.Body)
		}
	}
	if x := e.Do("GET", "/titles/"+c.TitleID+"/history", r.userB, nil); x.StatusCode != 403 {
		t.Fatalf("history without access: %d %s", x.StatusCode, x.Body)
	}
	// There is no cover to extract, and asking must not record that: an ebook linked later still gets its cover.
	if x := e.Do("GET", "/titles/"+c.TitleID+"/cover?medium=ebook", r.userA, nil); x.StatusCode != 404 {
		t.Fatalf("cover: %d %s", x.StatusCode, x.Body)
	}
	var remembered int
	if err := e.Pool.QueryRow(t.Context(), "SELECT count(*) FROM title_covers WHERE title_id = $1", c.TitleID).Scan(&remembered); err != nil || remembered != 0 {
		t.Fatalf("a missing cover was remembered for a paper title: %d %v", remembered, err)
	}
	// It can go on a shelf like any title.
	shelf := uuid.NewString()
	if x := e.Do("PUT", "/shelves/"+shelf, r.userA, r.shelfBody(uuid.NewString(), "0", "manual", "private", "Mine", nil)); x.StatusCode != 200 {
		t.Fatalf("shelf: %d %s", x.StatusCode, x.Body)
	}
	if x := e.Do("PUT", "/shelves/"+shelf+"/titles/"+c.TitleID, r.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "1", "capturedAt": "2026-11-20T10:00:00Z"}); x.StatusCode != 200 {
		t.Fatalf("shelve: %d %s", x.StatusCode, x.Body)
	}
	if got := r.shelfTitles(t, r.userA, shelf); got.Total != 1 || got.Items[0].PhysicalCopyCount != 1 {
		t.Fatalf("shelf titles: %+v", got)
	}

	// Reading needs no page number.
	reading := "/physical-copies/" + c.ID + "/reading"
	var st wire.PaperReading
	e.Do("GET", reading, r.userA, nil).JSON(t, &st)
	if st.Revision != "0" || st.Status != "not_started" || st.Page != nil {
		t.Fatalf("initial: %+v", st)
	}
	start := paperWrite("0", "reading", nil)
	first := e.Do("PUT", reading, r.userA, start)
	first.JSON(t, &st)
	if first.StatusCode != 200 || st.Revision != "1" || st.Status != "reading" || st.Page != nil {
		t.Fatalf("start: %d %s", first.StatusCode, first.Body)
	}
	if replay := e.Do("PUT", reading, r.userA, start); replay.StatusCode != 200 || string(replay.Body) != string(first.Body) {
		t.Fatalf("replay: %d %s", replay.StatusCode, replay.Body)
	}
	if x := e.Do("PUT", reading, r.userA, paperWrite("0", "finished", nil)); x.StatusCode != 409 || problemMap(t, x)["currentRevision"] != "1" {
		t.Fatalf("stale: %d %s", x.StatusCode, x.Body)
	}
	for name, w := range map[string]map[string]any{
		"above the page count": paperWrite("1", "reading", 321),
		"page before starting": paperWrite("1", "not_started", 5),
		"page zero":            paperWrite("1", "reading", 0),
		"unknown status":       paperWrite("1", "paused", nil),
	} {
		if x := e.Do("PUT", reading, r.userA, w); x.StatusCode != 422 {
			t.Fatalf("%s: %d %s", name, x.StatusCode, x.Body)
		}
	}
	if x := e.Do("PUT", reading, r.userA, paperWrite("1", "reading", 120)); x.StatusCode != 200 {
		t.Fatalf("page: %d %s", x.StatusCode, x.Body)
	}
	if got := rowFor(r.rows(t, r.userA, ""), c.TitleID); got.Status != "reading" {
		t.Fatalf("status while reading: %s", got.Status)
	}
	e.Do("GET", "/continue-reading?by=series&name=Stacks", r.userA, nil).JSON(t, &cont)
	if cont.TitleID != nil {
		t.Fatalf("a paper-only title was offered to continue: %+v", cont)
	}

	stats := func() wire.ReadingStats {
		var s wire.ReadingStats
		e.Do("GET", "/stats/reading?from=2026-11-01&to=2026-11-30&timeZone=UTC", r.userA, nil).JSON(t, &s)
		return s
	}
	if x := e.Do("PUT", reading, r.userA, paperWrite("2", "finished", nil)); x.StatusCode != 200 {
		t.Fatalf("finish: %d %s", x.StatusCode, x.Body)
	}
	if s := stats(); s.PaperBooksFinished != 1 || s.Books != 0 || s.ActiveSeconds != 0 || s.ReadingDays != 0 || s.CurrentStreak != 0 || len(s.Days) != 0 || len(s.Activity) != 0 {
		t.Fatalf("stats after finishing: %+v", s)
	}
	var personal wire.TitlePersonal
	e.Do("GET", "/titles/"+c.TitleID+"/personal", r.userA, nil).JSON(t, &personal)
	if personal.DerivedStartedAt == nil || personal.DerivedFinishedAt == nil {
		t.Fatalf("derived dates: %+v", personal)
	}
	// Reading it again keeps the earlier finish; marking it not finished takes the latest finish back.
	e.Do("PUT", reading, r.userA, paperWrite("3", "reading", nil))
	if s := stats(); s.PaperBooksFinished != 1 {
		t.Fatalf("reading again: %+v", s)
	}
	e.Do("PUT", reading, r.userA, paperWrite("4", "finished", nil))
	e.Do("PUT", reading, r.userA, paperWrite("5", "not_started", nil))
	var hist wire.PaperHistory
	e.Do("GET", "/titles/"+c.TitleID+"/paper-history", r.userA, nil).JSON(t, &hist)
	var events []string
	for _, h := range hist.Items {
		events = append(events, h.Event)
	}
	if want := []string{"started", "finished", "started", "finished", "unfinished"}; !slices.Equal(events, want) {
		t.Fatalf("history: %v", events)
	}
	if s := stats(); s.PaperBooksFinished != 1 { // the first finish stands
		t.Fatalf("after taking back the second finish: %+v", s)
	}
	e.Do("PUT", reading, r.userA, paperWrite("6", "finished", nil))

	// Reading is private to the account, even for a second reader of the same library.
	if x := e.Do("PUT", "/admin/users/"+e.Fix.UserBID.String()+"/libraries/"+r.lib, r.admin, nil); x.StatusCode != http.StatusNoContent {
		t.Fatalf("grant B: %d", x.StatusCode)
	}
	e.Do("GET", reading, r.userB, nil).JSON(t, &st)
	e.Do("GET", "/titles/"+c.TitleID+"/paper-history", r.userB, nil).JSON(t, &hist)
	if st.Revision != "0" || st.Status != "not_started" || hist.Total != 0 || rowFor(r.rows(t, r.userB, ""), c.TitleID).Status != "unread" {
		t.Fatalf("B sees A's reading: %+v %+v", st, hist)
	}

	// Copies are changed with a revision, by administrators only.
	upd := map[string]any{"operationId": uuid.NewString(), "baseRevision": "1", "titleId": c.TitleID, "libraryId": r.lib, "copy": map[string]any{"location": "Loft"}}
	if x := e.Do("PUT", "/admin/physical-copies/"+c.ID, r.userA, upd); x.StatusCode != 403 {
		t.Fatalf("reader update: %d", x.StatusCode)
	}
	x = e.Do("PUT", "/admin/physical-copies/"+c.ID, r.admin, upd)
	var changed wire.PhysicalCopy
	x.JSON(t, &changed)
	if x.StatusCode != 200 || changed.Revision != "2" || *changed.Location != "Loft" || changed.ISBN != nil || changed.PageCount != nil {
		t.Fatalf("update: %d %s", x.StatusCode, x.Body)
	}
	upd["operationId"] = uuid.NewString()
	if x := e.Do("PUT", "/admin/physical-copies/"+c.ID, r.admin, upd); x.StatusCode != 409 || problemMap(t, x)["currentRevision"] != "2" {
		t.Fatalf("stale update: %d %s", x.StatusCode, x.Body)
	}
	var places wire.CopyLocations
	e.Do("GET", "/admin/physical-copy-locations", r.admin, nil).JSON(t, &places)
	if !slices.Equal(places.Items, []string{"Loft"}) {
		t.Fatalf("locations: %+v", places)
	}

	// A paper-only title's details are saved through the title.
	meta := "/admin/titles/" + c.TitleID + "/metadata"
	var rep wire.MetadataReport
	e.Do("GET", meta, r.admin, nil).JSON(t, &rep)
	save := map[string]any{"operationId": uuid.NewString(), "baseRevision": rep.Revision, "changes": []map[string]any{
		{"field": "title", "action": "set", "value": "Paper Walls, Revised"}, {"field": "series_name", "action": "set", "clear": true, "value": nil}}}
	if x := e.Do("PATCH", meta, r.userA, save); x.StatusCode != 403 {
		t.Fatalf("reader metadata: %d", x.StatusCode)
	}
	if x := e.Do("PATCH", meta, r.admin, save); x.StatusCode != 200 {
		t.Fatalf("save details: %d %s", x.StatusCode, x.Body)
	}
	if got := rowFor(r.rows(t, r.userA, ""), c.TitleID); got.Title.Title != "Paper Walls, Revised" || len(got.Series) != 0 {
		t.Fatalf("after save: %+v", got)
	}
	for _, bad := range []string{"isbn", "narrators"} {
		y := e.Do("PATCH", meta, r.admin, map[string]any{"operationId": uuid.NewString(), "baseRevision": "1",
			"changes": []map[string]any{{"field": bad, "action": "reset"}}})
		if y.StatusCode != 422 {
			t.Fatalf("%s: %d %s", bad, y.StatusCode, y.Body)
		}
	}

	// Removing the copy hides the title and keeps each reader's history and finish.
	rm := map[string]any{"operationId": uuid.NewString(), "baseRevision": "2"}
	gone := e.Do("POST", "/admin/physical-copies/"+c.ID+"/remove", r.admin, rm)
	if gone.StatusCode != 200 {
		t.Fatalf("remove: %d %s", gone.StatusCode, gone.Body)
	}
	if y := e.Do("POST", "/admin/physical-copies/"+c.ID+"/remove", r.admin, rm); y.StatusCode != 200 || string(y.Body) != string(gone.Body) {
		t.Fatalf("remove replay: %d %s", y.StatusCode, y.Body)
	}
	if rowFor(r.rows(t, r.userA, ""), c.TitleID) != nil {
		t.Fatal("a title with only a removed copy is still listed")
	}
	if y := e.Do("GET", reading, r.userA, nil); y.StatusCode != 404 {
		t.Fatalf("reading a removed copy: %d", y.StatusCode)
	}
	e.Do("GET", "/titles/"+c.TitleID+"/paper-history", r.userA, nil).JSON(t, &hist)
	if hist.Total != 6 || stats().PaperBooksFinished != 1 {
		t.Fatalf("history after removal: %d %+v", hist.Total, stats())
	}
}

// ADR-0116: copies join books already in the catalogue only by the person's choice, and files and copies never remove
// one another.
func TestPaperCopiesAndFilesShareATitleOnlyByChoice(t *testing.T) {
	r := newReadingEnv(t)
	r.t = t
	e := r.e
	ebook := *rowFor(r.rows(t, r.userA, ""), r.ed.TitleID)

	// Same name and first author, differently punctuated: the person is asked.
	same := map[string]any{"title": "second volume!", "authors": []string{"Ada  Author"}}
	if _, x := r.addCopy(r.admin, map[string]any{"newTitle": same}); x.StatusCode != 409 || x.Code() != "title_match" {
		t.Fatalf("name match: %d %s", x.StatusCode, x.Body)
	}
	// So is the same ISBN under another name.
	if _, x := r.addCopy(r.admin, map[string]any{"newTitle": map[string]any{"title": "Another Name"}, "copy": map[string]any{"isbn": "9781402894626"}}); x.Code() != "title_match" {
		t.Fatalf("isbn match: %d %s", x.StatusCode, x.Body)
	}
	var look wire.PaperLookupResults
	x := e.Do("POST", "/admin/libraries/"+r.lib+"/physical-lookup", r.admin, map[string]any{"isbn": "978-1-4028-9462-6"})
	x.JSON(t, &look)
	if x.StatusCode != 200 || look.Enabled || len(look.Matches) != 1 || look.Matches[0].TitleID != ebook.ID || !look.Matches[0].SameISBN {
		t.Fatalf("lookup: %d %s", x.StatusCode, x.Body)
	}
	if y := e.Do("POST", "/admin/libraries/"+r.lib+"/physical-lookup", r.userA, map[string]any{"title": "x"}); y.StatusCode != 403 {
		t.Fatalf("reader lookup: %d", y.StatusCode)
	}

	// Attaching to the ebook's title: one title with both, and two copies of it.
	one, x := r.addCopy(r.admin, map[string]any{"titleId": ebook.ID, "copy": map[string]any{"location": "Hall"}})
	if x.StatusCode != 200 || one.TitleID != ebook.ID {
		t.Fatalf("attach: %d %s", x.StatusCode, x.Body)
	}
	two, _ := r.addCopy(r.admin, map[string]any{"titleId": ebook.ID})
	got := rowFor(r.rows(t, r.userA, ""), ebook.ID)
	if got.PhysicalCopyCount != 2 || got.EditionCount != 1 || !slices.Equal(got.Formats, []string{"epub", "paper"}) {
		t.Fatalf("both forms: %+v", got)
	}
	var copies wire.PhysicalCopies
	e.Do("GET", "/titles/"+ebook.ID+"/physical-copies", r.userA, nil).JSON(t, &copies)
	if copies.Total != 2 {
		t.Fatalf("copies: %+v", copies)
	}
	// A title with files is edited through them.
	if y := e.Do("GET", "/admin/titles/"+ebook.ID+"/metadata", r.admin, nil); y.StatusCode != 409 {
		t.Fatalf("title metadata with files: %d %s", y.StatusCode, y.Body)
	}
	// Removing copies leaves the ebook.
	for _, c := range []wire.PhysicalCopy{one, two} {
		if y := e.Do("POST", "/admin/physical-copies/"+c.ID+"/remove", r.admin, map[string]any{"operationId": uuid.NewString(), "baseRevision": "1"}); y.StatusCode != 200 {
			t.Fatalf("remove: %d %s", y.StatusCode, y.Body)
		}
	}
	if got := rowFor(r.rows(t, r.userA, ""), ebook.ID); got == nil || got.PhysicalCopyCount != 0 || got.EditionCount != 1 {
		t.Fatalf("ebook after removing copies: %+v", got)
	}

	// A confirmed separate book is added although it matches.
	sep, x := r.addCopy(r.admin, map[string]any{"newTitle": same, "separateFromMatches": true})
	if x.StatusCode != 200 || sep.TitleID == ebook.ID {
		t.Fatalf("separate: %d %s", x.StatusCode, x.Body)
	}

	// A scan that finds an ebook of a paper-only title keeps them apart and asks, even with an ISBN.
	paper, x := r.addCopy(r.admin, map[string]any{"newTitle": map[string]any{"title": "Late Arrival", "authors": []string{"Lee Print"}},
		"copy": map[string]any{"isbn": "9780306406157"}})
	if x.StatusCode != 200 {
		t.Fatalf("paper first: %d %s", x.StatusCode, x.Body)
	}
	file := filepath.Join(r.root, "Late", "late.epub")
	epub(t, file, "Late Arrival", "Lee Print", "978-0-306-40615-7")
	scanTwice(t, e, r.admin, r.lib)
	rows := r.rows(t, r.userA, "q=late%20arrival")
	if len(rows) != 2 {
		t.Fatalf("the scan must not join the ebook to the paper title: %+v", rows)
	}
	var reviews struct {
		Items []struct {
			ID, Kind   string
			Candidates map[string]any `json:"candidates"`
		} `json:"items"`
	}
	y := e.Do("GET", "/admin/libraries/"+r.lib+"/reviews", r.admin, nil)
	if y.StatusCode != 200 || !strings.Contains(string(y.Body), paper.TitleID) {
		t.Fatalf("no review offering the paper title: %d %s", y.StatusCode, y.Body)
	}
	y.JSON(t, &reviews)
	var review string
	for _, it := range reviews.Items {
		if it.Kind == "grouping" && strings.Contains(string(y.Body), paper.TitleID) {
			review = it.ID
		}
	}
	if z := e.Do("POST", "/admin/libraries/"+r.lib+"/reviews/"+review+"/resolve", r.admin, map[string]any{"action": "link", "titleId": paper.TitleID}); z.StatusCode >= 300 {
		t.Fatalf("link: %d %s", z.StatusCode, z.Body)
	}
	rows = r.rows(t, r.userA, "q=late%20arrival")
	if len(rows) != 1 || rows[0].ID != paper.TitleID || rows[0].EditionCount != 1 || rows[0].PhysicalCopyCount != 1 {
		t.Fatalf("after linking: %+v", rows)
	}
	// Removing the file leaves the paper title. (The scan marks a missing file; the title stays listed through both.)
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	scanTwice(t, e, r.admin, r.lib)
	if rows = r.rows(t, r.userA, "q=late%20arrival"); len(rows) != 1 || rows[0].PhysicalCopyCount != 1 {
		t.Fatalf("after removing the file: %+v", rows)
	}

	// A copy moves to another book with its history.
	e.Do("PUT", "/physical-copies/"+paper.ID+"/reading", r.userA, paperWrite("0", "finished", nil))
	z := e.Do("PUT", "/admin/physical-copies/"+paper.ID, r.admin, map[string]any{"operationId": uuid.NewString(), "baseRevision": "1",
		"titleId": ebook.ID, "libraryId": r.lib, "copy": map[string]any{}})
	if z.StatusCode != 200 {
		t.Fatalf("move: %d %s", z.StatusCode, z.Body)
	}
	var hist wire.PaperHistory
	e.Do("GET", "/titles/"+ebook.ID+"/paper-history", r.userA, nil).JSON(t, &hist)
	if hist.Total != 1 || rowFor(r.rows(t, r.userA, ""), ebook.ID).Status != "finished" {
		t.Fatalf("history after moving: %+v", hist)
	}
}
