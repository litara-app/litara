package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// fakeProvider serves canned candidates and records what it was asked.
type fakeProvider struct {
	name    string
	matches []metadata.Match
	err     error
	got     []metadata.Query
}

func (f *fakeProvider) Name() string { return f.name }
func (f *fakeProvider) Lookup(_ context.Context, q metadata.Query) ([]metadata.Match, error) {
	f.got = append(f.got, q)
	return f.matches, f.err
}

func raw(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

func (r *readingEnv) setProviderOrder(t *testing.T, order []string) {
	t.Helper()
	var d wire.LibraryDetail
	r.e.Do("GET", "/admin/libraries/"+r.lib, r.admin, nil).JSON(t, &d)
	cfg := d.Config
	cfg.ProviderOrder = order
	if x := r.e.Do("PUT", "/admin/libraries/"+r.lib+"/config", r.admin, cfg); x.StatusCode != 200 {
		t.Fatalf("set provider order: %d %s", x.StatusCode, x.Body)
	}
}

// ADR-0049/0060: lookups stay off until a library enables a provider; a search
// sends only title, authors and ISBN, returns candidates for review, and never
// changes the edition.
func TestEditionProviderSearchIsOptInAndChangesNothing(t *testing.T) {
	ol := &fakeProvider{name: metadata.ProviderOpenLibrary, matches: []metadata.Match{
		{Provider: metadata.ProviderOpenLibrary, ID: "/works/OL1W", ByIdentifier: true, Fields: metadata.Fields{
			"title": raw("Second Volume"), "authors": raw([]string{"Ada Author"}), "publisher": raw("Press"), "narrators": raw([]string{"Not for an ebook"})}},
		{Provider: metadata.ProviderOpenLibrary, ID: "/works/OL2W", Fields: metadata.Fields{"title": raw("Another Book")}},
	}}
	gb := &fakeProvider{name: metadata.ProviderGoogleBooks, err: errors.New("provider returned status 429")}
	r := newReadingEnvWith(t, apitest.Options{Providers: map[string]metadata.Provider{ol.name: ol, gb.name: gb}})
	e, ed := r.e, r.ed.ID
	path := "/admin/editions/" + ed + "/metadata/provider-search"
	search := func(body any) (wire.ProviderSearchResults, apitest.Response) {
		x := e.Do("POST", path, r.admin, body)
		var out wire.ProviderSearchResults
		if x.StatusCode == 200 {
			x.JSON(t, &out)
		}
		return out, x
	}

	// Authority: administrator and a grant.
	if x := e.Do("POST", path, r.userA, map[string]any{"query": map[string]any{}}); x.StatusCode != 403 {
		t.Fatalf("non-admin: %d %s", x.StatusCode, x.Body)
	}

	// Disabled by default: no provider is contacted.
	out, x := search(map[string]any{"query": map[string]any{}})
	if x.StatusCode != 200 || out.Enabled || len(out.Results) != 0 || len(ol.got) != 0 || len(gb.got) != 0 {
		t.Fatalf("default must be off and silent: %d %s calls=%d/%d", x.StatusCode, x.Body, len(ol.got), len(gb.got))
	}

	r.setProviderOrder(t, []string{metadata.ProviderOpenLibrary, metadata.ProviderGoogleBooks})
	out, x = search(map[string]any{"query": map[string]any{}})
	if x.StatusCode != 200 || !out.Enabled || len(out.Results) != 2 {
		t.Fatalf("enabled search: %d %s", x.StatusCode, x.Body)
	}
	// The default query is the edition's effective title, authors and ISBN, and nothing else.
	if len(ol.got) != 1 || ol.got[0].Title != "Second Volume" || len(ol.got[0].Authors) != 1 || ol.got[0].Authors[0] != "Ada Author" || ol.got[0].ISBN == "" || ol.got[0].ASIN != "" {
		t.Fatalf("query sent to the provider: %+v", ol.got)
	}
	// Provider order is the library's; a failing provider is reported, not fatal.
	if out.Results[0].Provider != "open_library" || out.Results[0].Status != "ok" || out.Results[1].Provider != "google_books" || out.Results[1].Status != "unavailable" {
		t.Fatalf("results: %+v", out.Results)
	}
	c := out.Results[0].Candidates
	if len(c) != 2 || !c[0].ByIdentifier || !c[0].Consistent || c[1].Consistent || c[1].ByIdentifier {
		t.Fatalf("candidates: %+v", c)
	}
	if _, has := c[0].Fields["narrators"]; has || string(c[0].Fields["publisher"].Raw) != `"Press"` {
		t.Fatalf("an edition review offers edition fields only: %+v", c[0].Fields)
	}

	// Explicit overrides replace the stored query.
	if _, x = search(map[string]any{"query": map[string]any{"isbn": "978-1"}}); x.StatusCode != 422 && x.StatusCode != 400 {
		t.Fatalf("invalid isbn: %d %s", x.StatusCode, x.Body)
	}
	out, x = search(map[string]any{"query": map[string]any{"title": " Other ", "authors": []string{"B"}, "isbn": "0306406152"}})
	if x.StatusCode != 200 || out.Query.Title != "Other" || out.Query.ISBN != "0306406152" || ol.got[len(ol.got)-1].Title != "Other" {
		t.Fatalf("override: %d %s", x.StatusCode, x.Body)
	}

	// A search stores and changes nothing.
	var rep wire.EditionMetadataReport
	e.Do("GET", "/admin/editions/"+ed+"/metadata", r.admin, nil).JSON(t, &rep)
	if rep.Revision != "0" || field(rep, "publisher") != nil {
		t.Fatalf("search changed the edition: %+v", rep)
	}
}

// Audiobook recordings use the same opt-in search; Audnexus is included, and a title identifier that is an ASIN is sent as one.
func TestRecordingProviderSearchUsesTitleAndAsin(t *testing.T) {
	au := &fakeProvider{name: metadata.ProviderAudnexus, matches: []metadata.Match{{Provider: metadata.ProviderAudnexus, ID: "B000TEST01", ByIdentifier: true,
		Fields: metadata.Fields{"title": raw("Original Title"), "authors": raw([]string{"An Author"}), "narrators": raw([]string{"A Narrator"}), "page_count": raw(300)}}}}
	e := apitest.New(t, apitest.Options{Providers: map[string]metadata.Provider{au.name: au}})
	root, _ := filepath.Abs(t.TempDir())
	admin := e.Login(seed.AdminName, "cli").AccessToken
	d := setupLibrary(t, e, admin, root)
	lib := d.Library.ID
	audioAt(t, filepath.Join(root, "Book", "1.mp3"), 440, "album", "Original Title", "artist", "An Author")
	scanTwice(t, e, admin, lib)
	var rec string
	if err := e.Pool.QueryRow(t.Context(), `SELECT id FROM recordings WHERE library_id=$1`, lib).Scan(&rec); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Pool.Exec(t.Context(), `UPDATE titles SET identifier='B000TEST01' WHERE id=(SELECT title_id FROM recordings WHERE id=$1)`, rec); err != nil {
		t.Fatal(err)
	}
	path := "/admin/recordings/" + rec + "/metadata/provider-search"
	user := e.Login(seed.UserAName, "phone").AccessToken
	if x := e.Do("POST", path, user, map[string]any{"query": map[string]any{}}); x.StatusCode != 403 {
		t.Fatalf("non-admin: %d", x.StatusCode)
	}
	var out wire.RecordingProviderSearchResults
	off := e.Do("POST", path, admin, map[string]any{"query": map[string]any{}})
	off.JSON(t, &out)
	if off.StatusCode != 200 || out.Enabled || len(au.got) != 0 {
		t.Fatalf("off by default: %d %s", off.StatusCode, off.Body)
	}
	var cfg wire.LibraryDetail
	e.Do("GET", "/admin/libraries/"+lib, admin, nil).JSON(t, &cfg)
	cfg.Config.ProviderOrder = []string{metadata.ProviderAudnexus}
	if x := e.Do("PUT", "/admin/libraries/"+lib+"/config", admin, cfg.Config); x.StatusCode != 200 {
		t.Fatalf("enable: %d %s", x.StatusCode, x.Body)
	}
	x := e.Do("POST", path, admin, map[string]any{"query": map[string]any{}})
	x.JSON(t, &out)
	if x.StatusCode != 200 || !out.Enabled || len(out.Results) != 1 || out.Results[0].Provider != "audnexus" || len(out.Results[0].Candidates) != 1 {
		t.Fatalf("search: %d %s", x.StatusCode, x.Body)
	}
	if len(au.got) != 1 || au.got[0].ASIN != "B000TEST01" || au.got[0].Title != "Original Title" {
		t.Fatalf("query: %+v", au.got)
	}
	c := out.Results[0].Candidates[0]
	if _, has := c.Fields["page_count"]; has || string(c.Fields["narrators"].Raw) != `["A Narrator"]` || !c.Consistent {
		t.Fatalf("recording fields only: %+v", c)
	}
	if x := e.Do("POST", path, admin, map[string]any{"query": map[string]any{"asin": "bad"}}); x.StatusCode != 422 && x.StatusCode != 400 {
		t.Fatalf("bad asin: %d", x.StatusCode)
	}
}
