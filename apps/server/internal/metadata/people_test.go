package metadata_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

// These use a local server. The Hardcover replies are synthetic, written from its published schema; no live Hardcover
// request was made. The Open Library replies are trimmed from the shapes its live API returned on 2026-11-26.
func hardcoverServer(t *testing.T, seen *[]map[string]any) metadata.Hardcover {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &body)
		*seen = append(*seen, body.Variables)
		switch {
		case strings.Contains(body.Query, "search(") && body.Variables["kind"] == "Author":
			_, _ = w.Write([]byte(`{"data":{"search":{"results":{"hits":[{"document":{"id":"5"}},{"document":{"id":"6"}}]}}}}`))
		case strings.Contains(body.Query, "search(") && body.Variables["q"] == "Hidden":
			_, _ = w.Write([]byte(`{"data":{"search":{"results":{"hits":[{"document":{"id":"77","title":"Hidden","author_names":["Someone Else"]}}]}}}}`))
		case strings.Contains(body.Query, "search("):
			// The first hit is another book of the same author: it must not be used.
			_, _ = w.Write([]byte(`{"data":{"search":{"results":{"hits":[
{"document":{"id":"90","title":"God Emperor of Dune","author_names":["Frank Herbert"]}},
{"document":{"id":"91","title":"Dune","author_names":["Frank Herbert"]}}]}}}}`))
		case strings.Contains(body.Query, "authors("):
			// 6 is a merged duplicate, which the canonical filter leaves out.
			_, _ = w.Write([]byte(`{"data":{"authors":[{"id":5,"name":"Frank Herbert","slug":"frank-herbert","bio":" A writer. ","books_count":1,"cached_image":{"url":"https://assets.example/p.jpg"}},{"id":6,"name":"A Critic","slug":"critic","books_count":2,"cached_image":{}}]}}`))
		case strings.Contains(body.Query, "books("):
			_, _ = w.Write([]byte(`{"data":{"books":[{"book_series":[{"series":{"id":3,"name":"Dune"}}]}]}}`))
		case strings.Contains(body.Query, "editions("):
			_, _ = w.Write([]byte(`{"data":{"editions":[]}}`))
		case body.Variables["id"] == float64(404):
			_, _ = w.Write([]byte(`{"data":{"series":[]}}`))
		default:
			_, _ = w.Write([]byte(`{"data":{"series":[{"id":3,"name":"Dune","slug":"dune","description":"","primary_books_count":6,"is_completed":null,"author":{"name":"Frank Herbert"},
"book_series":[
{"position":0,"book":{"title":"A magazine issue","slug":"m","cached_image":{}}},
{"position":1,"book":{"title":"Dune","slug":"dune-1","release_date":"1965-08-01","cached_image":{"url":"https://assets.example/1.jpg"},"contributions":[{"author":{"name":"Frank Herbert"}}]}},
{"position":1,"book":{"title":"A duplicate of Dune","slug":"dup","cached_image":{}}},
{"position":2.5,"book":{"title":"A novella","slug":"n","cached_image":{}}},
{"position":2,"book":{"title":"Dune Messiah","slug":"bad slug/../x","release_year":1969,"cached_image":{"url":"http://insecure.example/2.jpg"}}},
{"position":null,"book":{"title":"Unnumbered","slug":"u","cached_image":{}}}]}]}}`))
		}
	}))
	t.Cleanup(srv.Close)
	return metadata.Hardcover{HTTP: metadata.HTTP{BaseURL: srv.URL}, Token: "token"}
}

func TestHardcoverAuthorsAndSeries(t *testing.T) {
	var seen []map[string]any
	p := hardcoverServer(t, &seen)
	ctx := context.Background()

	authors, err := p.FindAuthors(ctx, "Frank Herbert")
	if err != nil || len(authors) != 1 {
		t.Fatalf("%+v %v", authors, err)
	}
	want := metadata.AuthorHit{Provider: "hardcover", ID: "5", Name: "Frank Herbert", Detail: "1 work listed", Biography: "A writer.",
		PhotoURL: "https://assets.example/p.jpg", PageURL: "https://hardcover.app/authors/frank-herbert"}
	if authors[0] != want {
		t.Fatalf("author: %+v", authors[0])
	}
	if _, err := p.Author(ctx, "x"); !errors.Is(err, metadata.ErrNoSuchRecord) {
		t.Fatalf("bad id: %v", err)
	}

	// With an ISBN that finds nothing, only a search hit whose title and author agree is followed.
	seen = nil
	refs, err := p.BookSeries(ctx, metadata.Query{Title: "Dune", Authors: []string{"Frank Herbert"}, ISBN: "9780441013593"})
	if err != nil || !reflect.DeepEqual(refs, []metadata.SeriesRef{{ID: "3", Name: "Dune"}}) {
		t.Fatalf("refs: %+v %v", refs, err)
	}
	if last := seen[len(seen)-1]; !reflect.DeepEqual(last["ids"], []any{float64(91)}) {
		t.Fatalf("followed the wrong hit: %+v", last)
	}

	// The title is searched alone, because adding the author can push the book out of Hardcover's results. The author
	// is added only when the title alone finds no agreeing hit.
	seen = nil
	if _, err := p.BookSeries(ctx, metadata.Query{Title: "Dune", Authors: []string{"Frank Herbert"}}); err != nil || seen[0]["q"] != "Dune" || len(seen) != 2 {
		t.Fatalf("title search: %+v %v", seen, err)
	}
	seen = nil
	if refs, err := p.BookSeries(ctx, metadata.Query{Title: "Hidden", Authors: []string{"Frank Herbert"}}); err != nil || len(refs) != 0 || len(seen) != 2 || seen[1]["q"] != "Hidden Frank Herbert" {
		t.Fatalf("second search: %+v %+v %v", refs, seen, err)
	}

	// A name nobody has exactly still offers what the search found.
	if loose, err := p.FindAuthors(ctx, "F. Herbert"); err != nil || len(loose) != 2 {
		t.Fatalf("loose name: %+v %v", loose, err)
	}

	s, err := p.Series(ctx, "3")
	if err != nil || s.BookCount != 6 || s.Status != "" || s.Description != "" || s.PageURL != "https://hardcover.app/series/dune" {
		t.Fatalf("series: %+v %v", s, err)
	}
	// Only whole numbers from 1, one each; an unsafe slug links to the site, and a picture must be https.
	if len(s.Members) != 2 || s.Members[0].Title != "Dune" || s.Members[0].Released != "1965-08-01" || s.Members[0].CoverURL == "" ||
		s.Members[1].Title != "Dune Messiah" || s.Members[1].Released != "1969" || s.Members[1].CoverURL != "" || s.Members[1].PageURL != "https://hardcover.app" {
		t.Fatalf("members: %+v", s.Members)
	}
	if _, err := p.Series(ctx, "404"); !errors.Is(err, metadata.ErrNoSuchRecord) {
		t.Fatalf("missing series: %v", err)
	}
}

