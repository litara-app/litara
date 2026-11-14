package metadata

import (
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
	Client  *http.Client
	BaseURL string
}

func (h HTTP) get(ctx context.Context, path string, params url.Values, out any) (int, error) {
	c := h.Client
	if c == nil {
		c = &http.Client{Timeout: 15 * time.Second}
	}
	u := strings.TrimRight(h.BaseURL, "/") + path
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", "Litara (self-hosted metadata lookup)")
	req.Header.Set("Accept", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		return 0, fmt.Errorf("provider request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return resp.StatusCode, nil
	}
	if resp.StatusCode != http.StatusOK {
		return resp.StatusCode, fmt.Errorf("provider returned status %d", resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponse)).Decode(out); err != nil {
		return resp.StatusCode, fmt.Errorf("provider response unreadable")
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
	return out, nil
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
				Title   string   `json:"title"`
				Authors []string `json:"authors"`
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
