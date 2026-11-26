package httpapi_test

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// fakePeople is a provider serving fixed records, counting what it is asked.
type fakePeople struct {
	name    string
	authors []metadata.AuthorHit
	refs    map[string][]metadata.SeriesRef // by book title
	series  map[string]metadata.SeriesInfo
	fail    atomic.Bool
	calls   atomic.Int64
}

func (f *fakePeople) Name() string { return f.name }
func (f *fakePeople) ask() error {
	f.calls.Add(1)
	if f.fail.Load() {
		return errors.New("down")
	}
	return nil
}
func (f *fakePeople) FindAuthors(context.Context, string) ([]metadata.AuthorHit, error) {
	if err := f.ask(); err != nil {
		return nil, err
	}
	return f.authors, nil
}
func (f *fakePeople) Author(_ context.Context, id string) (metadata.AuthorHit, error) {
	if err := f.ask(); err != nil {
		return metadata.AuthorHit{}, err
	}
	for _, a := range f.authors {
		if a.ID == id {
			return a, nil
		}
	}
	return metadata.AuthorHit{}, metadata.ErrNoSuchRecord
}
func (f *fakePeople) BookSeries(_ context.Context, q metadata.Query) ([]metadata.SeriesRef, error) {
	if err := f.ask(); err != nil {
		return nil, err
	}
	return f.refs[q.Title], nil
}
func (f *fakePeople) Series(_ context.Context, id string) (metadata.SeriesInfo, error) {
	if err := f.ask(); err != nil {
		return metadata.SeriesInfo{}, err
	}
	s, ok := f.series[id]
	if !ok {
		return metadata.SeriesInfo{}, metadata.ErrNoSuchRecord
	}
	return s, nil
}

