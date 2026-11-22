package httpapi_test

import (
	"errors"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func (f *fakeProvider) calls() int { return len(f.got) }

// ADR-0087: successful searches are cached for the configured time, failures never, and a person can bypass the cache.
func TestProviderSearchCacheAndUnconfiguredProvider(t *testing.T) {
	ol := &fakeProvider{name: metadata.ProviderOpenLibrary, matches: []metadata.Match{{Provider: metadata.ProviderOpenLibrary, ID: "w1", Fields: metadata.Fields{"title": raw("Second Volume")}}}}
	r := newReadingEnvWith(t, apitest.Options{Providers: map[string]metadata.Provider{ol.name: ol}, ProviderCacheTTL: 10 * time.Minute})
	e := r.e
	path := "/admin/editions/" + r.ed.ID + "/metadata/provider-search"
	search := func(fresh bool) wire.T005ProviderSearchResults {
		t.Helper()
		x := e.Do("POST", path, e.Login(seed.AdminName, "cli").AccessToken, map[string]any{"query": map[string]any{}, "fresh": fresh}) // the test clock outruns one access token
		if x.StatusCode != 200 {
			t.Fatalf("search: %d %s", x.StatusCode, x.Body)
		}
		var out wire.T005ProviderSearchResults
		x.JSON(t, &out)
		return out
	}
	r.setProviderOrder(t, []string{metadata.ProviderOpenLibrary, metadata.ProviderHardcover})

	out := search(false)
	if ol.calls() != 1 || out.Results[0].Cached {
		t.Fatalf("first search must contact the provider: calls=%d %+v", ol.calls(), out.Results[0])
	}
	// Hardcover is listed by the library but the operator set no token: reported, never contacted.
	if out.Results[1].Provider != "hardcover" || out.Results[1].Status != "unconfigured" || len(out.Results[1].Candidates) != 0 {
		t.Fatalf("unconfigured: %+v", out.Results[1])
	}
	if out = search(false); ol.calls() != 1 || !out.Results[0].Cached || len(out.Results[0].Candidates) != 1 {
		t.Fatalf("second search must come from the cache: calls=%d %+v", ol.calls(), out.Results[0])
	}
	if out = search(true); ol.calls() != 2 || out.Results[0].Cached {
		t.Fatalf("fresh must bypass the cache: calls=%d", ol.calls())
	}
	e.Clock.Advance(9 * time.Minute)
	if search(false); ol.calls() != 2 {
		t.Fatalf("still inside the 10 minutes: calls=%d", ol.calls())
	}
	e.Clock.Advance(2 * time.Minute) // 11 minutes since the refresh
	if out = search(false); ol.calls() != 3 || out.Results[0].Cached {
		t.Fatalf("expired entry must be looked up again: calls=%d", ol.calls())
	}

	// A failure is reported and not cached: the next search contacts the provider again.
	e.Clock.Advance(11 * time.Minute)
	ol.err = errors.New("provider returned status 429")
	if out = search(false); out.Results[0].Status != "unavailable" || ol.calls() != 4 {
		t.Fatalf("failure: calls=%d %+v", ol.calls(), out.Results[0])
	}
	ol.err = nil
	if out = search(false); out.Results[0].Status != "ok" || ol.calls() != 5 || out.Results[0].Cached {
		t.Fatalf("a failure must not be cached: calls=%d %+v", ol.calls(), out.Results[0])
	}
}

func (r *readingEnv) autoFill(t *testing.T, base string) (wire.T005AutoFillResult, apitest.Response) {
	t.Helper()
	x := r.e.Do("POST", "/admin/editions/"+r.ed.ID+"/metadata/auto-fill", r.admin, map[string]any{"operationId": uuid.NewString(), "baseRevision": base})
	var out wire.T005AutoFillResult
	if x.StatusCode == 200 {
		x.JSON(t, &out)
	}
	return out, x
}

// ADR-0060/0087: auto-fill fills only empty fields, only from one exact identifier match that agrees with the stored
// title and authors, and never touches a protected edit.
func TestEditionAutoFillIsGapOnlyAndConservative(t *testing.T) {
	match := func(id string, byID bool, title string) metadata.Match {
		return metadata.Match{Provider: metadata.ProviderOpenLibrary, ID: id, ByIdentifier: byID, Fields: metadata.Fields{
			"title": raw(title), "authors": raw([]string{"Ada Author"}), "publisher": raw("Press"), "description": raw("From the provider."),
			"published": raw("2007-01-09"), "narrators": raw([]string{"x"})}}
	}
	ol := &fakeProvider{name: metadata.ProviderOpenLibrary}
	r := newReadingEnvWith(t, apitest.Options{Providers: map[string]metadata.Provider{ol.name: ol}})
	e := r.e
	getReport := func() wire.T005MetadataReport {
		var rep wire.T005MetadataReport
		e.Do("GET", "/admin/editions/"+r.ed.ID+"/metadata", r.admin, nil).JSON(t, &rep)
		return rep
	}

	if x := e.Do("POST", "/admin/editions/"+r.ed.ID+"/metadata/auto-fill", r.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "0"}); x.StatusCode != 403 {
		t.Fatalf("non-admin: %d", x.StatusCode)
	}
	if out, x := r.autoFill(t, "0"); x.StatusCode != 200 || out.Outcome != "disabled" || ol.calls() != 0 {
		t.Fatalf("disabled: %d %s calls=%d", x.StatusCode, x.Body, ol.calls())
	}
	r.setProviderOrder(t, []string{metadata.ProviderOpenLibrary})

	// Not exact (a search hit), inconsistent, or several hits: review, and nothing is stored.
	for name, ms := range map[string][]metadata.Match{
		"search hit":   {match("w1", false, "Second Volume")},
		"inconsistent": {match("w1", true, "A Different Book")},
		"two hits":     {match("w1", true, "Second Volume"), match("w2", true, "Second Volume")},
	} {
		ol.matches = ms
		if out, x := r.autoFill(t, "0"); x.StatusCode != 200 || out.Outcome != "needs_review" || len(out.Filled) != 0 || out.Revision != "0" {
			t.Fatalf("%s: %d %s", name, x.StatusCode, x.Body)
		}
	}
	ol.matches = nil
	if out, _ := r.autoFill(t, "0"); out.Outcome != "no_match" {
		t.Fatalf("no match: %+v", out)
	}

	// A protected edit stays; the other empty fields are filled as provider values.
	if x := r.metaPut(r.admin, r.ed.ID, "description", mw("0", "My own synopsis", false)); x.StatusCode != 200 {
		t.Fatalf("edit: %d %s", x.StatusCode, x.Body)
	}
	ol.matches = []metadata.Match{match("w1", true, "Second Volume")}
	if _, x := r.autoFill(t, "0"); x.StatusCode != 409 {
		t.Fatalf("a stale base must be refused: %d %s", x.StatusCode, x.Body)
	}
	out, x := r.autoFill(t, "1")
	if x.StatusCode != 200 || out.Outcome != "filled" || out.Provider != "open_library" || out.Revision != "2" {
		t.Fatalf("fill: %d %s", x.StatusCode, x.Body)
	}
	got := map[string]bool{}
	for _, f := range out.Filled {
		got[f] = true
	}
	if !got["publisher"] || !got["published"] || got["description"] || got["title"] || got["narrators"] {
		t.Fatalf("filled the wrong fields: %v", out.Filled)
	}
	rep := getReport()
	if d := field(rep, "description"); d.Source != "user" || string(d.Value.Raw) != `"My own synopsis"` {
		t.Fatalf("a protected edit must survive: %+v", d)
	}
	if p := field(rep, "publisher"); p == nil || p.Source != "provider" || string(p.Value.Raw) != `"Press"` {
		t.Fatalf("publisher: %+v", p)
	}
	if rep.Revision != "2" {
		t.Fatalf("revision %s", rep.Revision)
	}

	// Nothing left to fill: no write, same revision.
	if out, _ = r.autoFill(t, "2"); out.Outcome != "nothing_to_fill" || out.Revision != "2" || getReport().Revision != "2" {
		t.Fatalf("second run: %+v", out)
	}
}

