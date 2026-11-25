package metadata

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Provider names (ADR-0049). Lookups send only title, author and identifier
// text, never book files, and run only for libraries that list the provider.
const (
	ProviderOpenLibrary = "open_library"
	ProviderGoogleBooks = "google_books"
	ProviderAudnexus    = "audnexus"
)

// Query is the only data sent to a provider.
type Query struct {
	Title   string
	Authors []string
	ISBN    string
	ASIN    string
}

// Match is one provider candidate. ByIdentifier is true only when the provider
// resolved an exact identifier; search hits are never ByIdentifier.
type Match struct {
	Provider     string `json:"provider"`
	ID           string `json:"id,omitempty"`
	ByIdentifier bool   `json:"byIdentifier"`
	Fields       Fields `json:"fields"`
}

// Provider looks up metadata. Implementations must be safe for concurrent use.
type Provider interface {
	Name() string
	Lookup(ctx context.Context, q Query) ([]Match, error)
}

var (
	isbnRE = regexp.MustCompile(`^(\d{9}[\dXx]|\d{13})$`)
	asinRE = regexp.MustCompile(`^[A-Z0-9]{10}$`)
)

// SplitIdentifier classifies a tag value as ISBN or ASIN.
func SplitIdentifier(id string) (isbn, asin string) {
	id = strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(id)))
	switch {
	case isbnRE.MatchString(id):
		return id, ""
	case asinRE.MatchString(id):
		return "", id
	}
	return "", ""
}

const maxResponse = 1 << 20

// HTTP is a shared, bounded client for the provider adapters.
type HTTP struct {
	Client    *http.Client
	BaseURL   string
	userAgent string
	policy    *providerPolicy
}

func (h HTTP) get(ctx context.Context, path string, params url.Values, out any) (int, error) {
	u := strings.TrimRight(h.BaseURL, "/") + path
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	return h.do(ctx, http.MethodGet, u, nil, nil, out)
}

// post sends a JSON body (used by GraphQL providers). Responses are never cached.
func (h HTTP) post(ctx context.Context, path string, payload []byte, header map[string]string, out any) (int, error) {
	return h.do(ctx, http.MethodPost, strings.TrimRight(h.BaseURL, "/")+path, payload, header, out)
}

// do runs one provider request under the shared per-provider budget: queueing, spacing, Retry-After and bounded retry.
func (h HTTP) do(ctx context.Context, method, u string, payload []byte, header map[string]string, out any) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	c := h.Client
	if c == nil {
		c = &http.Client{Timeout: providerLookupTimeout}
	}
	ctx, cancel := context.WithTimeout(ctx, providerLookupTimeout)
	defer cancel()
	p := h.policy
	cacheable := method == http.MethodGet
	if p != nil {
		if body := p.getCached(u); cacheable && body != nil {
			return http.StatusOK, json.Unmarshal(body, out)
		}
		if err := p.enter(ctx); err != nil {
			return 0, err
		}
		defer p.leave()
		if body := p.getCached(u); cacheable && body != nil {
			return http.StatusOK, json.Unmarshal(body, out)
		}
	}

	var body io.Reader
	if payload != nil {
		body = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, body)
	if err != nil {
		return 0, err
	}
	agent := h.userAgent
	if agent == "" {
		agent = "Litara (self-hosted metadata lookup)"
	}
	req.Header.Set("User-Agent", agent)
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	for attempt := 0; ; attempt++ {
		if p != nil {
			if err := p.wait(ctx); err != nil {
				if attempt == 0 {
					return 0, err
				}
				return http.StatusTooManyRequests, fmt.Errorf("provider returned status %d", http.StatusTooManyRequests)
			}
		}
		r := req.Clone(ctx)
		if payload != nil { // a retried request needs a fresh body
			r.Body = io.NopCloser(bytes.NewReader(payload))
		}
		resp, err := c.Do(r)
		if err != nil {
			return 0, fmt.Errorf("provider request failed")
		}
		if p == nil || resp.StatusCode != http.StatusTooManyRequests {
			return h.decodeResponse(u, resp, out)
		}
		now := time.Now()
		if until := now.Add(retryDelay(resp.Header.Get("Retry-After"), now)); until.After(p.next) {
			p.next = until
		}
		resp.Body.Close()
		if attempt == 1 {
			return resp.StatusCode, fmt.Errorf("provider returned status %d", resp.StatusCode)
		}
	}
}

