package metadata

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Author and series lookups (ADR-0102, ADR-0103, ADR-0106). They send only names, titles and identifiers, and every
// result is reviewed by a person before anything is saved.

// AuthorHit is one author a provider offers.
type AuthorHit struct {
	Provider  string
	ID        string
	Name      string
	Detail    string // a short line to tell people of the same name apart
	Biography string
	PhotoURL  string
	PageURL   string
}

// SeriesRef names a series one of the library's books belongs to.
type SeriesRef struct{ ID, Name string }

// SeriesInfo is a provider's series with its numbered main books.
type SeriesInfo struct {
	Provider    string
	ID          string
	Name        string
	PageURL     string
	Description string
	Authors     []string
	BookCount   int    // 0 when the provider does not say
	Status      string // "complete", "ongoing" or empty
	Members     []SeriesMember
}

// SeriesMember is one whole-numbered book of a series.
type SeriesMember struct {
	Position int
	Title    string
	Authors  []string
	Released string // YYYY or YYYY-MM-DD; empty when unknown
	CoverURL string
	PageURL  string
}

// PeopleProvider looks up authors and series. Implementations must be safe for concurrent use.
type PeopleProvider interface {
	Name() string
	FindAuthors(ctx context.Context, name string) ([]AuthorHit, error)
	Author(ctx context.Context, id string) (AuthorHit, error)
	// BookSeries returns the series of the book q describes: by its ISBN, or else only of a search result whose title
	// and author agree with q, never merely the first result (ADR-0060).
	BookSeries(ctx context.Context, q Query) ([]SeriesRef, error)
	Series(ctx context.Context, id string) (SeriesInfo, error)
}

const (
	maxAuthorHits    = 5
	maxSeriesMembers = 100
	maxBiography     = 8000
)

var titlePunct = regexp.MustCompile(`[^\p{L}\p{N}]+`)

// titleForms gives a title without punctuation and case, in full and, when it has a subtitle, without it.
func titleForms(title string) (full, head string) {
	key := func(s string) string { return titlePunct.ReplaceAllString(strings.ToLower(s), "") }
	full = key(title)
	if before, _, found := strings.Cut(title, ":"); found {
		head = key(before)
	}
	return full, head
}

// SameTitle reports whether two titles name the same book. One may leave out the other's subtitle. Two titles that
// share only the part before the colon, as books of a franchise do, are different.
func SameTitle(a, b string) bool {
	fullA, headA := titleForms(a)
	fullB, headB := titleForms(b)
	return fullA != "" && fullB != "" && (fullA == fullB || fullA == headB || headA == fullB)
}

// SharesAuthor reports whether the lists name a common author, ignoring case and punctuation.
func SharesAuthor(a, b []string) bool {
	for _, x := range a {
		for _, y := range b {
			if k := titlePunct.ReplaceAllString(strings.ToLower(x), ""); k != "" && k == titlePunct.ReplaceAllString(strings.ToLower(y), "") {
				return true
			}
		}
	}
	return false
}

