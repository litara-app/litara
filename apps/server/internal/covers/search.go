package covers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Result is one candidate cover from an online provider. ImageURL is what the server fetches if it is chosen.
type Result struct {
	Provider string `json:"provider"`
	Title    string `json:"title"`
	Author   string `json:"author"`
	ImageURL string `json:"imageUrl"`
	ThumbURL string `json:"thumbUrl"`
}

// Searcher queries Open Library and iTunes with only a title and an author. Base URLs are fields so tests can point
// them at a local server.
type Searcher struct {
	OpenLibrary string // https://openlibrary.org
	OLCovers    string // https://covers.openlibrary.org
	ITunes      string // https://itunes.apple.com
	client      *http.Client
}

func NewSearcher() *Searcher {
	return &Searcher{OpenLibrary: "https://openlibrary.org", OLCovers: "https://covers.openlibrary.org", ITunes: "https://itunes.apple.com",
		client: &http.Client{Timeout: 8 * time.Second}}
}

// WithClient lets tests use their own HTTP client.
func (s *Searcher) WithClient(c *http.Client) *Searcher { s.client = c; return s }

func (s *Searcher) getJSON(ctx context.Context, u string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Litara-cover-search")
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(out)
}

// Search returns up to about twenty candidates for a medium ("ebook" or "audio"). A provider that fails is skipped so one
// outage does not hide the other's results; the error is returned only when every provider failed.
func (s *Searcher) Search(ctx context.Context, title, author, medium string) ([]Result, error) {
	title, author = strings.TrimSpace(title), strings.TrimSpace(author)
	if title == "" {
		return nil, fmt.Errorf("a title is needed to search")
	}
	var out []Result
	var failures int
	if r, err := s.openLibrary(ctx, title, author); err == nil {
		out = append(out, r...)
	} else {
		failures++
	}
	if r, err := s.itunes(ctx, title, author, medium); err == nil {
		out = append(out, r...)
	} else {
		failures++
	}
	if failures == 2 {
		return nil, fmt.Errorf("the cover sites could not be reached")
	}
	return out, nil
}

func (s *Searcher) openLibrary(ctx context.Context, title, author string) ([]Result, error) {
	q := url.Values{"title": {title}, "limit": {"10"}, "fields": {"title,author_name,cover_i"}}
	if author != "" {
		q.Set("author", author)
	}
	var body struct {
		Docs []struct {
			Title   string   `json:"title"`
			Authors []string `json:"author_name"`
			CoverID int64    `json:"cover_i"`
		} `json:"docs"`
	}
	if err := s.getJSON(ctx, s.OpenLibrary+"/search.json?"+q.Encode(), &body); err != nil {
		return nil, err
	}
	var out []Result
	for _, d := range body.Docs {
		if d.CoverID <= 0 {
			continue
		}
		a := ""
		if len(d.Authors) > 0 {
			a = d.Authors[0]
		}
		out = append(out, Result{Provider: "Open Library", Title: d.Title, Author: a,
			ImageURL: fmt.Sprintf("%s/b/id/%d-L.jpg", s.OLCovers, d.CoverID), ThumbURL: fmt.Sprintf("%s/b/id/%d-M.jpg", s.OLCovers, d.CoverID)})
	}
	return out, nil
}

func (s *Searcher) itunes(ctx context.Context, title, author, medium string) ([]Result, error) {
	entity := map[string]string{"audio": "audiobook", "ebook": "ebook"}[medium]
	if entity == "" {
		entity = "ebook"
	}
	q := url.Values{"term": {strings.TrimSpace(title + " " + author)}, "media": {entity}, "limit": {"10"}}
	var body struct {
		Results []struct {
			Name    string `json:"trackName"`
			Collect string `json:"collectionName"`
			Artist  string `json:"artistName"`
			Artwork string `json:"artworkUrl100"`
		} `json:"results"`
	}
	if err := s.getJSON(ctx, s.ITunes+"/search?"+q.Encode(), &body); err != nil {
		return nil, err
	}
	var out []Result
	for _, r := range body.Results {
		if r.Artwork == "" {
			continue
		}
		name := r.Name
		if name == "" {
			name = r.Collect
		}
		out = append(out, Result{Provider: "iTunes", Title: name, Author: r.Artist,
			ImageURL: strings.Replace(r.Artwork, "100x100", "1000x1000", 1), ThumbURL: r.Artwork})
	}
	return out, nil
}
