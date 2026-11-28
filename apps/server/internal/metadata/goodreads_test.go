package metadata

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
)

// fakeGoodreads serves the website's two lookup addresses and the GraphQL endpoint with synthetic records, and notes
// every request it receives.
type fakeGoodreads struct {
	isbn         map[string]string // ISBN to the redirect target
	autocomplete string
	books        map[int]string // ID to the book object
	graphqlError string         // when set, every GraphQL reply is this

	mu   sync.Mutex
	seen []string
}

func (f *fakeGoodreads) start(t *testing.T) Goodreads {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		note := r.Method + " " + r.URL.RequestURI()
		defer func() {
			f.mu.Lock()
			f.seen = append(f.seen, note)
			f.mu.Unlock()
		}()
		switch {
		case strings.HasPrefix(r.URL.Path, "/book/isbn/"):
			if to := f.isbn[strings.TrimPrefix(r.URL.Path, "/book/isbn/")]; to != "" {
				http.Redirect(w, r, to, http.StatusMovedPermanently)
				return
			}
			w.WriteHeader(http.StatusNotFound)
		case r.URL.Path == "/book/auto_complete":
			io.WriteString(w, f.autocomplete)
		case r.URL.Path == "/graphql":
			var body struct {
				Query     string         `json:"query"`
				Variables map[string]int `json:"variables"`
			}
			if json.NewDecoder(r.Body).Decode(&body) != nil || !strings.Contains(body.Query, "getBookByLegacyId") {
				t.Error("unexpected GraphQL request")
			}
			if got := r.Header.Get("x-api-key"); got != "test-key" {
				t.Errorf("x-api-key = %q", got)
			}
			note += fmt.Sprintf(" id=%d", body.Variables["id"])
			switch {
			case f.graphqlError != "":
				io.WriteString(w, f.graphqlError)
			case f.books[body.Variables["id"]] != "":
				fmt.Fprintf(w, `{"data":{"getBookByLegacyId":%s}}`, f.books[body.Variables["id"]])
			default:
				io.WriteString(w, `{"data":{"getBookByLegacyId":null},"errors":[{"errorType":"RESOURCE_NOT_FOUND"}]}`)
			}
		default:
			t.Errorf("unexpected request %s", note)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	// The production client does not follow redirects; this one would, so the test shows redirect() stops it.
	g := NewGoodreads(srv.Client(), "test-key", srv.URL+"/graphql")
	g.Web.BaseURL = srv.URL
	g.Web.policy.interval = 0 // shared with g.API
	return g
}

func goodreadsFixture(title, isbn13 string) string {
	return fmt.Sprintf(`{"title":%q,"imageUrl":"https://images.example/%s.jpg",
	  "primaryContributorEdge":{"role":"Author","node":{"name":"Ada  Writer"}},
	  "details":{"isbn13":%q}}`, title, isbn13, isbn13)
}

// jsonText is a string as a field value stores it.
func jsonText(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func goodreadsFields(t *testing.T, m Match) map[string]string {
	t.Helper()
	out := map[string]string{}
	for k, v := range m.Fields {
		out[k] = string(v)
	}
	return out
}

func TestGoodreadsISBNLookupMapsTheRecord(t *testing.T) {
	f := &fakeGoodreads{
		isbn: map[string]string{"9780306406157": "https://www.goodreads.com/book/show/42-the-example"},
		books: map[int]string{42: `{
		  "title":"The Example","imageUrl":"https://images.example/42.jpg",
		  "description":"A <em>fine</em> book &amp; more.<br />Second line.",
		  "primaryContributorEdge":{"role":"Author","node":{"name":"Ada  Writer"}},
		  "secondaryContributorEdges":[
		    {"role":"Introduction","node":{"name":"Ivy Introducer"}},
		    {"role":"Author","node":{"name":"Bo Second"}},
		    {"role":"Translator","node":{"name":"Tam Translator"}}],
		  "bookSeries":[{"userPosition":"2.5","series":{"title":"Examples"}}],
		  "bookGenres":[{"genre":{"name":"Fiction"}},{"genre":{"name":"fiction"}},{"genre":{"name":"Classics"}}],
		  "details":{"numPages":240,"publicationTime":1.6874172E12,"publisher":" A Press ","isbn":"0306406152",
		    "isbn13":"9780306406157","asin":"B000000001","language":{"name":"Spanish; Castilian"}},
		  "work":{"stats":{"averageRating":4.3,"ratingsCount":1200}}}`},
	}
	ms, err := f.start(t).Lookup(context.Background(), Query{ISBN: "9780306406157", Title: "The Example"})
	if err != nil || len(ms) != 1 {
		t.Fatalf("matches %v, err %v", ms, err)
	}
	if m := ms[0]; m.Provider != "goodreads" || m.ID != "42" || !m.ByIdentifier {
		t.Fatalf("match %+v", m)
	}
	want := map[string]string{
		FieldTitle: `"The Example"`, FieldAuthors: `["Ada Writer","Bo Second"]`,
		FieldDescription: jsonText("A fine book & more.\nSecond line."), FieldSeriesName: `"Examples"`, FieldSeriesIndex: `2.5`,
		FieldGenres: `["Fiction","Classics"]`, FieldPublisher: `"A Press"`, FieldPublished: `"2023-06-22"`,
		FieldPageCount: `240`, FieldISBN: `"9780306406157"`, FieldASIN: `"B000000001"`, FieldLanguage: `"es"`,
		FieldPublicRating: `4.3`, FieldPublicRatingCount: `1200`, FieldGoodreadsID: `"42"`,
	}
	got := goodreadsFields(t, ms[0])
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("fields\n got %v\nwant %v", got, want)
	}
	if len(f.seen) != 2 || f.seen[0] != "HEAD /book/isbn/9780306406157" || f.seen[1] != "POST /graphql id=42" {
		t.Fatalf("requests %v", f.seen)
	}
}

func TestGoodreadsOmitsValuesItCannotReadExactly(t *testing.T) {
	f := &fakeGoodreads{
		isbn: map[string]string{"0306406152": "/book/show/7.Sparse"},
		books: map[int]string{7: `{"title":"Sparse","description":null,"primaryContributorEdge":null,
		  "bookSeries":[{"userPosition":"1-3","series":{"title":"Omnibus"}}],
		  "details":{"numPages":null,"publicationTime":-2.52432E11,"isbn":"0306406152","asin":"0306406152","language":{"name":"Klingon"}},
		  "work":{"stats":{"averageRating":0,"ratingsCount":0}}}`},
	}
	ms, err := f.start(t).Lookup(context.Background(), Query{ISBN: "0306406152"})
	if err != nil || len(ms) != 1 || !ms[0].ByIdentifier {
		t.Fatalf("matches %v, err %v", ms, err)
	}
	want := map[string]string{
		FieldTitle: `"Sparse"`, FieldSeriesName: `"Omnibus"`, FieldPublished: `"1962-01-01"`,
		FieldISBN: `"0306406152"`, FieldGoodreadsID: `"7"`,
	}
	if got := goodreadsFields(t, ms[0]); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("fields\n got %v\nwant %v", got, want)
	}
}