func TestRecordingAutoFillFillsOnlyGaps(t *testing.T) {
	au := &fakeProvider{name: metadata.ProviderAudnexus, matches: []metadata.Match{{Provider: metadata.ProviderAudnexus, ID: "B000TEST01", ByIdentifier: true,
		Fields: metadata.Fields{"title": raw("Original Title"), "authors": raw([]string{"An Author"}), "narrators": raw([]string{"A Narrator"}),
			"series_name": raw("Saga"), "publisher": raw("Provider House")}}}}
	e := apitest.New(t, apitest.Options{Providers: map[string]metadata.Provider{au.name: au}})
	root, _ := filepath.Abs(t.TempDir())
	admin := e.Login(seed.AdminName, "cli").AccessToken
	d := setupLibrary(t, e, admin, root)
	lib := d.Library.ID
	audioAt(t, filepath.Join(root, "Book", "1.mp3"), 440, "album", "Original Title", "artist", "An Author", "publisher", "Tag House")
	scanTwice(t, e, admin, lib)
	var rec string
	if err := e.Pool.QueryRow(t.Context(), `SELECT id FROM recordings WHERE library_id=$1`, lib).Scan(&rec); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Pool.Exec(t.Context(), `UPDATE titles SET identifier='B000TEST01' WHERE id=(SELECT title_id FROM recordings WHERE id=$1)`, rec); err != nil {
		t.Fatal(err)
	}
	path := "/admin/recordings/" + rec + "/metadata/auto-fill"
	var cfg wire.LibraryDetail
	e.Do("GET", "/admin/libraries/"+lib, admin, nil).JSON(t, &cfg)
	cfg.Config.ProviderOrder = []string{metadata.ProviderAudnexus}
	e.Do("PUT", "/admin/libraries/"+lib+"/config", admin, cfg.Config)

	var out wire.T005AutoFillResult
	x := e.Do("POST", path, admin, nil)
	x.JSON(t, &out)
	if x.StatusCode != 200 || out.Outcome != "filled" {
		t.Fatalf("fill: %d %s", x.StatusCode, x.Body)
	}
	got := map[string]bool{}
	for _, f := range out.Filled {
		got[f] = true
	}
	if !got["narrators"] || !got["series_name"] || got["publisher"] {
		t.Fatalf("the file's own publisher must not be replaced: %v", out.Filled)
	}
	var rep wire.MetadataReport
	e.Do("GET", "/admin/recordings/"+rec+"/metadata", admin, nil).JSON(t, &rep)
	for _, f := range rep.Fields {
		if f.Field == "publisher" && f.Source == "provider" {
			t.Fatalf("publisher was overwritten: %+v", f)
		}
	}
	if x := e.Do("POST", path, e.Login(seed.UserAName, "phone").AccessToken, nil); x.StatusCode != 403 {
		t.Fatalf("non-admin: %d", x.StatusCode)
	}
}