func agrees(q Query, title string, authors []string) bool {
	return SameTitle(q.Title, title) && (len(q.Authors) == 0 || SharesAuthor(q.Authors, authors))
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// mainBooks keeps whole-numbered books from 1 up, one per number (the first listed wins), in order (ADR-0104).
func mainBooks(in []SeriesMember) []SeriesMember {
	seen := map[int]bool{}
	out := []SeriesMember{}
	for _, m := range in {
		if m.Position < 1 || m.Position > 10000 || seen[m.Position] || strings.TrimSpace(m.Title) == "" {
			continue
		}
		seen[m.Position] = true
		m.Title = clip(m.Title, 512)
		m.Authors = cleanList(m.Authors, 5)
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	if len(out) > maxSeriesMembers {
		out = out[:maxSeriesMembers]
	}
	return out
}

// wholeNumber returns n when it is a whole number.
func wholeNumber(n float64) (int, bool) {
	if n < 0 || n > 1e6 || n != float64(int(n)) {
		return 0, false
	}
	return int(n), true
}

// ---- Hardcover ---------------------------------------------------------

const hardcoverSite = "https://hardcover.app"

var slugRE = regexp.MustCompile(`^[A-Za-z0-9._~-]{1,200}$`)

func hardcoverPage(kind, slug string) string {
	if !slugRE.MatchString(slug) {
		return hardcoverSite
	}
	return hardcoverSite + "/" + kind + "/" + slug
}

// cachedImageURL reads the address out of a Hardcover cached_image value, which is {} when there is no image.
func cachedImageURL(raw json.RawMessage) string {
	var img struct {
		URL string `json:"url"`
	}
	if json.Unmarshal(raw, &img) != nil || !strings.HasPrefix(img.URL, "https://") {
		return ""
	}
	return img.URL
}

type hardcoverHit struct {
	ID          json.Number `json:"id"`
	Title       string      `json:"title"`
	AuthorNames []string    `json:"author_names"`
}

func (h Hardcover) search(ctx context.Context, kind, text string, size int) ([]hardcoverHit, error) {
	var data struct {
		Search struct {
			Results struct {
				Hits []struct {
					Document hardcoverHit `json:"document"`
				} `json:"hits"`
			} `json:"results"`
		} `json:"search"`
	}
	const query = `query($q: String!, $kind: String!, $size: Int!) {
  search(query: $q, query_type: $kind, per_page: $size, page: 1) { results }
}`
	if err := h.query(ctx, query, map[string]any{"q": text, "kind": kind, "size": size}, &data); err != nil {
		return nil, err
	}
	out := []hardcoverHit{}
	for _, x := range data.Search.Results.Hits {
		out = append(out, x.Document)
	}
	return out, nil
}

type hardcoverAuthor struct {
	ID          int             `json:"id"`
	Name        string          `json:"name"`
	Slug        string          `json:"slug"`
	Bio         string          `json:"bio"`
	BooksCount  int             `json:"books_count"`
	CachedImage json.RawMessage `json:"cached_image"`
}

// authors reads canonical records only: Hardcover keeps merged duplicates that point at their canonical record.
func (h Hardcover) authors(ctx context.Context, ids []int) ([]AuthorHit, error) {
	var data struct {
		Authors []hardcoverAuthor `json:"authors"`
	}
	const query = `query($ids: [Int!]!) {
  authors(where: {id: {_in: $ids}, canonical_id: {_is_null: true}}, limit: 5) { id name slug bio books_count cached_image }
}`
	if err := h.query(ctx, query, map[string]any{"ids": ids}, &data); err != nil {
		return nil, err
	}
	byID := map[int]hardcoverAuthor{}
	for _, a := range data.Authors {
		byID[a.ID] = a
	}
	out := []AuthorHit{}
	for _, id := range ids { // keep the search's order
		a, ok := byID[id]
		if !ok {
			continue
		}
		detail := strconv.Itoa(a.BooksCount) + " works listed"
		if a.BooksCount == 1 {
			detail = "1 work listed"
		}
		out = append(out, AuthorHit{Provider: ProviderHardcover, ID: strconv.Itoa(a.ID), Name: clip(a.Name, 512), Detail: detail,
			Biography: clip(a.Bio, maxBiography), PhotoURL: cachedImageURL(a.CachedImage), PageURL: hardcoverPage("authors", a.Slug)})
	}
	return out, nil
}

func hitIDs(hits []hardcoverHit) []int {
	ids := []int{}
	for _, x := range hits {
		if n, err := strconv.Atoi(x.ID.String()); err == nil && n > 0 {
			ids = append(ids, n)
		}
	}
	return ids
}

func (h Hardcover) FindAuthors(ctx context.Context, name string) ([]AuthorHit, error) {
	hits, err := h.search(ctx, "Author", name, maxAuthorHits)
	if err != nil {
		return nil, err
	}
	ids := hitIDs(hits)
	if len(ids) == 0 {
		return []AuthorHit{}, nil
	}
	found, err := h.authors(ctx, ids)
	if err != nil {
		return nil, err
	}
	// The search also returns people who merely wrote about the name. When some have this very name, only they are
	// offered; otherwise all are, because the library may spell the name differently.
	exact := []AuthorHit{}
	for _, a := range found {
		if SharesAuthor([]string{name}, []string{a.Name}) {
			exact = append(exact, a)
		}
	}
	if len(exact) > 0 {
		return exact, nil
	}
	return found, nil
}

func (h Hardcover) Author(ctx context.Context, id string) (AuthorHit, error) {
	n, err := strconv.Atoi(id)
	if err != nil || n < 1 {
		return AuthorHit{}, ErrNoSuchRecord
	}
	found, err := h.authors(ctx, []int{n})
	if err != nil {
		return AuthorHit{}, err
	}
	if len(found) == 0 {
		return AuthorHit{}, ErrNoSuchRecord
	}
	return found[0], nil
}

type hardcoverBookSeries struct {
	Series *struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	} `json:"series"`
}

func seriesRefs(in []hardcoverBookSeries) []SeriesRef {
	out := []SeriesRef{}
	for _, s := range in {
		if s.Series != nil && s.Series.ID > 0 && strings.TrimSpace(s.Series.Name) != "" {
			out = append(out, SeriesRef{ID: strconv.Itoa(s.Series.ID), Name: clip(s.Series.Name, 512)})
		}
	}
	return out
}

func (h Hardcover) BookSeries(ctx context.Context, q Query) ([]SeriesRef, error) {
	if q.ISBN != "" {
		var data struct {
			Editions []struct {
				Book *struct {
					BookSeries []hardcoverBookSeries `json:"book_series"`
				} `json:"book"`
			} `json:"editions"`
		}
		const query = `query($isbn: String!) {
  editions(where: {_or: [{isbn_13: {_eq: $isbn}}, {isbn_10: {_eq: $isbn}}]}, limit: 5) {
    book { book_series { series { id name } } }
  }
}`
		if err := h.query(ctx, query, map[string]any{"isbn": q.ISBN}, &data); err != nil {
			return nil, err
		}
		out := []SeriesRef{}
		for _, e := range data.Editions {
			if e.Book != nil {
				out = append(out, seriesRefs(e.Book.BookSeries)...)
			}
		}
		if len(out) > 0 {
			return out, nil
		}
	}
	if q.Title == "" {
		return nil, nil
	}
	// The title alone first; the author is checked on each hit. A common title can push the book out of the results,
	// so the author is added to the search only when the title alone finds no agreeing hit.
	texts := []string{q.Title}
	if len(q.Authors) > 0 {
		texts = append(texts, q.Title+" "+q.Authors[0])
	}
	matching := []hardcoverHit{}
	for _, text := range texts {
		hits, err := h.search(ctx, "book", text, 10)
		if err != nil {
			return nil, err
		}
		for _, x := range hits {
			if agrees(q, x.Title, x.AuthorNames) {
				matching = append(matching, x)
			}
		}
		if len(matching) > 0 {
			break
		}
	}
	if len(matching) > maxAuthorHits {
		matching = matching[:maxAuthorHits]
	}
	ids := hitIDs(matching)
	if len(ids) == 0 {
		return nil, nil
	}
	var data struct {
		Books []struct {
			BookSeries []hardcoverBookSeries `json:"book_series"`
		} `json:"books"`
	}
	const query = `query($ids: [Int!]!) {
  books(where: {id: {_in: $ids}}, limit: 5) { book_series { series { id name } } }
}`
	if err := h.query(ctx, query, map[string]any{"ids": ids}, &data); err != nil {
		return nil, err
	}
	out := []SeriesRef{}
	for _, b := range data.Books {
		out = append(out, seriesRefs(b.BookSeries)...)
	}
	return out, nil
}

// hardcoverSeriesQuery leaves out compilations, partial books and merged duplicates, as Hardcover's own guide does,
// and lists the most popular book of a number first.
const hardcoverSeriesQuery = `query($id: Int!) {
  series(where: {id: {_eq: $id}}, limit: 1) {
    id name slug description primary_books_count is_completed author { name }
    book_series(
      where: {compilation: {_eq: false}, book: {canonical_id: {_is_null: true}, is_partial_book: {_eq: false}}}
      order_by: [{position: asc}, {book: {users_count: desc}}]
      limit: 300
    ) {
      position
      book { title slug release_date release_year cached_image contributions { author { name } } }
    }
  }
}`

func (h Hardcover) Series(ctx context.Context, id string) (SeriesInfo, error) {
	n, err := strconv.Atoi(id)
	if err != nil || n < 1 {
		return SeriesInfo{}, ErrNoSuchRecord
	}
	var data struct {
		Series []struct {
			ID                int                    `json:"id"`
			Name              string                 `json:"name"`
			Slug              string                 `json:"slug"`
			Description       string                 `json:"description"`
			PrimaryBooksCount *int                   `json:"primary_books_count"`
			IsCompleted       *bool                  `json:"is_completed"`
			Author            *struct{ Name string } `json:"author"`
			BookSeries        []struct {
				Position *float64 `json:"position"`
				Book     *struct {
					Title         string          `json:"title"`
					Slug          string          `json:"slug"`
					ReleaseDate   string          `json:"release_date"`
					ReleaseYear   int             `json:"release_year"`
					CachedImage   json.RawMessage `json:"cached_image"`
					Contributions []struct {
						Author *struct{ Name string } `json:"author"`
					} `json:"contributions"`
				} `json:"book"`
			} `json:"book_series"`
		} `json:"series"`
	}
	if err := h.query(ctx, hardcoverSeriesQuery, map[string]any{"id": n}, &data); err != nil {
		return SeriesInfo{}, err
	}
	if len(data.Series) == 0 {
		return SeriesInfo{}, ErrNoSuchRecord
	}
	s := data.Series[0]
	out := SeriesInfo{Provider: ProviderHardcover, ID: strconv.Itoa(s.ID), Name: clip(s.Name, 512), PageURL: hardcoverPage("series", s.Slug),
		Description: clip(s.Description, MaxDescription), Authors: []string{}}
	if s.Author != nil && strings.TrimSpace(s.Author.Name) != "" {
		out.Authors = []string{clip(s.Author.Name, 200)}
	}
	if s.PrimaryBooksCount != nil && *s.PrimaryBooksCount >= 1 && *s.PrimaryBooksCount <= 10000 {
		out.BookCount = *s.PrimaryBooksCount
	}
	if s.IsCompleted != nil {
		out.Status = "ongoing"
		if *s.IsCompleted {
			out.Status = "complete"
		}
	}
	members := []SeriesMember{}
	for _, e := range s.BookSeries {
		if e.Position == nil || e.Book == nil {
			continue
		}
		position, whole := wholeNumber(*e.Position)
		if !whole {
			continue
		}
		m := SeriesMember{Position: position, Title: e.Book.Title, CoverURL: cachedImageURL(e.Book.CachedImage), PageURL: hardcoverPage("books", e.Book.Slug)}
		switch {
		case publishedRe.MatchString(e.Book.ReleaseDate):
			m.Released = e.Book.ReleaseDate
		case e.Book.ReleaseYear > 0:
			m.Released = strconv.Itoa(e.Book.ReleaseYear)
		}
		for _, c := range e.Book.Contributions {
			if c.Author != nil {
				m.Authors = append(m.Authors, c.Author.Name)
			}
		}
		members = append(members, m)
	}
	out.Members = mainBooks(members)
	return out, nil
}

// ---- Open Library ------------------------------------------------------

const openLibrarySite = "https://openlibrary.org"

var (
	olAuthorKey = regexp.MustCompile(`^OL\d{1,12}A$`)
	olSeriesKey = regexp.MustCompile(`^OL\d{1,12}L$`)
	olWorkKey   = regexp.MustCompile(`^/works/OL\d{1,12}W$`)
)

// olText reads a value Open Library gives either as a string or as {"type": ..., "value": ...}.
func olText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var obj struct {
		Value string `json:"value"`
	}
	_ = json.Unmarshal(raw, &obj)
	return obj.Value
}

