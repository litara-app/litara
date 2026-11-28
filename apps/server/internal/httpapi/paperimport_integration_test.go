package httpapi_test

import (
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// A made-up export. The library of newReadingEnv holds the ebook "Second Volume" by Ada Author, ISBN 9781402894626.
const importFile = `Book Id,Title,Author,ISBN,ISBN13,My Rating,Binding,Number of Pages,Year Published,Date Read,Bookshelves,Exclusive Shelf,My Review,Private Notes,Owned Copies
1,Paper Garden,Iris Folio,,"=""9780306406157""",4,Hardcover,210,2004,2026/11/05,paper,read,A secret review.,do not keep this,2
2,Paper Garden,Iris Folio,,,0,Paperback,,,,paper,to-read,,,1
3,Retitled Ebook,Someone Else,,"=""9781402894626""",5,Paperback,,,2026/11/06,,read,,,1
4,second volume,Ada Author,,,3,,,,,,read,,,1
5,Borrowed Once,Lee Lender,,,2,,,,2026/11/07,,read,Liked it.,,0
6,,Nobody,,,0,,,,,,,,,1
7,Wishlist Only,Wan Ted,,,0,,,,,wish,to-read,,,0
8,=cmd|' /C calc'!A0,Form Ula,,,0,,,,,paper,currently-reading,,,1
`

func (r *readingEnv) upload(t *testing.T, token, library, csv string) (wire.PaperImport, apitest.Response) {
	t.Helper()
	x := r.e.Do("POST", "/admin/paper-imports?libraryId="+library, token, []byte(csv), "Content-Type", "text/csv")
	var out wire.PaperImport
	if x.StatusCode == http.StatusOK {
		x.JSON(t, &out)
	}
	return out, x
}

func (r *readingEnv) importOptions(t *testing.T, id string, ownership any, reading bool, shelves ...string) wire.PaperImport {
	t.Helper()
	x := r.e.Do("PUT", "/admin/paper-imports/"+id+"/options", r.admin, map[string]any{"ownership": ownership, "includeReading": reading, "shelves": shelves})
	if x.StatusCode != http.StatusOK {
		t.Fatalf("options: %d %s", x.StatusCode, x.Body)
	}
	var out wire.PaperImport
	x.JSON(t, &out)
	return out
}

func (r *readingEnv) importRows(t *testing.T, id, show string) map[int64]wire.PaperImportRow {
	t.Helper()
	x := r.e.Do("GET", "/admin/paper-imports/"+id+"/rows?size=200&show="+show, r.admin, nil)
	if x.StatusCode != http.StatusOK {
		t.Fatalf("rows: %d %s", x.StatusCode, x.Body)
	}
	var page wire.PaperImportRows
	x.JSON(t, &page)
	out := map[int64]wire.PaperImportRow{}
	for _, row := range page.Items {
		out[row.Row] = row
	}
	return out
}

func (r *readingEnv) applyImport(t *testing.T, id, base string) (wire.PaperImport, apitest.Response) {
	t.Helper()
	x := r.e.Do("POST", "/admin/paper-imports/"+id+"/apply", r.admin, map[string]any{"baseRevision": base})
	var out wire.PaperImport
	if x.StatusCode == http.StatusOK {
		x.JSON(t, &out)
	}
	return out, x
}

func (r *readingEnv) getImport(t *testing.T, id string) wire.PaperImport {
	t.Helper()
	var out wire.PaperImport
	r.e.Do("GET", "/admin/paper-imports/"+id, r.admin, nil).JSON(t, &out)
	return out
}

func (r *readingEnv) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := r.e.Pool.QueryRow(t.Context(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func actions(rows map[int64]wire.PaperImportRow) string {
	keys := make([]int64, 0, len(rows))
	for k := range rows {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	parts := []string{}
	for _, k := range keys {
		parts = append(parts, strconv.FormatInt(k, 10)+":"+rows[k].Action)
	}
	return strings.Join(parts, " ")
}

// ADR-0117: a file is reviewed before anything changes, the ownership question has no default, matches by name wait
// for a choice, the person's own reading is added only when asked and never replaces anything, and running a file
// again adds nothing.
func TestPaperImportIsReviewedThenAppliedOnce(t *testing.T) {
	r := newReadingEnv(t)
	r.t = t
	e := r.e
	ebook := r.ed.TitleID
	titlesBefore := r.count(t, "SELECT count(*) FROM titles")

	// Only an administrator with the library.
	if _, x := r.upload(t, r.userA, r.lib, importFile); x.StatusCode != 403 {
		t.Fatalf("a reader uploaded: %d", x.StatusCode)
	}
	if _, x := r.upload(t, r.admin, r.lib, "Name\nx\n"); x.StatusCode != 422 || x.Code() != "import_file_refused" || !strings.Contains(string(x.Body), "Name") {
		t.Fatalf("a file without titles: %d %s", x.StatusCode, x.Body)
	}
	imp, x := r.upload(t, r.admin, r.lib, importFile)
	if x.StatusCode != 200 || imp.Source != "goodreads" || imp.State != "review" || imp.Rows != 8 || imp.Ownership != nil || imp.IncludeReading ||
		imp.MarkedOwned != 5 || imp.WithReading != 5 || imp.Plan == nil || imp.Plan.NewBook+imp.Plan.AddCopy+imp.Plan.Copies != 0 || imp.ExpiresAt == nil {
		t.Fatalf("upload: %d %s", x.StatusCode, x.Body)
	}
	if len(imp.FileShelves) != 5 || imp.FileShelves[0].Name != "read" || imp.FileShelves[0].Rows != 4 {
		t.Fatalf("shelves: %+v", imp.FileShelves)
	}
	if r.count(t, "SELECT count(*) FROM titles") != titlesBefore || r.count(t, "SELECT count(*) FROM physical_copies") != 0 {
		t.Fatal("uploading changed the catalogue")
	}
	if r.count(t, "SELECT count(*) FROM paper_import_rows WHERE data::text LIKE '%do not keep this%'") != 0 {
		t.Fatal("private notes were stored")
	}
	// Nothing can be applied before the ownership question is answered.
	if _, x := r.applyImport(t, imp.ID, imp.Revision); x.StatusCode != 409 || x.Code() != "ownership_unanswered" {
		t.Fatalf("apply unanswered: %d %s", x.StatusCode, x.Body)
	}

	for answer, want := range map[string]int64{"all": 7, "owned": 5, "pick": 0} {
		got := r.importOptions(t, imp.ID, answer, false)
		selected := int64(0)
		for _, row := range r.importRows(t, imp.ID, "all") {
			if row.Selected {
				selected++
			}
		}
		if selected != want || *got.Ownership != answer {
			t.Fatalf("%s selects %d", answer, selected)
		}
	}
	r.importOptions(t, imp.ID, "shelves", false, "Paper")
	rows := r.importRows(t, imp.ID, "all")
	if actions(rows) != "2:new_book 3:new_book 4:not_owned 5:not_owned 6:not_owned 7:unusable 8:not_owned 9:new_book" {
		t.Fatalf("chosen shelf: %s", actions(rows))
	}
	// A row picked by hand survives a change to the reading choice, and not a new ownership answer.
	if y := e.Do("PUT", "/admin/paper-imports/"+imp.ID+"/rows/6", r.admin, map[string]any{"selected": true}); y.StatusCode != 200 {
		t.Fatalf("select: %d %s", y.StatusCode, y.Body)
	}
	r.importOptions(t, imp.ID, "shelves", true, "paper")
	if !r.importRows(t, imp.ID, "all")[6].Selected {
		t.Fatal("a hand-picked row was dropped")
	}
	r.importOptions(t, imp.ID, "owned", true)
	rows = r.importRows(t, imp.ID, "all")
	// Row 2 is new, 3 joins it. Row 4 has the ebook's ISBN. Row 5 matches the ebook by name only. Row 6 is not owned.
	if actions(rows) != "2:new_book 3:new_book 4:add_copy 5:needs_choice 6:not_owned 7:unusable 8:not_owned 9:new_book" {
		t.Fatalf("owned: %s", actions(rows))
	}
	if rows[4].TitleID == nil || *rows[4].TitleID != ebook || !rows[4].Matches[0].SameISBN || rows[5].Matches[0].TitleID != ebook || rows[5].Matches[0].SameISBN || rows[2].Copies != 2 {
		t.Fatalf("matches: %+v %+v", rows[4], rows[5])
	}
	if got := r.importRows(t, imp.ID, "choose"); len(got) != 1 {
		t.Fatalf("to choose: %s", actions(got))
	}
	for name, change := range map[string]map[string]any{
		"attach without a book": {"choice": "attach"}, "attach to a book that is no match": {"choice": "attach", "titleId": uuid.NewString()}, "unknown": {"choice": "merge"},
	} {
		if y := e.Do("PUT", "/admin/paper-imports/"+imp.ID+"/rows/5", r.admin, change); y.StatusCode != 422 {
			t.Fatalf("%s: %d %s", name, y.StatusCode, y.Body)
		}
	}
	stale := r.getImport(t, imp.ID).Revision
	y := e.Do("PUT", "/admin/paper-imports/"+imp.ID+"/rows/5", r.admin, map[string]any{"choice": "attach", "titleId": ebook})
	var chosen wire.PaperImportRow
	y.JSON(t, &chosen)
	if y.StatusCode != 200 || chosen.Action != "add_copy" {
		t.Fatalf("choose: %d %s", y.StatusCode, y.Body)
	}
	if _, x := r.applyImport(t, imp.ID, stale); x.StatusCode != 409 || x.Code() != "stale_revision" {
		t.Fatalf("stale apply: %d %s", x.StatusCode, x.Body)
	}
	ready := r.getImport(t, imp.ID)
	if p := ready.Plan; p.NewBook != 3 || p.AddCopy != 2 || p.NotOwned != 2 || p.Unusable != 1 || p.NeedsChoice != 0 || p.Copies != 6 {
		t.Fatalf("plan: %+v", ready.Plan)
	}

	// The account already has its own rating on the ebook: the file must not replace it.
	if y := e.Do("PUT", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+r.lib, r.admin, nil); y.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d", y.StatusCode)
	}
	if y := e.Do("PUT", "/titles/"+ebook+"/personal", r.admin, map[string]any{"operationId": uuid.NewString(), "baseRevision": "0", "capturedAt": "2026-11-01T00:00:00Z",
		"data": map[string]any{"ratingHalves": 2, "review": "", "startedAt": nil, "finishedAt": nil}}); y.StatusCode != 200 {
		t.Fatalf("own rating: %d %s", y.StatusCode, y.Body)
	}

	applied, x := r.applyImport(t, imp.ID, ready.Revision)
	if x.StatusCode != 200 || applied.State != "applying" {
		t.Fatalf("apply: %d %s", x.StatusCode, x.Body)
	}
	if again, x := r.applyImport(t, imp.ID, ready.Revision); x.StatusCode != 200 || again.State != "applying" {
		t.Fatalf("apply again: %d %s", x.StatusCode, x.Body)
	}
	if y := e.Do("DELETE", "/admin/paper-imports/"+imp.ID, r.admin, nil); y.StatusCode != 409 {
		t.Fatalf("delete while applying: %d", y.StatusCode)
	}
	if y := e.Do("PUT", "/admin/paper-imports/"+imp.ID+"/rows/2", r.admin, map[string]any{"selected": false}); y.StatusCode != 409 {
		t.Fatalf("change while applying: %d", y.StatusCode)
	}
	e.RunQueued()
	done := r.getImport(t, imp.ID)
	if res := done.Result; done.State != "completed" || res == nil || res.Added != 2 || res.Attached != 3 || res.Skipped != 3 || res.Failed != 0 || res.Waiting != 0 || done.ExpiresAt != nil {
		t.Fatalf("done: %s %+v %s", done.State, done.Result, actions(r.importRows(t, imp.ID, "all")))
	}
	// Two copies for row 2, one each for rows 3, 4, 5 and 9.
	if got := r.count(t, "SELECT count(*) FROM physical_copies"); got != 6 {
		t.Fatalf("copies: %d", got)
	}
	if r.count(t, "SELECT count(*) FROM titles") != titlesBefore+2 {
		t.Fatal("the two rows of one new book must share a title")
	}
	if r.count(t, "SELECT count(*) FROM paper_import_rows WHERE data IS NOT NULL OR outcome_detail LIKE '%secret%'") != 0 {
		t.Fatal("the file's contents were kept after applying")
	}

	list := r.rows(t, r.admin, "q=paper%20garden")
	if len(list) != 1 || list[0].PhysicalCopyCount != 3 || list[0].Status != "finished" || list[0].RatingHalves == nil || *list[0].RatingHalves != 8 {
		t.Fatalf("new book: %+v", list)
	}
	var personal wire.TitlePersonal
	e.Do("GET", "/titles/"+list[0].ID+"/personal", r.admin, nil).JSON(t, &personal)
	if personal.Data.Review != "A secret review." || personal.DerivedFinishedAt == nil || !strings.HasPrefix(*personal.DerivedFinishedAt, "2026-11-05T12:00:00") {
		t.Fatalf("own reading: %+v", personal)
	}
	var mine wire.TitlePersonal
	e.Do("GET", "/titles/"+ebook+"/personal", r.admin, nil).JSON(t, &mine)
	if mine.Data.RatingHalves == nil || *mine.Data.RatingHalves != 2 {
		t.Fatalf("an existing rating was replaced: %+v", mine.Data)
	}
	var stats wire.ReadingStats
	e.Do("GET", "/stats/reading?from=2026-11-01&to=2026-11-30&timeZone=UTC", r.admin, nil).JSON(t, &stats)
	if stats.PaperBooksFinished != 2 || stats.ActiveSeconds != 0 { // rows 2 and 4 carry dates
		t.Fatalf("stats: %+v", stats)
	}
	// "currently-reading" without a date leaves no history, so no made-up start date.
	reading := r.rows(t, r.admin, "q=calc")
	if len(reading) != 1 || reading[0].Status != "reading" {
		t.Fatalf("reading: %+v", reading)
	}
	var dates wire.TitlePersonal
	e.Do("GET", "/titles/"+reading[0].ID+"/personal", r.admin, nil).JSON(t, &dates)
	if dates.DerivedStartedAt != nil {
		t.Fatalf("a start date was made up: %v", *dates.DerivedStartedAt)
	}
	// Another reader of the library sees the books and none of this reading.
	other := r.rows(t, r.userA, "q=paper%20garden")
	var theirs wire.TitlePersonal
	e.Do("GET", "/titles/"+list[0].ID+"/personal", r.userA, nil).JSON(t, &theirs)
	if other[0].Status != "unread" || theirs.Data.Review != "" || theirs.Data.RatingHalves != nil {
		t.Fatalf("another account got the reading: %+v %+v", other[0], theirs.Data)
	}

	report := e.Do("GET", "/admin/paper-imports/"+imp.ID+"/report", r.admin, nil)
	text := string(report.Body)
	if report.StatusCode != 200 || !strings.Contains(report.Header.Get("Content-Type"), "text/csv") || strings.Contains(text, "secret") ||
		!strings.Contains(text, "'=cmd|") || strings.Contains(text, ",=cmd|") || !strings.Contains(text, "Not marked as owned on paper.") {
		t.Fatalf("report: %d %s", report.StatusCode, text)
	}

	// The same file again adds nothing.
	second, _ := r.upload(t, r.admin, r.lib, importFile)
	second = r.importOptions(t, second.ID, "owned", true)
	rows = r.importRows(t, second.ID, "all")
	if p := second.Plan; p.Copies != 0 || p.NewBook != 0 || p.AddCopy != 0 {
		t.Fatalf("again: %+v %s", second.Plan, actions(rows))
	}
	if _, x := r.applyImport(t, second.ID, second.Revision); x.StatusCode != 200 {
		t.Fatalf("apply the same file: %d %s", x.StatusCode, x.Body)
	}
	e.RunQueued()
	if got := r.count(t, "SELECT count(*) FROM physical_copies"); got != 6 || r.count(t, "SELECT count(*) FROM titles") != titlesBefore+2 {
		t.Fatalf("running the file again added something: %d", got)
	}
	if got := r.getImport(t, second.ID); got.Result.Added+got.Result.Attached != 0 {
		t.Fatalf("second result: %+v %+v", got.Result, r.importRows(t, second.ID, "all"))
	}
	if y := e.Do("DELETE", "/admin/paper-imports/"+second.ID, r.admin, nil); y.StatusCode != 204 {
		t.Fatalf("remove a report: %d %s", y.StatusCode, y.Body)
	}
}

// An interrupted or repeated job finishes without duplicates, a book that changed after the review is checked again,
// and plans are private to the uploader and expire.
func TestPaperImportResumesRechecksAndExpires(t *testing.T) {

	r := newReadingEnv(t)
	r.t = t
	e := r.e
	file := "Title,Author,Owned Copies\nOne,A Writer,1\nOne,A Writer,1\nTwo,B Writer,1\n"
	imp, x := r.upload(t, r.admin, r.lib, file)
	if x.StatusCode != 200 || imp.Source != "litara" {
		t.Fatalf("upload: %d %s", x.StatusCode, x.Body)
	}
	imp = r.importOptions(t, imp.ID, "all", false)

	// Between the review and the apply, the second book is added by hand: the import must not add it a second time.
	if _, y := r.addCopy(r.admin, map[string]any{"newTitle": map[string]any{"title": "Two", "authors": []string{"B Writer"}}}); y.StatusCode != 200 {
		t.Fatalf("by hand: %d %s", y.StatusCode, y.Body)
	}
	if _, y := r.applyImport(t, imp.ID, imp.Revision); y.StatusCode != 200 {
		t.Fatalf("apply: %d %s", y.StatusCode, y.Body)
	}
	e.RunQueued()
	rows := r.importRows(t, imp.ID, "all")
	if *rows[2].Outcome != "added" || *rows[3].Outcome != "attached" || *rows[4].Outcome != "skipped" {
		t.Fatalf("outcomes: %v %v %v %v", *rows[2].Outcome, *rows[3].Outcome, *rows[4].Outcome, *rows[4].Detail)
	}
	if r.count(t, "SELECT count(*) FROM titles WHERE title IN ('One', 'Two')") != 2 || r.count(t, "SELECT count(*) FROM physical_copies") != 3 {
		t.Fatal("duplicates")
	}
	// Put the job back as if it had stopped after the first row, and run it again: only the unapplied rows run.
	if _, err := e.Pool.Exec(t.Context(), `UPDATE paper_imports SET state = 'applying' WHERE id = $1`, imp.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.Reading.RunPaperImport(t.Context(), uuid.MustParse(imp.ID)); err != nil {
		t.Fatal(err)
	}
	if r.count(t, "SELECT count(*) FROM physical_copies") != 3 || r.getImport(t, imp.ID).State != "completed" {
		t.Fatal("a repeated job added copies")
	}

	// Another administrator without being the uploader does not see it; an unapplied plan expires with its text.
	waiting, _ := r.upload(t, r.admin, r.lib, "Title,My Review\nThree,Private words\n")
	if y := e.Do("PUT", "/admin/users/"+e.Fix.UserBID.String()+"/libraries/"+r.lib, r.admin, nil); y.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d", y.StatusCode)
	}
	if _, err := e.Pool.Exec(t.Context(), `UPDATE users SET is_admin = true WHERE id = $1`, e.Fix.UserBID); err != nil {
		t.Fatal(err)
	}
	otherAdmin := e.Login(seed.UserBName, "desk").AccessToken
	for _, path := range []string{"/admin/paper-imports/" + waiting.ID, "/admin/paper-imports/" + waiting.ID + "/rows", "/admin/paper-imports/" + waiting.ID + "/report"} {
		if y := e.Do("GET", path, otherAdmin, nil); y.StatusCode != 404 {
			t.Fatalf("another administrator %s: %d", path, y.StatusCode)
		}
	}
	var theirs wire.PaperImports
	e.Do("GET", "/admin/paper-imports", otherAdmin, nil).JSON(t, &theirs)
	if len(theirs.Items) != 0 {
		t.Fatalf("another administrator's list: %+v", theirs)
	}

	e.Clock.Advance(8 * 24 * time.Hour)
	if _, err := e.Reading.ExpirePaperImports(t.Context()); err != nil {
		t.Fatal(err)
	}
	if r.count(t, "SELECT count(*) FROM paper_imports WHERE id = $1", waiting.ID) != 0 || r.count(t, "SELECT count(*) FROM paper_import_rows WHERE import_id = $1", waiting.ID) != 0 {
		t.Fatal("the unapplied import did not expire")
	}
	if r.count(t, "SELECT count(*) FROM paper_imports WHERE id = $1", imp.ID) != 1 {
		t.Fatal("a completed report expired")
	}
}