// The descriptive fields added beyond the original eleven are editable, validated and kept as protected edits.
func TestEditionExtraDescriptiveFieldsAreEditableAndValidated(t *testing.T) {
	r := newReadingEnv(t)
	good := map[string]any{
		"subtitle": "A Tale", "genres": []string{"Adventure", "Classics"}, "moods": []string{"Tense"}, "age_rating": "Teen", "asin": "B000TEST01",
		"open_library_id": "OL262758W", "google_books_id": "abc123", "hardcover_id": "42", "goodreads_id": "5907", "public_rating": 4.25, "public_rating_count": 1200,
	}
	rev := 0
	for name, v := range good {
		x := r.metaPut(r.admin, r.ed.ID, name, mw(strconv.Itoa(rev), v, false))
		if x.StatusCode != 200 {
			t.Fatalf("%s: %d %s", name, x.StatusCode, x.Body)
		}
		rev++
	}
	var rep wire.T005MetadataReport
	r.e.Do("GET", "/admin/editions/"+r.ed.ID+"/metadata", r.admin, nil).JSON(t, &rep)
	for name := range good {
		if f := field(rep, name); f == nil || f.Source != "user" {
			t.Fatalf("%s must be a protected edit: %+v", name, f)
		}
	}
	for name, v := range map[string]any{"asin": "short", "public_rating": 6, "public_rating_count": -1, "genres": []string{}, "hardcover_id": "has space", "subtitle": " "} {
		if x := r.metaPut(r.admin, r.ed.ID, name, mw(strconv.Itoa(rev), v, false)); x.StatusCode != 422 && x.StatusCode != 400 {
			t.Errorf("%s=%v must be refused: %d %s", name, v, x.StatusCode, x.Body)
		}
	}
	if x := r.metaPut(r.admin, r.ed.ID, "no_such_field", mw(strconv.Itoa(rev), "x", false)); x.StatusCode == 200 {
		t.Fatal("an unknown field must be refused")
	}
}

func (r *readingEnv) setTitleMatch(t *testing.T, on bool) {
	t.Helper()
	var d wire.LibraryDetail
	r.e.Do("GET", "/admin/libraries/"+r.lib, r.admin, nil).JSON(t, &d)
	cfg := d.Config
	cfg.AutoFillTitleMatch = on
	if x := r.e.Do("PUT", "/admin/libraries/"+r.lib+"/config", r.admin, cfg); x.StatusCode != 200 {
		t.Fatalf("set title match: %d %s", x.StatusCode, x.Body)
	}
}

func (r *readingEnv) autoFillDry(t *testing.T, base string) (wire.T005AutoFillResult, apitest.Response) {
	t.Helper()
	x := r.e.Do("POST", "/admin/editions/"+r.ed.ID+"/metadata/auto-fill", r.admin, map[string]any{"operationId": uuid.NewString(), "baseRevision": base, "dryRun": true})
	var out wire.T005AutoFillResult
	if x.StatusCode == 200 {
		x.JSON(t, &out)
	}
	return out, x
}