var (
	olFootnote  = regexp.MustCompile(`(?m)^[ \t]*\[[^\]\n]{1,40}\]:[ \t]*\S+[ \t]*\r?$\n?`)
	olReference = regexp.MustCompile(`\[([^\]\n]{1,300})\](?:\[[^\]\n]{0,40}\]|\(https?://[^)\s]{1,1000}\))`)
)

// olPlainText turns the Markdown links Open Library biographies use into their words, and drops the link footnotes.
func olPlainText(s string) string {
	return strings.TrimSpace(olReference.ReplaceAllString(olFootnote.ReplaceAllString(s, ""), "$1"))
}

func (p OpenLibrary) FindAuthors(ctx context.Context, name string) ([]AuthorHit, error) {
	var res struct {
		Docs []struct {
			Key       string `json:"key"`
			Name      string `json:"name"`
			TopWork   string `json:"top_work"`
			WorkCount int    `json:"work_count"`
		} `json:"docs"`
	}
	if _, err := p.get(ctx, "/search/authors.json", url.Values{"q": {name}, "limit": {strconv.Itoa(maxAuthorHits)}}, &res); err != nil {
		return nil, err
	}
	out := []AuthorHit{}
	for _, d := range res.Docs {
		// Only people of this very name: the search also returns others with similar ones. Three records at most are
		// read, because each is one more request.
		if len(out) == 3 || !SharesAuthor([]string{name}, []string{d.Name}) {
			continue
		}
		hit, err := p.Author(ctx, strings.TrimPrefix(d.Key, "/authors/"))
		if err != nil {
			if len(out) > 0 {
				break
			}
			return nil, err
		}
		detail := strconv.Itoa(d.WorkCount) + " works listed"
		if d.TopWork != "" {
			detail += ", including " + d.TopWork
		}
		hit.Detail = clip(detail, 300)
		out = append(out, hit)
	}
	return out, nil
}