func TestOpenLibraryAuthorsAndSeries(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/search/authors.json":
			_, _ = w.Write([]byte(`{"docs":[{"key":"OL1A","name":"Frank Herbert Hayward","work_count":21},{"key":"OL79034A","name":"Frank Herbert","top_work":"Dune","work_count":200}]}`))
		case r.URL.Path == "/authors/OL79034A.json":
			_, _ = w.Write([]byte(`{"name":"Frank Herbert","bio":{"type":"/type/text","value":"Author of [Dune][1] and [more](https://example.org/x).\r\n\r\n  [1]: https://openlibrary.org/works/OL1W"},"photos":[-1,123]}`))
		case r.URL.Path == "/series/OL334747L.json":
			_, _ = w.Write([]byte(`{"name":"The Expanse","description":null}`))
		case r.URL.Path == "/search.json" && r.URL.Query().Get("q") == "series_key:OL334747L":
			_, _ = w.Write([]byte(`{"docs":[
{"key":"/works/OL2W","title":"Caliban's war","author_name":["James S. A. Corey"],"series_key":["OL334747L"],"series_position":["2"],"first_publish_year":2012},
{"key":"/works/OL1W","title":"Leviathan Wakes","author_name":["James S. A. Corey"],"series_key":["OL9L","OL334747L"],"series_position":["7","1"],"cover_i":7314237,"first_publish_year":2009},
{"key":"/works/OL3W","title":"A novella","series_key":["OL334747L"],"series_position":["1.5"]}]}`))
		case r.URL.Path == "/search.json":
			_, _ = w.Write([]byte(`{"docs":[{"title":"Another Book","author_name":["James S. A. Corey"],"series_key":["OL8L"],"series_name":["Wrong"]},
{"title":"Leviathan Wakes","author_name":["James S.A. Corey"],"series_key":["OL334747L"],"series_name":["The Expanse"]}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	p := metadata.OpenLibrary{HTTP: metadata.HTTP{BaseURL: srv.URL}}
	ctx := context.Background()

	authors, err := p.FindAuthors(ctx, "Frank Herbert")
	if err != nil || len(authors) != 1 || authors[0].ID != "OL79034A" || authors[0].Biography != "Author of Dune and more." ||
		authors[0].PhotoURL != "https://covers.openlibrary.org/a/id/123-L.jpg" || authors[0].Detail != "200 works listed, including Dune" {
		t.Fatalf("%+v %v", authors, err)
	}
	if _, err := p.Author(ctx, "../secrets"); !errors.Is(err, metadata.ErrNoSuchRecord) {
		t.Fatalf("unsafe id: %v", err)
	}
	refs, err := p.BookSeries(ctx, metadata.Query{Title: "Leviathan Wakes", Authors: []string{"James S. A. Corey"}})
	if err != nil || !reflect.DeepEqual(refs, []metadata.SeriesRef{{ID: "OL334747L", Name: "The Expanse"}}) {
		t.Fatalf("refs: %+v %v", refs, err)
	}
	s, err := p.Series(ctx, "OL334747L")
	if err != nil || s.Name != "The Expanse" || len(s.Members) != 2 || s.Members[0].Position != 1 || s.Members[0].CoverURL == "" ||
		s.Members[0].PageURL != "https://openlibrary.org/works/OL1W" || s.Members[1].Position != 2 {
		t.Fatalf("series: %+v %v", s, err)
	}
}

func TestSameTitleIgnoresPunctuationAndSubtitles(t *testing.T) {
	for _, pair := range [][2]string{{"Caliban's war", "Caliban’s War"}, {"Dune: The Graphic Novel", "dune"}} {
		if !metadata.SameTitle(pair[0], pair[1]) {
			t.Errorf("%q and %q", pair[0], pair[1])
		}
	}
	for _, pair := range [][2]string{{"Dune", "Dune Messiah"}, {"", ""}, {"Star Wars: Heir to the Empire", "Star Wars: Dark Force Rising"}} {
		if metadata.SameTitle(pair[0], pair[1]) {
			t.Errorf("%q and %q should differ", pair[0], pair[1])
		}
	}
}