// ADR-0090: with the library's setting on, one clear title-and-author match is offered even without an identifier;
// anything less clear goes to review. A dry run stores nothing.
func TestEditionAutoFillTitleAndAuthorMatchIsPerLibraryAndReviewedBeforeSaving(t *testing.T) {
	cand := func(id, title string, authors []string, extra metadata.Fields) metadata.Match {
		f := metadata.Fields{"title": raw(title), "authors": raw(authors), "publisher": raw("Press"), "description": raw("From the provider.")}
		for k, v := range extra {
			f[k] = v
		}
		return metadata.Match{Provider: metadata.ProviderOpenLibrary, ID: id, Fields: f}
	}
	ol := &fakeProvider{name: metadata.ProviderOpenLibrary}
	r := newReadingEnvWith(t, apitest.Options{Providers: map[string]metadata.Provider{ol.name: ol}})
	e := r.e
	r.setProviderOrder(t, []string{metadata.ProviderOpenLibrary})
	ol.matches = []metadata.Match{cand("w1", "Second Volume", []string{"Ada Author"}, nil)}

	// Off by default: a title-and-author match is only a candidate for review.
	if out, x := r.autoFillDry(t, "0"); x.StatusCode != 200 || out.Outcome != "needs_review" || len(out.Proposed) != 0 {
		t.Fatalf("off by default: %d %s", x.StatusCode, x.Body)
	}
	r.setTitleMatch(t, true)

	// On: the dry run offers every empty field it has and stores nothing.
	out, x := r.autoFillDry(t, "0")
	if x.StatusCode != 200 || out.Outcome != "proposed" || out.Rule != "title_author" || out.Provider != "open_library" || len(out.Filled) != 0 {
		t.Fatalf("title and author: %d %s", x.StatusCode, x.Body)
	}
	if _, ok := out.Proposed["publisher"]; !ok || out.Proposed["title"].Raw != nil {
		t.Fatalf("proposed: %+v", out.Proposed)
	}
	var rep wire.T005MetadataReport
	e.Do("GET", "/admin/editions/"+r.ed.ID+"/metadata", r.admin, nil).JSON(t, &rep)
	if rep.Revision != "0" || field(rep, "publisher") != nil {
		t.Fatalf("a dry run must store nothing: revision %s", rep.Revision)
	}

	// Anything less clear goes to review: another title, an author the book does not have listed, a different
	// language, two candidates, or a failed provider.
	for name, ms := range map[string][]metadata.Match{
		"other title":      {cand("w1", "Second Volume: The Sequel", []string{"Ada Author"}, nil)},
		"missing author":   {cand("w1", "Second Volume", []string{"Someone Else"}, nil)},
		"no authors":       {cand("w1", "Second Volume", nil, nil)},
		"other language":   {cand("w1", "Second Volume", []string{"Ada Author"}, metadata.Fields{"language": raw("fr")})},
		"two candidates":   {cand("w1", "Second Volume", []string{"Ada Author"}, nil), cand("w2", "Second Volume", []string{"Ada Author"}, nil)},
		"identifier match": {{Provider: metadata.ProviderOpenLibrary, ID: "w1", ByIdentifier: true, Fields: metadata.Fields{"title": raw("Another"), "authors": raw([]string{"Ada Author"})}}},
	} {
		ol.matches = ms
		if out, x := r.autoFillDry(t, "0"); x.StatusCode != 200 || out.Outcome != "needs_review" || len(out.Proposed) != 0 {
			t.Fatalf("%s: %d %s", name, x.StatusCode, x.Body)
		}
	}
	ol.matches = []metadata.Match{cand("w1", "Second Volume", []string{"Ada Author"}, nil)}
	ol.err = errors.New("provider returned status 429")
	if out, _ := r.autoFillDry(t, "0"); out.Outcome != "needs_review" && out.Outcome != "no_match" || len(out.Proposed) != 0 {
		t.Fatalf("a failed provider must not be accepted: %+v", out)
	}
	ol.err = nil

	// An identifier match is also proposed, not stored, and says which rule applied.
	ol.matches = []metadata.Match{{Provider: metadata.ProviderOpenLibrary, ID: "w1", ByIdentifier: true, Fields: metadata.Fields{
		"title": raw("Second Volume"), "authors": raw([]string{"Ada Author"}), "publisher": raw("Press")}}}
	if out, x := r.autoFillDry(t, "0"); x.StatusCode != 200 || out.Outcome != "proposed" || out.Rule != "identifier" {
		t.Fatalf("identifier match: %d %s", x.StatusCode, x.Body)
	}
}