func TestGoodreadsRecordWithAnotherISBNIsNotAnIdentifierMatch(t *testing.T) {
	f := &fakeGoodreads{
		isbn:  map[string]string{"9780306406157": "/book/show/9-other"},
		books: map[int]string{9: goodreadsFixture("Other", "9781111111111")},
	}
	ms, err := f.start(t).Lookup(context.Background(), Query{ISBN: "9780306406157"})
	if err != nil || len(ms) != 1 || ms[0].ByIdentifier {
		t.Fatalf("matches %+v, err %v", ms, err)
	}
}

func goodreadsSuggestion(id, title, author string) string {
	return fmt.Sprintf(`{"bookId":%q,"title":"%s (Saga, #1)","bookTitleBare":%q,"author":{"name":%q}}`, id, title, title, author)
}

func TestGoodreadsUnknownISBNFallsBackToARankedTitleSearch(t *testing.T) {
	f := &fakeGoodreads{
		autocomplete: "[" + strings.Join([]string{
			goodreadsSuggestion("1", "Dune Study Guide", "Study Press"),
			goodreadsSuggestion("2", "Dune Messiah", "Frank Herbert"),
			goodreadsSuggestion("3", "Dune", "Frank  Herbert"),
			goodreadsSuggestion("not-a-number", "Dune", "Frank Herbert"),
			goodreadsSuggestion("4", "Dune", "Someone Else"),
			goodreadsSuggestion("3", "Dune", "Frank Herbert"),
		}, ",") + "]",
		// Book 2 has gone since the suggestion was made, which must not fail the search.
		books: map[int]string{1: goodreadsFixture("Dune Study Guide", ""), 3: goodreadsFixture("Dune", "")},
	}
	ms, err := f.start(t).Lookup(context.Background(), Query{ISBN: "9780306406157", Title: "Dune", Authors: []string{"Frank Herbert"}})
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, m := range ms {
		ids = append(ids, m.ID)
		if m.ByIdentifier {
			t.Errorf("search hit %s claims an identifier match", m.ID)
		}
	}
	if !slices.Equal(ids, []string{"3", "1"}) { // the agreeing book first, then the website's order
		t.Fatalf("ids %v", ids)
	}
	want := []string{
		"HEAD /book/isbn/9780306406157", "GET /book/auto_complete?format=json&q=Dune", // the author is never sent
		"POST /graphql id=3", "POST /graphql id=1", "POST /graphql id=2",
	}
	if !slices.Equal(f.seen, want) {
		t.Fatalf("requests %v", f.seen)
	}
}

