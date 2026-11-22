package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// ProviderHardcover is the Hardcover GraphQL API (ADR-0087). It needs an operator token and is contacted only for
// libraries that list it.
const ProviderHardcover = "hardcover"

const hardcoverPath = "/v1/graphql"

// Hardcover looks books up by ISBN (the documented editions query) or by text (the documented search query).
// The text-search response shape follows the published documentation and has not been checked against the live service.
type Hardcover struct {
	HTTP
	Token string
}

func (Hardcover) Name() string { return ProviderHardcover }

// authorization sends the token as Hardcover's page shows it, with a Bearer prefix when the operator left it off.
func (h Hardcover) authorization() string {
	t := strings.TrimSpace(h.Token)
	if strings.HasPrefix(strings.ToLower(t), "bearer ") {
		return t
	}
	return "Bearer " + t
}

type hardcoverReply struct {
	Errors []json.RawMessage `json:"errors"`
	Data   json.RawMessage   `json:"data"`
}

func (h Hardcover) query(ctx context.Context, query string, vars map[string]any, data any) error {
	payload, _ := json.Marshal(map[string]any{"query": query, "variables": vars})
	var reply hardcoverReply
	code, err := h.post(ctx, hardcoverPath, payload, map[string]string{"authorization": h.authorization()}, &reply)
	if err != nil {
		return err
	}
	if code != http.StatusOK || len(reply.Errors) > 0 {
		return errors.New("provider returned an error") // never include the response: it can echo the request
	}
	return json.Unmarshal(reply.Data, data)
}

const hardcoverEditionQuery = `query($isbn: String!) {
  editions(where: {_or: [{isbn_13: {_eq: $isbn}}, {isbn_10: {_eq: $isbn}}]}, limit: 5) {
    id title isbn_13 isbn_10 pages release_date
    publisher { name }
    book { id slug title description contributions { author { name } } book_series { position series { name } } }
  }
}`

const hardcoverSearchQuery = `query($q: String!) {
  search(query: $q, query_type: "book", per_page: 5, page: 1) { results }
}`

func (h Hardcover) Lookup(ctx context.Context, q Query) ([]Match, error) {
	switch {
	case q.ISBN != "":
		return h.byISBN(ctx, q.ISBN)
	case q.Title != "":
		return h.bySearch(ctx, q)
	}
	return nil, nil
}

func (h Hardcover) byISBN(ctx context.Context, isbn string) ([]Match, error) {
	var data struct {
		Editions []struct {
			ID          int                    `json:"id"`
			Title       string                 `json:"title"`
			ISBN13      string                 `json:"isbn_13"`
			ISBN10      string                 `json:"isbn_10"`
			Pages       int                    `json:"pages"`
			ReleaseDate string                 `json:"release_date"`
			Publisher   *struct{ Name string } `json:"publisher"`
			Book        *struct {
				ID            int    `json:"id"`
				Slug          string `json:"slug"`
				Title         string `json:"title"`
				Description   string `json:"description"`
				Contributions []struct {
					Author *struct{ Name string } `json:"author"`
				} `json:"contributions"`
				BookSeries []struct {
					Position *float64               `json:"position"`
					Series   *struct{ Name string } `json:"series"`
				} `json:"book_series"`
			} `json:"book"`
		} `json:"editions"`
	}
	if err := h.query(ctx, hardcoverEditionQuery, map[string]any{"isbn": isbn}, &data); err != nil {
		return nil, err
	}
	var out []Match
	for _, e := range data.Editions {
		f := Fields{}
		title := e.Title
		if e.Book != nil && strings.TrimSpace(e.Book.Title) != "" {
			title = e.Book.Title
		}
		if strings.TrimSpace(title) != "" {
			set(f, FieldTitle, title)
		}
		if e.Book != nil {
			var authors []string
			for _, c := range e.Book.Contributions {
				if c.Author != nil && strings.TrimSpace(c.Author.Name) != "" {
					authors = append(authors, c.Author.Name)
				}
			}
			if len(authors) > 0 {
				set(f, FieldAuthors, authors)
			}
			setDescription(f, e.Book.Description)
			if len(e.Book.BookSeries) == 1 && e.Book.BookSeries[0].Series != nil && strings.TrimSpace(e.Book.BookSeries[0].Series.Name) != "" {
				set(f, FieldSeriesName, e.Book.BookSeries[0].Series.Name)
				if pos := e.Book.BookSeries[0].Position; pos != nil && *pos >= 0 {
					set(f, FieldSeriesIndex, *pos)
				}
			}
		}
		if e.Publisher != nil && strings.TrimSpace(e.Publisher.Name) != "" && len([]rune(e.Publisher.Name)) <= 512 {
			set(f, FieldPublisher, strings.TrimSpace(e.Publisher.Name))
		}
		if publishedRe.MatchString(e.ReleaseDate) {
			set(f, FieldPublished, e.ReleaseDate)
		}
		if e.Pages >= 1 && e.Pages <= 100000 {
			set(f, FieldPageCount, e.Pages)
		}
		for _, x := range []string{e.ISBN13, e.ISBN10} {
			if isbnRE.MatchString(x) {
				set(f, FieldISBN, strings.ToUpper(x))
				break
			}
		}
		id := "edition:" + itoa(e.ID)
		out = append(out, Match{Provider: ProviderHardcover, ID: id, ByIdentifier: true, Fields: f})
	}
	return out, nil
}

func (h Hardcover) bySearch(ctx context.Context, q Query) ([]Match, error) {
	text := q.Title
	if len(q.Authors) > 0 {
		text += " " + q.Authors[0]
	}
	var data struct {
		Search struct {
			Results struct {
				Hits []struct {
					Document struct {
						ID                     json.Number `json:"id"`
						Title                  string      `json:"title"`
						Description            string      `json:"description"`
						AuthorNames            []string    `json:"author_names"`
						SeriesNames            []string    `json:"series_names"`
						FeaturedSeriesPosition *float64    `json:"featured_series_position"`
					} `json:"document"`
				} `json:"hits"`
			} `json:"results"`
		} `json:"search"`
	}
	if err := h.query(ctx, hardcoverSearchQuery, map[string]any{"q": text}, &data); err != nil {
		return nil, err
	}
	var out []Match
	for _, hit := range data.Search.Results.Hits {
		d := hit.Document
		f := Fields{}
		if strings.TrimSpace(d.Title) != "" {
			set(f, FieldTitle, d.Title)
		}
		if len(d.AuthorNames) > 0 {
			set(f, FieldAuthors, d.AuthorNames)
		}
		setDescription(f, d.Description)
		if len(d.SeriesNames) == 1 && strings.TrimSpace(d.SeriesNames[0]) != "" {
			set(f, FieldSeriesName, d.SeriesNames[0])
			if d.FeaturedSeriesPosition != nil && *d.FeaturedSeriesPosition >= 0 {
				set(f, FieldSeriesIndex, *d.FeaturedSeriesPosition)
			}
		}
		out = append(out, Match{Provider: ProviderHardcover, ID: "book:" + d.ID.String(), Fields: f})
	}
	return out, nil
}

func setDescription(f Fields, text string) {
	if text = strings.TrimSpace(text); text != "" {
		if r := []rune(text); len(r) > MaxDescription {
			text = string(r[:MaxDescription])
		}
		set(f, FieldDescription, text)
	}
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }
