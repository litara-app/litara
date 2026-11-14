package metadata_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

// These tests use local servers returning the documented response shapes. They
// prove request construction and parsing only, not live service behavior.
func TestOpenLibraryParsesSearchAndMarksIdentifierMatches(t *testing.T) {
	var gotUA, gotPath, gotISBN string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA, gotPath, gotISBN = r.Header.Get("User-Agent"), r.URL.Path, r.URL.Query().Get("isbn")
		_, _ = w.Write([]byte(`{"numFound":1,"docs":[{"key":"/works/OL1W","title":"The Book","author_name":["An Author"]}]}`))
	}))
	defer srv.Close()
	p := metadata.OpenLibrary{HTTP: metadata.HTTP{BaseURL: srv.URL}}
	ms, err := p.Lookup(context.Background(), metadata.Query{Title: "ignored", ISBN: "9780306406157"})
	if err != nil || len(ms) != 1 {
		t.Fatalf("%v %v", ms, err)
	}
	if !ms[0].ByIdentifier || gotISBN != "9780306406157" || gotPath != "/search.json" {
		t.Fatalf("identifier search: byID=%v isbn=%q path=%q", ms[0].ByIdentifier, gotISBN, gotPath)
	}
	if gotUA == "" || len(gotUA) > 80 {
		t.Fatalf("a generic client name is sent: %q", gotUA)
	}
	ms, _ = p.Lookup(context.Background(), metadata.Query{Title: "The Book", Authors: []string{"An Author"}})
	if len(ms) != 1 || ms[0].ByIdentifier {
		t.Fatalf("a text search hit is never an identifier match: %+v", ms)
	}
}

func TestGoogleBooksAndAudnexus(t *testing.T) {
	g := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/books/v1/volumes" || r.URL.Query().Get("q") != "isbn:9780306406157" {
			http.Error(w, "unexpected", 400)
			return
		}
		_, _ = w.Write([]byte(`{"totalItems":1,"items":[{"id":"abc","volumeInfo":{"title":"The Book","authors":["An Author"]}}]}`))
	}))
	defer g.Close()
	ms, err := metadata.GoogleBooks{HTTP: metadata.HTTP{BaseURL: g.URL}}.Lookup(context.Background(), metadata.Query{ISBN: "9780306406157"})
	if err != nil || len(ms) != 1 || !ms[0].ByIdentifier || string(ms[0].Fields["title"]) != `"The Book"` {
		t.Fatalf("google: %+v %v", ms, err)
	}

	var calls atomic.Int32
	a := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/books/B000TEST01" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"asin":"B000TEST01","title":"The Book","authors":[{"name":"An Author"}],"narrators":[{"name":"A Narrator"}],"seriesPrimary":{"name":"Saga","position":"1"}}`))
	}))
	defer a.Close()
	p := metadata.Audnexus{HTTP: metadata.HTTP{BaseURL: a.URL}}
	if ms, _ := p.Lookup(context.Background(), metadata.Query{Title: "no asin"}); ms != nil || calls.Load() != 0 {
		t.Fatal("without an ASIN no request may be made")
	}
	ms, err = p.Lookup(context.Background(), metadata.Query{ASIN: "B000TEST01"})
	if err != nil || len(ms) != 1 || string(ms[0].Fields["narrators"]) != `["A Narrator"]` || string(ms[0].Fields["series_name"]) != `"Saga"` {
		t.Fatalf("audnexus: %+v %v", ms, err)
	}
	if ms, err := p.Lookup(context.Background(), metadata.Query{ASIN: "B000MISSING"}); err != nil || ms != nil {
		t.Fatalf("404 is no match, not an error: %v %v", ms, err)
	}
}

func TestProviderErrorsDoNotLeakDetail(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "secret-internal-detail", 500)
	}))
	defer srv.Close()
	_, err := metadata.OpenLibrary{HTTP: metadata.HTTP{BaseURL: srv.URL}}.Lookup(context.Background(), metadata.Query{Title: "x"})
	if err == nil || contains(err.Error(), "secret") {
		t.Fatalf("error must be generic: %v", err)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