func TestGoodreadsFailuresAreNotEmptyResults(t *testing.T) {
	suggestions := "[" + goodreadsSuggestion("3", "Dune", "Frank Herbert") + "]"
	for name, f := range map[string]*fakeGoodreads{
		"rejected key":        {autocomplete: suggestions, graphqlError: `{"errors":[{"errorType":"UnauthorizedException","message":"secret detail"}]}`},
		"changed schema":      {autocomplete: suggestions, graphqlError: `{"errors":[{"errorType":"ValidationError"}]}`},
		"empty reply":         {autocomplete: suggestions, graphqlError: `{}`},
		"challenge page":      {autocomplete: `<html>checking your browser</html>`},
		"sign-in on the ISBN": {isbn: map[string]string{"9780306406157": "/user/sign_in"}},
	} {
		t.Run(name, func(t *testing.T) {
			q := Query{Title: "Dune"}
			if f.isbn != nil {
				q.ISBN = "9780306406157"
			}
			ms, err := f.start(t).Lookup(context.Background(), q)
			if err == nil || len(ms) != 0 {
				t.Fatalf("matches %v, err %v", ms, err)
			}
			if strings.Contains(err.Error(), "secret detail") || strings.Contains(err.Error(), "test-key") {
				t.Fatalf("error repeats the reply or the key: %v", err)
			}
		})
	}
}

func TestGoodreadsCoversSkipPlaceholders(t *testing.T) {
	f := &fakeGoodreads{
		autocomplete: "[" + goodreadsSuggestion("1", "Dune", "Ada Writer") + "," + goodreadsSuggestion("2", "Dune", "Ada Writer") + "]",
		books: map[int]string{
			1: `{"title":"Dune","imageUrl":"https://s.example/assets/nophoto/book/111x148.png"}`,
			2: goodreadsFixture("Dune", "9780306406157"),
		},
	}
	hits, err := f.start(t).Covers(context.Background(), "Dune", "Ada Writer")
	want := []CoverHit{{Title: "Dune", Author: "Ada Writer", ImageURL: "https://images.example/9780306406157.jpg"}}
	if err != nil || !slices.Equal(hits, want) {
		t.Fatalf("hits %v, err %v", hits, err)
	}
}

func TestGoodreadsConfiguration(t *testing.T) {
	providers := NewProviders("", "")
	g, ok := providers[ProviderGoodreads].(Goodreads)
	if !ok || g.APIKey != goodreadsPublicKey || g.API.BaseURL != goodreadsEndpoint || g.Web.BaseURL != goodreadsSite {
		t.Fatalf("built-in configuration %+v", g)
	}
	if g.API.policy != g.Web.policy || g.Web.policy.cache != nil || g.Web.policy == providers[ProviderGoogleBooks].(GoogleBooks).policy {
		t.Fatal("the website and the endpoint must share one budget of their own, without a response cache")
	}
	ConfigureGoodreads(providers, " ", "")
	if g := providers[ProviderGoodreads].(Goodreads); g.APIKey != goodreadsPublicKey || g.API.BaseURL != goodreadsEndpoint {
		t.Fatalf("empty settings replaced the built-in ones: %+v", g)
	}
	ConfigureGoodreads(providers, "new-key", "https://new.example/graphql")
	if g := providers[ProviderGoodreads].(Goodreads); g.APIKey != "new-key" || g.API.BaseURL != "https://new.example/graphql" || g.Web.BaseURL != goodreadsSite {
		t.Fatalf("overrides not applied: %+v", g)
	}
}