func (p OpenLibrary) Author(ctx context.Context, id string) (AuthorHit, error) {
	if !olAuthorKey.MatchString(id) {
		return AuthorHit{}, ErrNoSuchRecord
	}
	var res struct {
		Name   string          `json:"name"`
		Bio    json.RawMessage `json:"bio"`
		Photos []int           `json:"photos"`
	}
	code, err := p.get(ctx, "/authors/"+id+".json", nil, &res)
	if err != nil {
		return AuthorHit{}, err
	}
	if code == http.StatusNotFound || res.Name == "" {
		return AuthorHit{}, ErrNoSuchRecord
	}
	hit := AuthorHit{Provider: ProviderOpenLibrary, ID: id, Name: clip(res.Name, 512), Biography: clip(olPlainText(olText(res.Bio)), maxBiography),
		PageURL: openLibrarySite + "/authors/" + id}
	for _, photo := range res.Photos {
		if photo > 0 { // -1 marks a removed photo
			hit.PhotoURL = "https://covers.openlibrary.org/a/id/" + strconv.Itoa(photo) + "-L.jpg"
			break
		}
	}
	return hit, nil
}

type olSeriesDoc struct {
	Key            string   `json:"key"`
	Title          string   `json:"title"`
	AuthorName     []string `json:"author_name"`
	SeriesKey      []string `json:"series_key"`
	SeriesName     []string `json:"series_name"`
	SeriesPosition []string `json:"series_position"`
	CoverI         int      `json:"cover_i"`
	FirstPublished int      `json:"first_publish_year"`
}

