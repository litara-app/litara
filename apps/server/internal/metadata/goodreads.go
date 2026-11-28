package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/deranjer/ebooker/apps/server/internal/ebookmeta"
)

// ProviderGoodreads reads Goodreads through the GraphQL endpoint its own website calls (ADR-0115). Goodreads does not
// offer this to third parties and can change or revoke it at any time. It is contacted only for libraries that list it.
const ProviderGoodreads = "goodreads"

// The endpoint and key the Goodreads website ships to every visitor. Goodreads has changed the key before, so an
// operator can replace both (LITARA_GOODREADS_API_KEY and LITARA_GOODREADS_ENDPOINT) without waiting for a release.
const (
	goodreadsEndpoint  = "https://kxbwmqov6jgg3daaamb744ycu4.appsync-api.us-east-1.amazonaws.com/graphql"
	goodreadsPublicKey = "da2-d2fyuybwsbf3poyquvbp2mbiwu"
	goodreadsSite      = "https://www.goodreads.com"
)

// maxGoodreadsBooks is how many title-search results are read in full; each one costs a request.
const maxGoodreadsBooks = 3

const goodreadsBookQuery = `query LitaraBook($id: Int!) {
  getBookByLegacyId(legacyId: $id) {
    title
    description
    imageUrl
    primaryContributorEdge { node { name } }
    secondaryContributorEdges { role node { name } }
    bookSeries { userPosition series { title } }
    bookGenres { genre { name } }
    details { numPages publicationTime publisher isbn isbn13 asin language { name } }
    work { stats { averageRating ratingsCount } }
  }
}`

var (
	goodreadsIDRe   = regexp.MustCompile(`^\d{1,10}$`)
	goodreadsPathRe = regexp.MustCompile(`^/book/show/(\d{1,10})(?:[-.].*)?$`)
)

// Goodreads finds a book's ID on the website (by ISBN or title) and reads the book from the GraphQL endpoint. Web and
// API share one request budget.
type Goodreads struct {
	Web    HTTP // www.goodreads.com
	API    HTTP // the GraphQL endpoint; its BaseURL is the whole address
	APIKey string
}

// NewGoodreads builds the provider. An empty apiKey or endpoint keeps the built-in one.
func NewGoodreads(client *http.Client, apiKey, endpoint string) Goodreads {
	if strings.TrimSpace(apiKey) == "" {
		apiKey = goodreadsPublicKey
	}
	if strings.TrimSpace(endpoint) == "" {
		endpoint = goodreadsEndpoint
	}
	web := newProviderHTTP(client, goodreadsSite, 1, false)
	api := web
	api.BaseURL = strings.TrimSpace(endpoint)
	return Goodreads{Web: web, API: api, APIKey: strings.TrimSpace(apiKey)}
}

func (Goodreads) Name() string { return ProviderGoodreads }

type goodreadsContributor struct {
	Role string `json:"role"`
	Node *struct {
		Name string `json:"name"`
	} `json:"node"`
}

type goodreadsBook struct {
	id string

	Title       string                  `json:"title"`
	Description string                  `json:"description"`
	ImageURL    string                  `json:"imageUrl"`
	Primary     *goodreadsContributor   `json:"primaryContributorEdge"`
	Secondary   []*goodreadsContributor `json:"secondaryContributorEdges"`
	Series      []struct {
		Position string `json:"userPosition"`
		Series   *struct {
			Title string `json:"title"`
		} `json:"series"`
	} `json:"bookSeries"`
	Genres []struct {
		Genre *struct {
			Name string `json:"name"`
		} `json:"genre"`
	} `json:"bookGenres"`
	Details *struct {
		Pages     json.Number `json:"numPages"`
		Published *float64    `json:"publicationTime"` // milliseconds since 1970; negative before it
		Publisher string      `json:"publisher"`
		ISBN10    string      `json:"isbn"`
		ISBN13    string      `json:"isbn13"`
		ASIN      string      `json:"asin"`
		Language  *struct {
			Name string `json:"name"`
		} `json:"language"`
	} `json:"details"`
	Work *struct {
		Stats *struct {
			Rating json.Number `json:"averageRating"`
			Count  json.Number `json:"ratingsCount"`
		} `json:"stats"`
	} `json:"work"`
}

// authors is the primary contributor and every other contributor credited as an author. Translators, illustrators and
// writers of introductions are left out.
func (b goodreadsBook) authors() []string {
	var names []string
	add := func(c *goodreadsContributor) {
		if c != nil && c.Node != nil {
			// Goodreads stores some names with doubled spaces.
			names = append(names, strings.Join(strings.Fields(c.Node.Name), " "))
		}
	}
	add(b.Primary)
	for _, c := range b.Secondary {
		if c != nil && c.Role == "Author" {
			add(c)
		}
	}
	return cleanList(names, 20)
}

// hasISBN reports whether the record states this ISBN, in either form it carries.
func (b goodreadsBook) hasISBN(isbn string) bool {
	return b.Details != nil && (strings.EqualFold(b.Details.ISBN10, isbn) || strings.EqualFold(b.Details.ISBN13, isbn))
}

func (b goodreadsBook) match() Match {
	f := Fields{}
	short := func(field, value string, limit int) {
		if value = strings.TrimSpace(value); value != "" && len([]rune(value)) <= limit {
			set(f, field, value)
		}
	}
	short(FieldTitle, b.Title, 4096)
	if a := b.authors(); len(a) > 0 {
		set(f, FieldAuthors, a)
	}
	setDescription(f, ebookmeta.PlainText(b.Description))
	if len(b.Series) > 0 && b.Series[0].Series != nil {
		if name := strings.TrimSpace(b.Series[0].Series.Title); name != "" {
			short(FieldSeriesName, name, 512)
			// A range such as "1-3" (an omnibus) is not a position.
			if n, err := strconv.ParseFloat(strings.TrimSpace(b.Series[0].Position), 64); err == nil && n >= 0 && n <= 100000 {
				set(f, FieldSeriesIndex, n)
			}
		}
	}
	var genres []string
	for _, g := range b.Genres {
		if g.Genre != nil {
			genres = append(genres, g.Genre.Name)
		}
	}
	if g := cleanList(genres, 10); len(g) > 0 {
		set(f, FieldGenres, g)
	}
	if d := b.Details; d != nil {
		short(FieldPublisher, d.Publisher, 512)
		if d.Published != nil {
			if t := time.UnixMilli(int64(*d.Published)).UTC(); t.Year() >= 1000 && t.Year() <= 9999 {
				set(f, FieldPublished, t.Format("2006-01-02"))
			}
		}
		if n, err := strconv.Atoi(d.Pages.String()); err == nil && n >= 1 && n <= 100000 {
			set(f, FieldPageCount, n)
		}
		for _, x := range []string{d.ISBN13, d.ISBN10} {
			if isbnRE.MatchString(x) {
				set(f, FieldISBN, strings.ToUpper(x))
				break
			}
		}
		// For a printed book Goodreads repeats the ISBN-10 here; only an Amazon "B" number is a separate identifier.
		if x := strings.ToUpper(d.ASIN); strings.HasPrefix(x, "B") && asinRE.MatchString(x) {
			set(f, FieldASIN, x)
		}
		if d.Language != nil {
			if code := languageCode(d.Language.Name); code != "" {
				set(f, FieldLanguage, code)
			}
		}
	}
	if b.Work != nil && b.Work.Stats != nil {
		rating, rerr := b.Work.Stats.Rating.Float64()
		count, cerr := strconv.Atoi(b.Work.Stats.Count.String())
		if rerr == nil && cerr == nil && rating > 0 && rating <= 5 && count > 0 && count <= 1000000000 {
			set(f, FieldPublicRating, rating)
			set(f, FieldPublicRatingCount, count)
		}
	}
	set(f, FieldGoodreadsID, b.id)
	return Match{Provider: ProviderGoodreads, ID: b.id, Fields: f}
}

// goodreadsLanguages maps the English language names Goodreads returns to the codes the other providers use. A name that
// is not listed leaves the language out rather than storing a guess.
var goodreadsLanguages = map[string]string{
	"arabic": "ar", "bengali": "bn", "bulgarian": "bg", "catalan": "ca", "chinese": "zh", "croatian": "hr",
	"czech": "cs", "danish": "da", "dutch": "nl", "english": "en", "estonian": "et", "finnish": "fi", "french": "fr",
	"german": "de", "greek": "el", "hebrew": "he", "hindi": "hi", "hungarian": "hu", "icelandic": "is",
	"indonesian": "id", "italian": "it", "japanese": "ja", "korean": "ko", "latin": "la", "latvian": "lv",
	"lithuanian": "lt", "malay": "ms", "norwegian": "no", "persian": "fa", "polish": "pl", "portuguese": "pt",
	"romanian": "ro", "russian": "ru", "serbian": "sr", "slovak": "sk", "slovenian": "sl", "spanish": "es",
	"swedish": "sv", "tagalog": "tl", "tamil": "ta", "thai": "th", "turkish": "tr", "ukrainian": "uk", "urdu": "ur",
	"vietnamese": "vi", "welsh": "cy",
}

// languageCode accepts "English" and variants such as "Spanish; Castilian".
func languageCode(name string) string {
	name, _, _ = strings.Cut(strings.ToLower(name), ";")
	return goodreadsLanguages[strings.TrimSpace(name)]
}

// book reads one book. A book Goodreads no longer has is (nil, nil).
func (g Goodreads) book(ctx context.Context, id string) (*goodreadsBook, error) {
	n, err := strconv.ParseInt(id, 10, 32) // the query's variable is a GraphQL Int
	if err != nil {
		return nil, nil
	}
	payload, _ := json.Marshal(map[string]any{"query": goodreadsBookQuery, "variables": map[string]any{"id": n}})
	var reply struct {
		Errors []struct {
			Type string `json:"errorType"`
		} `json:"errors"`
		Data *struct {
			Book *goodreadsBook `json:"getBookByLegacyId"`
		} `json:"data"`
	}
	code, err := g.API.post(ctx, "", payload, map[string]string{"x-api-key": g.APIKey}, &reply)
	if err != nil {
		return nil, err
	}
	if code != http.StatusOK {
		return nil, fmt.Errorf("provider returned status %d", code)
	}
	for _, e := range reply.Errors {
		if e.Type != "RESOURCE_NOT_FOUND" {
			return nil, errors.New("provider returned an error") // never include the response: it can echo the request
		}
	}
	if reply.Data == nil {
		return nil, errors.New("provider response unreadable")
	}
	if b := reply.Data.Book; b != nil {
		b.id = id
		return b, nil
	}
	return nil, nil
}

