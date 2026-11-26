package metadata_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

// These tests use a local server returning the documented Hardcover response shapes. They prove request
// construction and parsing only; no live Hardcover request was made.
func TestHardcoverLooksUpAnISBNAndSendsOnlyTheQueryAndToken(t *testing.T) {
	var gotAuth, gotType, gotPath string
	var gotBody struct {
		Query     string         `json:"query"`
		Variables map[string]any `json:"variables"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotType, gotPath = r.Header.Get("authorization"), r.Header.Get("Content-Type"), r.URL.Path
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &gotBody)
		_, _ = w.Write([]byte(`{"data":{"editions":[{"id":42,"title":"Off Armageddon Reef","isbn_13":"9780765316554","isbn_10":"0765316552","pages":605,"release_date":"2007-01-09",
"publisher":{"name":"Tor Books"},
"book":{"id":7,"slug":"off-armageddon-reef","title":"Off Armageddon Reef","description":"Humanity pushed its way to the stars.",
"contributions":[{"author":{"name":"David Weber"}}],"book_series":[{"position":1,"series":{"name":"Safehold"}}]}}]}}`))
	}))
	defer srv.Close()
	p := metadata.Hardcover{HTTP: metadata.HTTP{BaseURL: srv.URL}, Token: "secret-token"}
	ms, err := p.Lookup(context.Background(), metadata.Query{Title: "ignored", Authors: []string{"ignored"}, ISBN: "9780765316554"})
	if err != nil || len(ms) != 1 || !ms[0].ByIdentifier || ms[0].ID != "edition:42" {
		t.Fatalf("%+v %v", ms, err)
	}
	if gotPath != "/v1/graphql" || gotAuth != "Bearer secret-token" || gotType != "application/json" {
		t.Fatalf("request: path=%q auth=%q type=%q", gotPath, gotAuth, gotType)
	}
	if len(gotBody.Variables) != 1 || gotBody.Variables["isbn"] != "9780765316554" {
		t.Fatalf("only the ISBN is sent: %+v", gotBody.Variables)
	}
	want := map[string]string{"title": `"Off Armageddon Reef"`, "authors": `["David Weber"]`, "publisher": `"Tor Books"`, "published": `"2007-01-09"`, "page_count": `605`,
		"isbn": `"9780765316554"`, "series_name": `"Safehold"`, "series_index": `1`, "description": `"Humanity pushed its way to the stars."`}
	for k, v := range want {
		if string(ms[0].Fields[k]) != v {
			t.Errorf("%s = %s, want %s", k, ms[0].Fields[k], v)
		}
	}
	// A token the operator pasted with its prefix is not prefixed twice.
	p.Token = "Bearer already"
	_, _ = p.Lookup(context.Background(), metadata.Query{ISBN: "9780765316554"})
	if gotAuth != "Bearer already" {
		t.Fatalf("auth: %q", gotAuth)
	}
}

func TestHardcoverTextSearchIsNeverAnIdentifierMatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"search":{"results":{"hits":[
{"document":{"id":"7","title":"Off Armageddon Reef","description":"Story.","author_names":["David Weber"],"series_names":["Safehold"],"featured_series_position":1}},
{"document":{"id":"8","title":"Two Series","series_names":["A","B"],"featured_series_position":2}}]}}}}`))
	}))
	defer srv.Close()
	ms, err := metadata.Hardcover{HTTP: metadata.HTTP{BaseURL: srv.URL}, Token: "t"}.Lookup(context.Background(), metadata.Query{Title: "Off Armageddon Reef", Authors: []string{"David Weber"}})
	if err != nil || len(ms) != 2 || ms[0].ByIdentifier || ms[1].ByIdentifier || ms[0].ID != "book:7" {
		t.Fatalf("%+v %v", ms, err)
	}
	if string(ms[0].Fields["series_name"]) != `"Safehold"` || string(ms[0].Fields["series_index"]) != `1` {
		t.Fatalf("series: %+v", ms[0].Fields)
	}
	if _, has := ms[1].Fields["series_name"]; has {
		t.Fatalf("a book in several series is ambiguous: %+v", ms[1].Fields)
	}
}