// ADR-0102 to ADR-0106: lookups through enabled providers, reviewed apply, provenance, and books missing from a series.
func TestAuthorAndSeriesOnline(t *testing.T) {
	pictures := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/broken.png" {
			_, _ = w.Write([]byte("not an image"))
			return
		}
		_, _ = w.Write(solidPNG(40, 60, color.NRGBA{R: 90, G: 60, B: 30, A: 255}))
	}))
	defer pictures.Close()
	const author = "Ada Author"
	member := func(n int, title, released, cover string) metadata.SeriesMember {
		m := metadata.SeriesMember{Position: n, Title: title, Authors: []string{"Ada Author"}, Released: released, PageURL: "https://hardcover.app/books/x"}
		if cover != "" {
			m.CoverURL = pictures.URL + cover
		}
		return m
	}
	nextYear := time.Now().AddDate(5, 0, 0).Format("2006")
	hard := &fakePeople{name: metadata.ProviderHardcover,
		authors: []metadata.AuthorHit{{Provider: "hardcover", ID: "5", Name: author, Detail: "2 works listed", Biography: "From the provider.",
			PhotoURL: pictures.URL + "/photo.png", PageURL: "https://hardcover.app/authors/ada"}},
		refs: map[string][]metadata.SeriesRef{"First Volume": {{ID: "3", Name: "The Saga"}}, "Second Volume": {{ID: "3", Name: "The Saga"}, {ID: "9", Name: "Elsewhere"}}},
		series: map[string]metadata.SeriesInfo{
			"3": {Provider: "hardcover", ID: "3", Name: "The Saga", PageURL: "https://hardcover.app/series/saga", Authors: []string{author}, Description: "Provider words.",
				BookCount: 7, Status: "ongoing", Members: []metadata.SeriesMember{
					member(1, "First Volume", "2001", "/1.png"),
					member(2, "A Renamed Second", "2002", "/2.png"),   // owned by its number
					member(3, "The Third: A Novel", "2003", "/3.png"), // owned by title, filed under no series
					member(4, "Fourth Volume", "2004-05-01", "/4.png"),
					member(5, "Fifth Volume", "2005", "/broken.png"),
					member(6, "Announced", nextYear, ""),
					member(7, "Undated", "", ""),
				}},
			"9": {Provider: "hardcover", ID: "9", Name: "Elsewhere", PageURL: "https://hardcover.app/series/else"},
		}}
	open := &fakePeople{name: metadata.ProviderOpenLibrary,
		authors: []metadata.AuthorHit{{Provider: "open_library", ID: "OL1A", Name: author, Biography: "From the fallback.", PageURL: "https://openlibrary.org/authors/OL1A"}}}

	r := newReadingEnvWith(t, apitest.Options{People: map[string]metadata.PeopleProvider{"hardcover": hard, "open_library": open}, ProviderCacheTTL: 10 * time.Minute})
	e := r.e
	epub(t, filepath.Join(r.root, "Saga", "vol1.epub"), "First Volume", author, "978-0-306-40615-7")
	epub(t, filepath.Join(r.root, "Loose", "third.epub"), "The Third", author, "978-1-56619-909-4")
	scanTwice(t, e, r.admin, r.lib)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := e.Pool.Exec(t.Context(), sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`UPDATE titles SET series_name = 'The Saga', series_index = 1 WHERE title = 'First Volume'`)
	exec(`UPDATE titles SET series_name = 'The Saga', series_index = 2 WHERE title = 'Second Volume'`)

	q := func(name string) string { return "?name=" + url.QueryEscape(name) }
	providers := func(names ...string) {
		exec(`UPDATE library_config SET provider_order = $2 WHERE library_id = $1`, r.lib, append([]string{}, names...))
	}
	lookupAuthor := func(token string, fresh bool) (wire.AuthorLookupResults, apitest.Response) {
		var out wire.AuthorLookupResults
		resp := e.Do("POST", "/authors/lookup"+q(author), token, map[string]any{"fresh": fresh})
		if resp.StatusCode == http.StatusOK {
			resp.JSON(t, &out)
		}
		return out, resp
	}

	// With no provider enabled nothing is contacted.
	providers()
	if out, resp := lookupAuthor(r.admin, false); resp.StatusCode != http.StatusOK || out.Enabled || hard.calls.Load()+open.calls.Load() != 0 {
		t.Fatalf("disabled: %d %+v", resp.StatusCode, out)
	}
	providers("open_library", "google_books", "hardcover")
	if _, resp := lookupAuthor(r.userA, false); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("member lookup: %d", resp.StatusCode)
	}
	// Hardcover is asked first whatever the library's order, and Open Library only when it gives nothing.
	out, _ := lookupAuthor(r.admin, false)
	if !out.Enabled || len(out.Results) != 1 || out.Results[0].Provider != "hardcover" || out.Results[0].Status != "ok" || !out.Results[0].Candidates[0].HasPhoto || open.calls.Load() != 0 {
		t.Fatalf("hardcover first: %+v (open asked %d)", out, open.calls.Load())
	}
	asked := hard.calls.Load()
	if lookupAuthor(r.admin, false); hard.calls.Load() != asked {
		t.Fatal("the cached search was asked again")
	}
	hard.fail.Store(true)
	out, _ = lookupAuthor(r.admin, true)
	if len(out.Results) != 2 || out.Results[0].Status != "unavailable" || out.Results[1].Provider != "open_library" || out.Results[1].Status != "ok" {
		t.Fatalf("fallback: %+v", out)
	}
	hard.fail.Store(false)

	// A lookup saves nothing. The candidate's photo comes through the server.
	var details wire.DirectoryDetails
	read := func(path, name string) {
		t.Helper()
		resp := e.Do("GET", path+q(name), r.userA, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("details: %d %s", resp.StatusCode, resp.Body)
		}
		details = wire.DirectoryDetails{}
		resp.JSON(t, &details)
	}
	read("/authors/details", author)
	if details.Revision != "0" || details.Photo.Source != "none" {
		t.Fatalf("a lookup saved something: %+v", details)
	}
	previewPath := "/authors/lookup/photo" + q(author) + "&provider=hardcover&id=5"
	if resp := e.Do("GET", previewPath, r.admin, nil); resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "image/jpeg" {
		t.Fatalf("preview: %d %s", resp.StatusCode, resp.Body)
	}
	if resp := e.Do("GET", previewPath, r.userA, nil); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("member preview: %d", resp.StatusCode)
	}

	apply := func(token, path, name, revision, provider, id string, photo bool, fields ...string) apitest.Response {
		return e.Do("POST", path+q(name), token, map[string]any{"operationId": uuid.NewString(), "baseRevision": revision,
			"provider": provider, "candidateId": id, "fields": append([]string{}, fields...), "photo": photo})
	}
	for name, want := range map[string]struct {
		resp apitest.Response
		code int
	}{
		"member":          {apply(r.userA, "/authors/lookup/apply", author, "0", "hardcover", "5", false, "biography"), http.StatusForbidden},
		"nothing chosen":  {apply(r.admin, "/authors/lookup/apply", author, "0", "hardcover", "5", false), http.StatusUnprocessableEntity},
		"unknown record":  {apply(r.admin, "/authors/lookup/apply", author, "0", "hardcover", "404", false, "biography"), http.StatusNotFound},
		"not for authors": {apply(r.admin, "/authors/lookup/apply", author, "0", "hardcover", "5", false, "status"), http.StatusUnprocessableEntity},
		"stale":           {apply(r.admin, "/authors/lookup/apply", author, "7", "hardcover", "5", false, "biography"), http.StatusConflict},
	} {
		if want.resp.StatusCode != want.code {
			t.Errorf("%s: %d %s", name, want.resp.StatusCode, want.resp.Body)
		}
	}
	resp := apply(r.admin, "/authors/lookup/apply", author, "0", "hardcover", "5", true, "biography")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("apply: %d %s", resp.StatusCode, resp.Body)
	}
	read("/authors/details", author)
	bio := details.Fields[slices.IndexFunc(details.Fields, func(f wire.DirectoryField) bool { return f.Field == "biography" })]
	if string(bio.Value.Raw) != `"From the provider."` || bio.Source != "user" || bio.Locked || bio.Provider == nil || *bio.Provider != "hardcover" ||
		*bio.ProviderURL != "https://hardcover.app/authors/ada" || details.Photo.Source != "provider" || *details.Photo.Provider != "hardcover" || details.Photo.ProviderURL == nil {
		t.Fatalf("applied with its source: %+v %+v", bio, details.Photo)
	}
	stored := e.Do("GET", "/authors/photo"+q(author), r.userA, nil)
	if _, format, err := image.DecodeConfig(bytes.NewReader(stored.Body)); err != nil || format != "jpeg" {
		t.Fatalf("stored photo: %d %v", stored.StatusCode, err)
	}

	// A typed edit drops the credit; a locked field or photo refuses an apply and stores nothing of it.
	patch := func(path, name, revision string, changes ...map[string]any) apitest.Response {
		return e.Do("PATCH", path+q(name), r.admin, map[string]any{"operationId": uuid.NewString(), "baseRevision": revision, "changes": changes})
	}
	patch("/authors/details", author, "1", map[string]any{"field": "biography", "action": "set", "value": "Mine."})
	read("/authors/details", author)
	for _, f := range details.Fields {
		if f.Field == "biography" && f.Provider != nil {
			t.Fatalf("a typed value kept a credit: %+v", f)
		}
	}
	patch("/authors/details", author, "2", map[string]any{"field": "photo", "action": "lock"})
	if resp := apply(r.admin, "/authors/lookup/apply", author, "3", "hardcover", "5", true, "biography"); resp.Code() != "field_locked" {
		t.Fatalf("locked photo: %d %s", resp.StatusCode, resp.Body)
	}
	patch("/authors/details", author, "3", map[string]any{"field": "biography", "action": "lock"})
	if resp := apply(r.admin, "/authors/lookup/apply", author, "4", "hardcover", "5", false, "biography"); resp.Code() != "field_locked" {
		t.Fatalf("locked field: %d %s", resp.StatusCode, resp.Body)
	}
	providers("open_library")
	if resp := apply(r.admin, "/authors/lookup/apply", author, "4", "hardcover", "5", false, "biography"); resp.Code() != "provider_not_enabled" {
		t.Fatalf("disabled provider: %d %s", resp.StatusCode, resp.Body)
	}
	providers("hardcover")

	// A series is found through its books, the most common first, and nothing is saved until it is matched.
	var found wire.SeriesLookupResults
	resp = e.Do("POST", "/series/lookup"+q("the saga"), r.admin, map[string]any{})
	resp.JSON(t, &found)
	if resp.StatusCode != 200 || !found.Enabled || len(found.Results) != 1 || len(found.Results[0].Candidates) != 2 {
		t.Fatalf("series lookup: %d %s", resp.StatusCode, resp.Body)
	}
	best := found.Results[0].Candidates[0]
	if best.ID != "3" || best.MatchedBooks != 2 || best.SearchedBooks != 2 || best.NumberedBooks != 7 || *best.BookCount != 7 || *best.Status != "ongoing" {
		t.Fatalf("best candidate: %+v", best)
	}
	missing := func(token string) (wire.MissingBooks, int) {
		var m wire.MissingBooks
		resp := e.Do("GET", "/series/missing"+q("The Saga"), token, nil)
		if resp.StatusCode == http.StatusOK {
			resp.JSON(t, &m)
		}
		return m, resp.StatusCode
	}
	if m, code := missing(r.userA); code != 200 || m.Match != nil || len(m.Items) != 0 {
		t.Fatalf("unmatched: %d %+v", code, m)
	}
	var titlesBefore, titlesAfter int
	_ = e.Pool.QueryRow(t.Context(), `SELECT count(*) FROM titles`).Scan(&titlesBefore)
	resp = apply(r.admin, "/series/lookup/apply", "The Saga", "0", "hardcover", "3", false, "description", "book_count", "status")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("match: %d %s", resp.StatusCode, resp.Body)
	}
	_ = e.Pool.QueryRow(t.Context(), `SELECT count(*) FROM titles`).Scan(&titlesAfter)
	if titlesBefore != titlesAfter {
		t.Fatal("matching created catalog titles")
	}
	read("/series/details", "The Saga")
	if details.Match == nil || details.Match.Provider != "hardcover" || details.Match.URL != "https://hardcover.app/series/saga" || details.Revision != "1" {
		t.Fatalf("matched details: %+v", details)
	}
	m, _ := missing(r.userA)
	numbers := []int{}
	for _, it := range m.Items {
		numbers = append(numbers, it.Number)
	}
	// 1 and 2 are owned, 3 is owned under a shorter title outside the series; 6 is not out and 7 has no date.
	if m.Match == nil || !slices.Equal(numbers, []int{4, 5}) || m.Items[0].CoverVersion == nil || m.Items[1].CoverVersion != nil {
		t.Fatalf("missing: %v %+v", numbers, m)
	}
	cover := e.Do("GET", "/series/missing/cover"+q("The Saga")+"&number=4", r.userA, nil)
	if cover.StatusCode != 200 || cover.Header.Get("ETag") != `"`+*m.Items[0].CoverVersion+`"` {
		t.Fatalf("cover: %d %s", cover.StatusCode, cover.Body)
	}
	if resp := e.Do("GET", "/series/missing/cover"+q("The Saga")+"&number=5", r.userA, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("a member with no cover: %d", resp.StatusCode)
	}
	if _, code := missing(r.userB); code != http.StatusNotFound {
		t.Fatalf("without a grant: %d", code)
	}
	if resp := e.Do("GET", "/series/missing/cover"+q("The Saga")+"&number=4", r.userB, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("cover without a grant: %d", resp.StatusCode)
	}
	// Removing the match removes the missing books and keeps the saved values.
	if resp := patch("/series/details", "The Saga", "1", map[string]any{"field": "match", "action": "set", "value": "x"}); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("set a match: %d", resp.StatusCode)
	}
	if resp := patch("/series/details", "The Saga", "1", map[string]any{"field": "match", "action": "reset"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("remove match: %d %s", resp.StatusCode, resp.Body)
	}
	read("/series/details", "The Saga")
	if m, _ := missing(r.userA); m.Match != nil || len(m.Items) != 0 || details.Match != nil || string(details.Fields[0].Value.Raw) != `"Provider words."` {
		t.Fatalf("after removing: %+v %+v", m, details)
	}
}
