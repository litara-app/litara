package ingest_test

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/library"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func (e *env) title(rec uuid.UUID) (title string, authors []string, series *string, narrators []string) {
	e.t.Helper()
	err := e.pool.QueryRow(context.Background(), `SELECT t.title, t.authors, t.series_name, r.narrators FROM recordings r JOIN titles t ON t.id=r.title_id WHERE r.id=$1`, rec).
		Scan(&title, &authors, &series, &narrators)
	if err != nil {
		e.t.Fatal(err)
	}
	return
}

func TestMetadataPrecedenceAcrossRescans(t *testing.T) {
	e := newEnv(t)
	e.audio("Book/1.mp3", 440, "album", "Embedded Title", "artist", "Embedded Author", "series", "Embedded Series")
	e.settle()
	rec := e.recordings()[0].ID
	if ti, au, se, _ := e.title(rec); ti != "Embedded Title" || len(au) != 1 || au[0] != "Embedded Author" || se == nil || *se != "Embedded Series" {
		t.Fatalf("embedded values: %q %v %v", ti, au, se)
	}

	// An associated sidecar outranks embedded tags.
	e.write("Book/litara.json", `{"title":"Sidecar Title","narrators":["Sidecar Narrator"]}`)
	e.scan("manual", time.Minute)
	ti, au, _, na := e.title(rec)
	if ti != "Sidecar Title" || len(na) != 1 || na[0] != "Sidecar Narrator" || au[0] != "Embedded Author" {
		t.Fatalf("sidecar over embedded, embedded still fills the rest: %q %v %v", ti, au, na)
	}

	// A protected edit and a protected clear outrank everything and survive rescans.
	ms := metadata.New(e.pool)
	if err := ms.SetUser(context.Background(), rec, "title", json.RawMessage(`"My Title"`)); err != nil {
		t.Fatal(err)
	}
	if err := ms.SetUser(context.Background(), rec, "series_name", nil); err != nil { // deliberate clear
		t.Fatal(err)
	}
	e.write("Book/litara.json", `{"title":"Changed Sidecar","series":{"name":"Sidecar Series"}}`)
	e.scan("manual", time.Minute)
	e.scan("manual", time.Minute)
	ti, _, se, _ := e.title(rec)
	if ti != "My Title" || se != nil {
		t.Fatalf("protected values must survive rescans: %q %v", ti, se)
	}
	rep, err := ms.Report(context.Background(), rec)
	if err != nil || !rep["series_name"].Cleared || len(rep["series_name"].Conflicts) != 2 || rep["title"].Source != "user" {
		t.Fatalf("provenance and suppressed conflicts are reported: %+v %v", rep, err)
	}

	// Removing the override lets the next source apply again.
	if err := ms.RemoveUser(context.Background(), rec, "title"); err != nil {
		t.Fatal(err)
	}
	if ti, _, _, _ := e.title(rec); ti != "Changed Sidecar" {
		t.Fatalf("after removing the override: %q", ti)
	}
	if err := ms.SetUser(context.Background(), rec, "title", nil); err == nil {
		t.Fatal("the title cannot be cleared")
	}
}

type fakeProvider struct {
	name    string
	calls   atomic.Int32
	matches []metadata.Match
	err     error
	last    metadata.Query
}

func (f *fakeProvider) Name() string { return f.name }
func (f *fakeProvider) Lookup(_ context.Context, q metadata.Query) ([]metadata.Match, error) {
	f.calls.Add(1)
	f.last = q
	return f.matches, f.err
}

func fields(kv map[string]any) metadata.Fields {
	f := metadata.Fields{}
	for k, v := range kv {
		b, _ := json.Marshal(v)
		f[k] = b
	}
	return f
}

func (e *env) enableProviders(names ...string) {
	e.t.Helper()
	d, err := library.New(e.pool).Get(context.Background(), e.lib)
	if err != nil {
		e.t.Fatal(err)
	}
	cfg := d.Config
	cfg.ProviderOrder = names
	if _, err := library.New(e.pool).Put(context.Background(), e.lib, cfg); err != nil {
		e.t.Fatal(err)
	}
}

func TestProvidersAreDisabledUntilEnabledPerLibrary(t *testing.T) {
	e := newEnv(t)
	e.audio("B/1.mp3", 440, "album", "Book", "artist", "Auth", "asin", "B000TEST01")
	e.settle()
	fp := &fakeProvider{name: "audnexus"}
	en := &metadata.Enricher{Service: metadata.New(e.pool), Providers: map[string]metadata.Provider{"audnexus": fp}}
	if err := en.EnrichLibrary(context.Background(), e.lib); err != nil || fp.calls.Load() != 0 {
		t.Fatalf("no lookup without opt-in: calls=%d err=%v", fp.calls.Load(), err)
	}
}

func TestUnambiguousIdentifierMatchFillsGapsOnly(t *testing.T) {
	e := newEnv(t)
	e.audio("B/1.mp3", 440, "album", "The Book", "artist", "An Author", "asin", "B000TEST01")
	e.settle()
	rec := e.recordings()[0].ID
	e.enableProviders("audnexus")
	fp := &fakeProvider{name: "audnexus", matches: []metadata.Match{{Provider: "audnexus", ID: "B000TEST01", ByIdentifier: true,
		Fields: fields(map[string]any{"title": "THE BOOK", "authors": []string{"an author"}, "narrators": []string{"A Narrator"}, "series_name": "Saga"})}}}
	en := &metadata.Enricher{Service: metadata.New(e.pool), Providers: map[string]metadata.Provider{"audnexus": fp}}
	if err := en.EnrichLibrary(context.Background(), e.lib); err != nil {
		t.Fatal(err)
	}
	ti, au, se, na := e.title(rec)
	if ti != "The Book" || au[0] != "An Author" {
		t.Fatalf("provider must not override existing embedded values: %q %v", ti, au)
	}
	if len(na) != 1 || na[0] != "A Narrator" || se == nil || *se != "Saga" {
		t.Fatalf("gaps are filled: %v %v", na, se)
	}
	if fp.last.ASIN != "B000TEST01" {
		t.Fatalf("only identifier text is sent: %+v", fp.last)
	}
	// Repeating does not call the provider again.
	_ = en.EnrichLibrary(context.Background(), e.lib)
	if fp.calls.Load() != 1 {
		t.Fatalf("a recorded lookup is not repeated: %d", fp.calls.Load())
	}
}

func TestSearchHitsAndInconsistentMatchesGoToReview(t *testing.T) {
	e := newEnv(t)
	e.audio("A/1.mp3", 440, "album", "Plain Book", "artist", "Some Author") // no identifier
	e.audio("B/1.mp3", 523, "album", "Other Book", "artist", "Other Author", "asin", "B000TEST02")
	e.settle()
	e.enableProviders("audnexus", "open_library")
	nar := fields(map[string]any{"title": "Totally Different", "authors": []string{"Nobody"}, "narrators": []string{"Wrong"}})
	aud := &fakeProvider{name: "audnexus", matches: []metadata.Match{{Provider: "audnexus", ByIdentifier: true, Fields: nar}}}
	ol := &fakeProvider{name: "open_library", matches: []metadata.Match{
		{Provider: "open_library", ByIdentifier: false, Fields: fields(map[string]any{"title": "Plain Book", "authors": []string{"Some Author"}, "narrators": []string{"Guess"}})}}}
	en := &metadata.Enricher{Service: metadata.New(e.pool), Providers: map[string]metadata.Provider{"audnexus": aud, "open_library": ol}}
	if err := en.EnrichLibrary(context.Background(), e.lib); err != nil {
		t.Fatal(err)
	}
	for _, r := range e.recordings() {
		if _, _, _, na := e.title(r.ID); len(na) != 0 {
			t.Fatalf("nothing uncertain may be applied automatically: %v", na)
		}
	}
	if n := e.openReviews("provider"); n < 2 {
		t.Fatalf("a text-search hit (even a perfect one) and an inconsistent identifier match both need review, got %d", n)
	}
}

func TestProviderFailureIsRecordedAndRetried(t *testing.T) {
	e := newEnv(t)
	e.audio("B/1.mp3", 440, "album", "The Book", "artist", "An Author", "asin", "B000TEST01")
	e.settle()
	e.enableProviders("audnexus")
	fp := &fakeProvider{name: "audnexus", err: context.DeadlineExceeded}
	en := &metadata.Enricher{Service: metadata.New(e.pool), Providers: map[string]metadata.Provider{"audnexus": fp}}
	if err := en.EnrichLibrary(context.Background(), e.lib); err != nil {
		t.Fatalf("a provider outage must not fail the pass: %v", err)
	}
	fp.err, fp.matches = nil, nil
	_ = en.EnrichLibrary(context.Background(), e.lib)
	if fp.calls.Load() != 2 {
		t.Fatalf("an errored lookup is retried on the next pass: %d", fp.calls.Load())
	}
	var outcome string
	_ = e.pool.QueryRow(context.Background(), `SELECT outcome FROM provider_lookups`).Scan(&outcome)
	if outcome != "no_match" {
		t.Fatalf("outcome: %s", outcome)
	}
	_ = wire.LibraryConfig{}
}