// newline separates the documents of one synthetic reply.
const newline = string(rune(10))

// hardcoverSearches answers each search text with the given documents (a text without an entry finds nothing; the
// reply "fail" is a server error) and records the texts in order. All replies are synthetic.
func hardcoverSearches(t *testing.T, replies map[string]string) (metadata.Hardcover, *[]string) {
	t.Helper()
	var sent []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		text, _ := body.Variables["q"].(string)
		if len(body.Variables) != 1 || !contains(body.Query, "per_page: 10") {
			t.Errorf("only the search text is sent, for ten results: %+v %s", body.Variables, body.Query)
		}
		sent = append(sent, text)
		if replies[text] == "fail" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var hits []string
		if replies[text] != "" {
			for _, doc := range strings.Split(replies[text], newline) {
				hits = append(hits, `{"document":`+doc+`}`)
			}
		}
		_, _ = w.Write([]byte(`{"data":{"search":{"results":{"hits":[` + strings.Join(hits, ",") + `]}}}}`))
	}))
	t.Cleanup(srv.Close)
	return metadata.Hardcover{HTTP: metadata.HTTP{BaseURL: srv.URL}, Token: "t"}, &sent
}

func hardcoverDoc(id, title string, authors ...string) string {
	b, _ := json.Marshal(map[string]any{"id": id, "title": title, "author_names": authors})
	return string(b)
}

func TestHardcoverSearchOrderAndFiltering(t *testing.T) {
	dune := metadata.Query{Title: "Dune", Authors: []string{"Frank Herbert"}, ASIN: "B000TEST01"}
	sequel := hardcoverDoc("2", "Dune Messiah", "Frank Herbert")
	guide := hardcoverDoc("3", "Dune", "Study Guide Press")
	franchise := hardcoverDoc("4", "Dune: House Atreides", "Brian Herbert")
	graphic := hardcoverDoc("5", "Dune: The Graphic Novel", "Frank Herbert")
	book := hardcoverDoc("1", "DUNE", "frank herbert")
	lines := func(docs ...string) string { return strings.Join(docs, newline) }
	many := []string{sequel, guide, franchise}
	for _, id := range []string{"11", "12", "13", "14", "15", "16"} {
		many = append(many, hardcoverDoc(id, "Companion "+id, "Someone Else"))
	}
	for _, c := range []struct {
		name    string
		query   metadata.Query
		replies map[string]string
		sent    []string
		ids     []string
	}{
		{"the title alone finds the book, which moves ahead of the others", dune,
			map[string]string{"Dune": lines(sequel, guide, graphic, book)},
			[]string{"Dune"}, []string{"1", "5", "2", "3"}},
		{"a book beyond the fifth result is kept, and five are offered", dune,
			map[string]string{"Dune": lines(append(many, book)...)},
			[]string{"Dune"}, []string{"1", "2", "3", "4", "11"}},
		{"the author is added when the title alone has no agreeing hit", dune,
			map[string]string{"Dune": lines(guide, franchise), "Dune Frank Herbert": lines(sequel, book, guide)},
			[]string{"Dune", "Dune Frank Herbert"}, []string{"1", "2", "3", "4"}},
		{"when nothing agrees the title-and-author results lead and repeats are dropped", dune,
			map[string]string{"Dune": lines(guide, franchise), "Dune Frank Herbert": lines(sequel, guide)},
			[]string{"Dune", "Dune Frank Herbert"}, []string{"2", "3", "4"}},
		{"title results remain when the second search finds nothing", dune,
			map[string]string{"Dune": guide},
			[]string{"Dune", "Dune Frank Herbert"}, []string{"3"}},
		{"neither search finds anything", dune, nil, []string{"Dune", "Dune Frank Herbert"}, nil},
		{"without an author there is one search", metadata.Query{Title: "Dune"},
			map[string]string{"Dune": lines(sequel, guide)},
			[]string{"Dune"}, []string{"3", "2"}},
		{"one side may leave out the subtitle", metadata.Query{Title: "Emma: A Novel", Authors: []string{"Jane Austen"}},
			map[string]string{"Emma: A Novel": lines(hardcoverDoc("8", "Emma: Annotated Study", "Jane Austen"), hardcoverDoc("9", "Emma", "Jane Austen"))},
			[]string{"Emma: A Novel"}, []string{"9", "8"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			p, sent := hardcoverSearches(t, c.replies)
			ms, err := p.Lookup(context.Background(), c.query)
			if err != nil {
				t.Fatal(err)
			}
			var ids []string
			for _, m := range ms {
				if m.ByIdentifier {
					t.Errorf("a search hit is never an identifier match: %+v", m)
				}
				ids = append(ids, strings.TrimPrefix(m.ID, "book:"))
			}
			if !slices.Equal(*sent, c.sent) || !slices.Equal(ids, c.ids) {
				t.Fatalf("sent %q want %q; ids %q want %q", *sent, c.sent, ids, c.ids)
			}
		})
	}
}