const olSeriesFields = "key,title,author_name,series_key,series_name,series_position,cover_i,first_publish_year"

func (p OpenLibrary) docs(ctx context.Context, params url.Values) ([]olSeriesDoc, error) {
	params.Set("fields", olSeriesFields)
	var res struct {
		Docs []olSeriesDoc `json:"docs"`
	}
	if _, err := p.get(ctx, "/search.json", params, &res); err != nil {
		return nil, err
	}
	return res.Docs, nil
}

func olRefs(docs []olSeriesDoc) []SeriesRef {
	out := []SeriesRef{}
	for _, d := range docs {
		for i, key := range d.SeriesKey {
			if olSeriesKey.MatchString(key) && i < len(d.SeriesName) && strings.TrimSpace(d.SeriesName[i]) != "" {
				out = append(out, SeriesRef{ID: key, Name: clip(d.SeriesName[i], 512)})
			}
		}
	}
	return out
}

func (p OpenLibrary) BookSeries(ctx context.Context, q Query) ([]SeriesRef, error) {
	if q.ISBN != "" {
		docs, err := p.docs(ctx, url.Values{"isbn": {q.ISBN}, "limit": {"3"}})
		if err != nil {
			return nil, err
		}
		if refs := olRefs(docs); len(refs) > 0 {
			return refs, nil
		}
	}
	if q.Title == "" {
		return nil, nil
	}
	params := url.Values{"title": {q.Title}, "limit": {"5"}}
	if len(q.Authors) > 0 {
		params.Set("author", q.Authors[0])
	}
	docs, err := p.docs(ctx, params)
	if err != nil {
		return nil, err
	}
	matching := []olSeriesDoc{}
	for _, d := range docs {
		if agrees(q, d.Title, d.AuthorName) {
			matching = append(matching, d)
		}
	}
	return olRefs(matching), nil
}