func (h HTTP) decodeResponse(key string, resp *http.Response, out any) (int, error) {
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return resp.StatusCode, nil
	}
	if resp.StatusCode != http.StatusOK {
		return resp.StatusCode, fmt.Errorf("provider returned status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse+1))
	if err != nil || len(body) > maxResponse || json.Unmarshal(body, out) != nil {
		return resp.StatusCode, fmt.Errorf("provider response unreadable")
	}
	if h.policy != nil {
		h.policy.cacheResponse(key, body, resp.Header)
	}
	return resp.StatusCode, nil
}

// OpenLibrary uses the documented search API.
type OpenLibrary struct{ HTTP }

func (OpenLibrary) Name() string { return ProviderOpenLibrary }

func (p OpenLibrary) Lookup(ctx context.Context, q Query) ([]Match, error) {
	params := url.Values{"fields": {"key,title,author_name"}, "limit": {"5"}}
	byID := q.ISBN != ""
	switch {
	case byID:
		params.Set("isbn", q.ISBN)
	case q.Title != "":
		params.Set("title", q.Title)
		if len(q.Authors) > 0 {
			params.Set("author", q.Authors[0])
		}
	default:
		return nil, nil
	}
	var res struct {
		Docs []struct {
			Key    string   `json:"key"`
			Title  string   `json:"title"`
			Author []string `json:"author_name"`
		} `json:"docs"`
	}
	if _, err := p.get(ctx, "/search.json", params, &res); err != nil {
		return nil, err
	}
	var out []Match
	for _, d := range res.Docs {
		f := Fields{}
		if d.Title != "" {
			set(f, FieldTitle, d.Title)
		}
		if len(d.Author) > 0 {
			set(f, FieldAuthors, d.Author)
		}
		out = append(out, Match{Provider: ProviderOpenLibrary, ID: d.Key, ByIdentifier: byID, Fields: f})
	}
	// Edition detail only when one work matched the ISBN, so it can never be attached to the wrong result.
	if byID && len(out) == 1 {
		p.addEditionDetail(ctx, q.ISBN, res.Docs[0].Key, out[0].Fields)
	}
	return out, nil
}

// addEditionDetail adds the edition's own publisher, date and page count and the work's synopsis. A failed or empty
// detail request leaves the search result as it was; it is an enrichment, not a requirement.
func (p OpenLibrary) addEditionDetail(ctx context.Context, isbn, workKey string, f Fields) {
	var ed struct {
		Publishers    []string `json:"publishers"`
		PublishDate   string   `json:"publish_date"`
		NumberOfPages int      `json:"number_of_pages"`
		Subtitle      string   `json:"subtitle"`
	}
	if code, err := p.get(ctx, "/isbn/"+url.PathEscape(isbn)+".json", nil, &ed); err == nil && code == http.StatusOK {
		if len(ed.Publishers) > 0 {
			if x := strings.TrimSpace(ed.Publishers[0]); x != "" && len([]rune(x)) <= 512 {
				set(f, FieldPublisher, x)
			}
		}
		if d, ok := ParsePublishDate(ed.PublishDate); ok {
			set(f, FieldPublished, d)
		}
		if ed.NumberOfPages >= 1 && ed.NumberOfPages <= 100000 {
			set(f, FieldPageCount, ed.NumberOfPages)
		}
		if x := strings.TrimSpace(ed.Subtitle); x != "" && len([]rune(x)) <= 4096 {
			set(f, FieldSubtitle, x)
		}
	}
	if !strings.HasPrefix(workKey, "/works/") || strings.ContainsAny(workKey[len("/works/"):], "/?#") {
		return
	}
	set(f, FieldOpenLibraryID, strings.TrimPrefix(workKey, "/works/"))
	var work struct {
		Description json.RawMessage `json:"description"` // a string, or {"type":..., "value":...}
		Subjects    []string        `json:"subjects"`
	}
	if code, err := p.get(ctx, workKey+".json", nil, &work); err != nil || code != http.StatusOK {
		return
	}
	if g := cleanList(work.Subjects, 10); len(g) > 0 {
		set(f, FieldGenres, g)
	}
	var text string
	if json.Unmarshal(work.Description, &text) != nil {
		var obj struct {
			Value string `json:"value"`
		}
		if json.Unmarshal(work.Description, &obj) == nil {
			text = obj.Value
		}
	}
	if text = strings.TrimSpace(text); text != "" {
		if r := []rune(text); len(r) > MaxDescription {
			text = string(r[:MaxDescription])
		}
		set(f, FieldDescription, text)
	}
}

var publishLayouts = []struct{ layout, out string }{
	{"2006-01-02", "2006-01-02"}, {"2006-01", "2006-01"}, {"January 2, 2006", "2006-01-02"}, {"Jan 2, 2006", "2006-01-02"},
	{"2 January 2006", "2006-01-02"}, {"2 Jan 2006", "2006-01-02"}, {"January 2006", "2006-01"}, {"Jan 2006", "2006-01"}, {"2006", "2006"},
}

// ParsePublishDate turns a provider's free-text date into the stored YYYY, YYYY-MM or YYYY-MM-DD form,
// keeping the precision it had. Anything it cannot read exactly is rejected rather than guessed.
func ParsePublishDate(s string) (string, bool) {
	s = strings.TrimSpace(s)
	for _, l := range publishLayouts {
		if t, err := time.Parse(l.layout, s); err == nil && t.Year() >= 1000 {
			if d := t.Format(l.out); publishedRe.MatchString(d) {
				return d, true
			}
		}
	}
	return "", false
}

// GoogleBooks uses the volumes search API (an API key, if any, stays local).
type GoogleBooks struct {
	HTTP
	APIKey string
}

func (GoogleBooks) Name() string { return ProviderGoogleBooks }

func (p GoogleBooks) Lookup(ctx context.Context, q Query) ([]Match, error) {
	params := url.Values{"maxResults": {"5"}}
	byID := q.ISBN != ""
	switch {
	case byID:
		params.Set("q", "isbn:"+q.ISBN)
	case q.Title != "":
		s := "intitle:" + q.Title
		if len(q.Authors) > 0 {
			s += "+inauthor:" + q.Authors[0]
		}
		params.Set("q", s)
	default:
		return nil, nil
	}
	if p.APIKey != "" {
		params.Set("key", p.APIKey)
	}
	var res struct {
		Items []struct {
			ID         string `json:"id"`
			VolumeInfo struct {
				Title               string   `json:"title"`
				Subtitle            string   `json:"subtitle"`
				Authors             []string `json:"authors"`
				Categories          []string `json:"categories"`
				AverageRating       float64  `json:"averageRating"`
				RatingsCount        int      `json:"ratingsCount"`
				Publisher           string   `json:"publisher"`
				PublishedDate       string   `json:"publishedDate"`
				Description         string   `json:"description"`
				PageCount           int      `json:"pageCount"`
				Language            string   `json:"language"`
				IndustryIdentifiers []struct {
					Type       string `json:"type"`
					Identifier string `json:"identifier"`
				} `json:"industryIdentifiers"`
			} `json:"volumeInfo"`
		} `json:"items"`
	}
	if _, err := p.get(ctx, "/books/v1/volumes", params, &res); err != nil {
		return nil, err
	}
	var out []Match
	for _, it := range res.Items {
		f := Fields{}
		if it.VolumeInfo.Title != "" {
			set(f, FieldTitle, it.VolumeInfo.Title)
		}
		if len(it.VolumeInfo.Authors) > 0 {
			set(f, FieldAuthors, it.VolumeInfo.Authors)
		}
		v := it.VolumeInfo
		if x := strings.TrimSpace(v.Subtitle); x != "" && len([]rune(x)) <= 4096 {
			set(f, FieldSubtitle, x)
		}
		if g := cleanList(v.Categories, 20); len(g) > 0 {
			set(f, FieldGenres, g)
		}
		if v.AverageRating > 0 && v.AverageRating <= 5 && v.RatingsCount > 0 {
			set(f, FieldPublicRating, v.AverageRating)
			set(f, FieldPublicRatingCount, v.RatingsCount)
		}
		if it.ID != "" && len(it.ID) <= 64 {
			set(f, FieldGoogleBooksID, it.ID)
		}
		if x := strings.TrimSpace(v.Publisher); x != "" && len([]rune(x)) <= 512 {
			set(f, FieldPublisher, x)
		}
		if publishedRe.MatchString(v.PublishedDate) {
			set(f, FieldPublished, v.PublishedDate)
		}
		if x := strings.TrimSpace(v.Description); x != "" {
			if r := []rune(x); len(r) > 8000 {
				x = string(r[:8000])
			}
			set(f, FieldDescription, x)
		}
		if v.PageCount >= 1 && v.PageCount <= 100000 {
			set(f, FieldPageCount, v.PageCount)
		}
		if x := strings.TrimSpace(v.Language); x != "" && len(x) <= 35 {
			set(f, FieldLanguage, x)
		}
		var isbn10, isbn13 string
		for _, id := range v.IndustryIdentifiers {
			switch id.Type {
			case "ISBN_13":
				isbn13 = id.Identifier
			case "ISBN_10":
				isbn10 = id.Identifier
			}
		}
		for _, x := range []string{isbn13, isbn10} {
			if isbnRE.MatchString(x) {
				set(f, FieldISBN, strings.ToUpper(x))
				break
			}
		}
		out = append(out, Match{Provider: ProviderGoogleBooks, ID: it.ID, ByIdentifier: byID, Fields: f})
	}
	return out, nil
}

// Audnexus resolves an ASIN; it has no title search, so without an ASIN it
// returns nothing rather than guessing.
type Audnexus struct{ HTTP }

func (Audnexus) Name() string { return ProviderAudnexus }

func (p Audnexus) Lookup(ctx context.Context, q Query) ([]Match, error) {
	if q.ASIN == "" {
		return nil, nil
	}
	var res struct {
		ASIN    string `json:"asin"`
		Title   string `json:"title"`
		Authors []struct {
			Name string `json:"name"`
		} `json:"authors"`
		Narrators []struct {
			Name string `json:"name"`
		} `json:"narrators"`
		SeriesPrimary *struct {
			Name     string `json:"name"`
			Position string `json:"position"`
		} `json:"seriesPrimary"`
	}
	code, err := p.get(ctx, "/books/"+url.PathEscape(q.ASIN), nil, &res)
	if err != nil || code == http.StatusNotFound {
		return nil, err
	}
	f := Fields{}
	if res.Title != "" {
		set(f, FieldTitle, res.Title)
	}
	var a, n []string
	for _, x := range res.Authors {
		a = append(a, x.Name)
	}
	for _, x := range res.Narrators {
		n = append(n, x.Name)
	}
	if len(a) > 0 {
		set(f, FieldAuthors, a)
	}
	if len(n) > 0 {
		set(f, FieldNarrators, n)
	}
	if res.SeriesPrimary != nil && res.SeriesPrimary.Name != "" {
		set(f, FieldSeriesName, res.SeriesPrimary.Name)
	}
	return []Match{{Provider: ProviderAudnexus, ID: res.ASIN, ByIdentifier: true, Fields: f}}, nil
}

// cleanList trims, drops blanks and duplicates, and keeps at most max entries of a provider's list.
func cleanList(in []string, max int) []string {
	var out []string
	seen := map[string]bool{}
	for _, x := range in {
		x = strings.TrimSpace(x)
		k := strings.ToLower(x)
		if x == "" || len([]rune(x)) > 200 || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, x)
		if len(out) == max {
			break
		}
	}
	return out
}