func TestHardcoverFailedSecondSearchFailsTheLookup(t *testing.T) {
	p, sent := hardcoverSearches(t, map[string]string{"Dune": hardcoverDoc("3", "Dune", "Study Guide Press"), "Dune Frank Herbert": "fail"})
	ms, err := p.Lookup(context.Background(), metadata.Query{Title: "Dune", Authors: []string{"Frank Herbert"}})
	if err == nil || ms != nil || len(*sent) != 2 {
		t.Fatalf("an incomplete search must not be returned (it would be cached): %+v %v %q", ms, err, *sent)
	}
}

func TestHardcoverErrorsAreFailuresAndNeverEchoTheResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"errors":[{"message":"authorization secret-token rejected"}]}`))
	}))
	defer srv.Close()
	_, err := metadata.Hardcover{HTTP: metadata.HTTP{BaseURL: srv.URL}, Token: "secret-token"}.Lookup(context.Background(), metadata.Query{ISBN: "9780765316554"})
	if err == nil {
		t.Fatal("a GraphQL error must be a failure")
	}
	if got := err.Error(); len(got) > 60 || contains(got, "secret-token") {
		t.Fatalf("the error must not carry the response: %q", got)
	}
	if ms, err := (metadata.Hardcover{Token: "t"}).Lookup(context.Background(), metadata.Query{}); ms != nil || err != nil {
		t.Fatalf("an empty query makes no request: %v %v", ms, err)
	}
}

func TestNewProvidersRegistersHardcoverOnlyWithAToken(t *testing.T) {
	if _, has := metadata.NewProvidersWithHardcover("", "", "")[metadata.ProviderHardcover]; has {
		t.Fatal("no token: Hardcover must not be registered")
	}
	if _, has := metadata.NewProvidersWithHardcover("", "", "  ")[metadata.ProviderHardcover]; has {
		t.Fatal("a blank token is no token")
	}
	if _, has := metadata.NewProvidersWithHardcover("", "", "tok")[metadata.ProviderHardcover]; !has {
		t.Fatal("a token registers Hardcover")
	}
	if _, has := metadata.NewProviders("", "")[metadata.ProviderHardcover]; has {
		t.Fatal("the original constructor never registers it")
	}
}

func TestProviderPostRetryResendsTheBodyAfterARateLimit(t *testing.T) {
	var calls atomic.Int32
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = w.Write([]byte(`{"data":{"editions":[]}}`))
	}))
	defer srv.Close()
	hc := metadata.NewProvidersWithHardcover("", "", "tok")[metadata.ProviderHardcover].(metadata.Hardcover)
	hc.BaseURL = srv.URL
	if _, err := hc.Lookup(context.Background(), metadata.Query{ISBN: "9780765316554"}); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || len(bodies) != 2 || bodies[0] == "" || bodies[0] != bodies[1] {
		t.Fatalf("a retried POST must carry the same body: calls=%d %q", calls.Load(), bodies)
	}
}