func (p OpenLibrary) Series(ctx context.Context, id string) (SeriesInfo, error) {
	if !olSeriesKey.MatchString(id) {
		return SeriesInfo{}, ErrNoSuchRecord
	}
	var record struct {
		Name        string          `json:"name"`
		Description json.RawMessage `json:"description"`
	}
	code, err := p.get(ctx, "/series/"+id+".json", nil, &record)
	if err != nil {
		return SeriesInfo{}, err
	}
	if code == http.StatusNotFound || record.Name == "" {
		return SeriesInfo{}, ErrNoSuchRecord
	}
	docs, err := p.docs(ctx, url.Values{"q": {"series_key:" + id}, "limit": {"200"}, "sort": {"editions"}})
	if err != nil {
		return SeriesInfo{}, err
	}
	out := SeriesInfo{Provider: ProviderOpenLibrary, ID: id, Name: clip(record.Name, 512), PageURL: openLibrarySite + "/series/" + id,
		Description: clip(olText(record.Description), MaxDescription), Authors: []string{}}
	members := []SeriesMember{}
	for _, d := range docs {
		for i, key := range d.SeriesKey {
			if key != id || i >= len(d.SeriesPosition) {
				continue
			}
			n, err := strconv.ParseFloat(strings.TrimSpace(d.SeriesPosition[i]), 64)
			if err != nil {
				continue
			}
			position, whole := wholeNumber(n)
			if !whole {
				continue
			}
			m := SeriesMember{Position: position, Title: d.Title, Authors: d.AuthorName}
			if d.FirstPublished > 0 {
				m.Released = strconv.Itoa(d.FirstPublished)
			}
			if d.CoverI > 0 {
				m.CoverURL = "https://covers.openlibrary.org/b/id/" + strconv.Itoa(d.CoverI) + "-L.jpg"
			}
			if olWorkKey.MatchString(d.Key) {
				m.PageURL = openLibrarySite + d.Key
			}
			members = append(members, m)
		}
	}
	out.Members = mainBooks(members)
	if len(out.Members) > 0 {
		out.Authors = out.Members[0].Authors
		if len(out.Authors) > 3 {
			out.Authors = out.Authors[:3]
		}
	}
	return out, nil
}