// idByISBN follows Goodreads' ISBN address as far as its redirect to the book. An unknown ISBN is ("", nil).
func (g Goodreads) idByISBN(ctx context.Context, isbn string) (string, error) {
	target, err := g.Web.redirect(ctx, "/book/isbn/"+url.PathEscape(isbn))
	if err != nil || target == "" {
		return "", err
	}
	u, err := url.Parse(target)
	if err != nil {
		return "", errors.New("provider response unreadable")
	}
	m := goodreadsPathRe.FindStringSubmatch(u.Path)
	if m == nil { // for example a sign-in or challenge page
		return "", errors.New("provider response unreadable")
	}
	return m[1], nil
}

// searchTitle asks the website's search suggestions for the title alone (adding the author makes them worse) and reads
// the best few. The authors only rank the suggestions here; they are not sent.
func (g Goodreads) searchTitle(ctx context.Context, q Query) ([]goodreadsBook, error) {
	var hits []struct {
		BookID string `json:"bookId"`
		Title  string `json:"title"`
		Bare   string `json:"bookTitleBare"` // the title without the "(Series, #1)" suffix
		Author struct {
			Name string `json:"name"`
		} `json:"author"`
	}
	code, err := g.Web.get(ctx, "/book/auto_complete", url.Values{"format": {"json"}, "q": {q.Title}}, &hits)
	if err != nil {
		return nil, err
	}
	if code != http.StatusOK { // a missing search address is an outage, not an empty result
		return nil, fmt.Errorf("provider returned status %d", code)
	}
	type ranked struct {
		id    string
		score int
	}
	var order []ranked
	seen := map[string]bool{}
	for _, h := range hits {
		if !goodreadsIDRe.MatchString(h.BookID) || seen[h.BookID] {
			continue
		}
		seen[h.BookID] = true
		title := h.Bare
		if title == "" {
			title = h.Title
		}
		author := strings.Join(strings.Fields(h.Author.Name), " ")
		order = append(order, ranked{h.BookID, hardcoverAgreement(q, hardcoverDocument{Title: title, AuthorNames: []string{author}})})
	}
	slices.SortStableFunc(order, func(a, b ranked) int { return a.score - b.score })
	if len(order) > maxGoodreadsBooks {
		order = order[:maxGoodreadsBooks]
	}
	var out []goodreadsBook
	for _, r := range order {
		// A failure here fails the whole lookup, so an incomplete result is never cached or recorded.
		b, err := g.book(ctx, r.id)
		if err != nil {
			return nil, err
		}
		if b != nil {
			out = append(out, *b)
		}
	}
	return out, nil
}

func (g Goodreads) Lookup(ctx context.Context, q Query) ([]Match, error) {
	if q.ISBN != "" {
		id, err := g.idByISBN(ctx, q.ISBN)
		if err != nil {
			return nil, err
		}
		if id != "" {
			b, err := g.book(ctx, id)
			if err != nil {
				return nil, err
			}
			if b != nil {
				m := b.match()
				// Only a record that states the ISBN asked for is an identifier match (ADR-0060).
				m.ByIdentifier = b.hasISBN(q.ISBN)
				return []Match{m}, nil
			}
		}
	}
	if strings.TrimSpace(q.Title) == "" {
		return nil, nil
	}
	books, err := g.searchTitle(ctx, q)
	if err != nil {
		return nil, err
	}
	var out []Match
	for _, b := range books {
		out = append(out, b.match())
	}
	return out, nil
}

// Covers returns the images of the books a title search finds.
func (g Goodreads) Covers(ctx context.Context, title, author string) ([]CoverHit, error) {
	q := Query{Title: title}
	if author != "" {
		q.Authors = []string{author}
	}
	books, err := g.searchTitle(ctx, q)
	if err != nil {
		return nil, err
	}
	var out []CoverHit
	for _, b := range books {
		// A book without a cover points at a "nophoto" placeholder.
		if !strings.HasPrefix(b.ImageURL, "https://") || len(b.ImageURL) > 2048 || strings.Contains(b.ImageURL, "/nophoto/") {
			continue
		}
		hit := CoverHit{Title: b.Title, ImageURL: b.ImageURL}
		if a := b.authors(); len(a) > 0 {
			hit.Author = a[0]
		}
		out = append(out, hit)
	}
	return out, nil
}

// CoverHit is one cover a metadata provider offers.
type CoverHit struct {
	Title    string
	Author   string
	ImageURL string
}

// CoverProvider is a metadata provider that can also offer covers (ADR-0115).
type CoverProvider interface {
	Provider
	Covers(ctx context.Context, title, author string) ([]CoverHit, error)
}
