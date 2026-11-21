// Package opds renders OPDS 1.2 (Atom) and OPDS 2.0 (JSON) documents for the
// same granted publication set (ADR-0073). It is pure: callers pass already
// authorized publications; nothing here reads the database or the request.
// Every untrusted string is escaped by the format encoder, never concatenated
// raw, and descriptions are plain text.
package opds

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Media types.
const (
	AtomNavigation   = "application/atom+xml;profile=opds-catalog;kind=navigation"
	AtomAcquisition  = "application/atom+xml;profile=opds-catalog;kind=acquisition"
	AtomEntry        = "application/atom+xml;type=entry;profile=opds-catalog"
	OpenSearchDesc   = "application/opensearchdescription+xml"
	JSONFeed         = "application/opds+json"
	JSONPublication  = "application/opds-publication+json"
	relAcquisition   = "http://opds-spec.org/acquisition"
	relImage         = "http://opds-spec.org/image"
	relSubsection    = "subsection"
	relStart         = "start"
	relSelf          = "self"
	atomNS           = "http://www.w3.org/2005/Atom"
	dcNS             = "http://purl.org/dc/terms/"
	openSearchNS     = "http://a9.com/-/spec/opensearch/1.1/"
	opdsNS           = "http://opds-spec.org/2010/catalog"
	serviceTitleText = "Litara"
)

// Pub is one authorized publication.
type Pub struct {
	ID             uuid.UUID
	Kind           string // ebook, comic, audio
	Title          string
	Authors        []string
	Narrators      []string
	SeriesName     *string
	SeriesIndex    *float64
	Language       *string
	Label          string
	FileID         uuid.UUID
	ContentVersion uuid.UUID
	MIME           string
	Size           int64
	Filename       string
	Updated        time.Time
	FileOrder      int
	FileCount      int
	CoverMIME      *string // non-nil when artwork exists
	Publisher      *string
	Published      *string // YYYY, YYYY-MM or YYYY-MM-DD
	ISBN           *string
	Synopsis       *string
	Pages          *int
}

// Library is a granted library for navigation.
type Library struct {
	ID   uuid.UUID
	Name string
}

// Query is the list filter and page, echoed into links.
type Query struct {
	Q         string
	LibraryID *uuid.UUID
	MediaKind string
	Page      int
	Size      int
}

func (q Query) values(page int) url.Values {
	v := url.Values{}
	if q.Q != "" {
		v.Set("q", q.Q)
	}
	if q.LibraryID != nil {
		v.Set("libraryId", q.LibraryID.String())
	}
	if q.MediaKind != "" {
		v.Set("mediaKind", q.MediaKind)
	}
	if page > 0 {
		v.Set("page", strconv.Itoa(page))
	}
	if q.Size != 50 {
		v.Set("size", strconv.Itoa(q.Size))
	}
	return v
}

// Links builds absolute same-origin URLs from the configured public origin.
// Request Host and forwarding headers are never consulted.
type Links struct{ Origin string }

func (l Links) root(v int) string { return fmt.Sprintf("%s/opds/v%d", l.Origin, v) }
func (l Links) list(v int, q Query, page int) string {
	u := l.root(v) + "/publications"
	if enc := q.values(page).Encode(); enc != "" {
		u += "?" + enc
	}
	return u
}
func (l Links) publication(v int, id uuid.UUID) string {
	return l.root(v) + "/publications/" + id.String()
}
func (l Links) acquisition(p Pub) string {
	return fmt.Sprintf("%s/opds/files/%s/versions/%s/content", l.Origin, p.FileID, p.ContentVersion)
}
func (l Links) artwork(p Pub) string {
	return fmt.Sprintf("%s/opds/publications/%s/artwork", l.Origin, p.ID)
}

// DisplayTitle names the file. An audio file shows its recording title and
// one-based order so files are never mistaken for interchangeable editions.
func DisplayTitle(p Pub) string {
	if p.Kind == "audio" {
		return fmt.Sprintf("%s (file %d of %d)", p.Title, p.FileOrder, p.FileCount)
	}
	return p.Title
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// Description is plain text.
func Description(p Pub) string {
	var parts []string
	switch p.Kind {
	case "audio":
		parts = append(parts, fmt.Sprintf("Audio file %d of %d from the recording %q. This is an individual original file, not a complete-recording package.", p.FileOrder, p.FileCount, p.Title))
		if len(p.Narrators) > 0 {
			parts = append(parts, "Narrated by "+strings.Join(p.Narrators, ", ")+".")
		}
	case "comic":
		parts = append(parts, "Comic original file.")
	default:
		parts = append(parts, "Ebook original file.")
	}
	if syn := strings.TrimSpace(deref(p.Synopsis)); syn != "" {
		if p.Kind == "audio" {
			parts = append(parts, syn) // the file facts above matter for a single audio file
		} else {
			parts[0] = syn // an ebook's own synopsis replaces the generic "Ebook original file." line
		}
	}
	if p.Label != "" {
		parts = append(parts, "Edition: "+p.Label+".")
	}
	if p.SeriesName != nil && *p.SeriesName != "" {
		s := "Series: " + *p.SeriesName
		if p.SeriesIndex != nil {
			s += " #" + strconv.FormatFloat(*p.SeriesIndex, 'f', -1, 64)
		}
		parts = append(parts, s+".")
	}
	return strings.Join(parts, " ")
}

func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// ---- Atom (OPDS 1.2) -------------------------------------------------------

func esc(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

func attr(s string) string { return esc(s) } // EscapeText also escapes quotes and angle brackets

const xmlHeader = `<?xml version="1.0" encoding="UTF-8"?>` + "\n"

func atomHead(b *bytes.Buffer, root string) {
	b.WriteString(xmlHeader)
	fmt.Fprintf(b, `<%s xmlns="%s" xmlns:dc="%s" xmlns:opds="%s" xmlns:opensearch="%s">`+"\n", root, atomNS, dcNS, opdsNS, openSearchNS)
}

func atomLink(b *bytes.Buffer, rel, href, typ, title string, length int64) {
	fmt.Fprintf(b, `  <link rel="%s" href="%s"`, attr(rel), attr(href))
	if typ != "" {
		fmt.Fprintf(b, ` type="%s"`, attr(typ))
	}
	if title != "" {
		fmt.Fprintf(b, ` title="%s"`, attr(title))
	}
	if length > 0 {
		fmt.Fprintf(b, ` length="%d"`, length)
	}
	b.WriteString("/>\n")
}

func atomEntry(b *bytes.Buffer, l Links, p Pub, indent string) {
	fmt.Fprintf(b, "%s<id>urn:uuid:%s</id>\n", indent, p.ID)
	fmt.Fprintf(b, "%s<title>%s</title>\n", indent, esc(DisplayTitle(p)))
	fmt.Fprintf(b, "%s<updated>%s</updated>\n", indent, rfc(p.Updated))
	authors := p.Authors
	if len(authors) == 0 {
		authors = []string{"Unknown"}
	}
	for _, a := range authors {
		fmt.Fprintf(b, "%s<author><name>%s</name></author>\n", indent, esc(a))
	}
	if p.Language != nil && *p.Language != "" {
		fmt.Fprintf(b, "%s<dc:language>%s</dc:language>\n", indent, esc(*p.Language))
	}
	if v := deref(p.Publisher); v != "" {
		fmt.Fprintf(b, "%s<dc:publisher>%s</dc:publisher>\n", indent, esc(v))
	}
	if v := deref(p.Published); v != "" {
		fmt.Fprintf(b, "%s<dc:issued>%s</dc:issued>\n", indent, esc(v))
	}
	if v := deref(p.ISBN); v != "" {
		fmt.Fprintf(b, "%s<dc:identifier>urn:isbn:%s</dc:identifier>\n", indent, esc(v))
	}
	fmt.Fprintf(b, `%s<category term="%s" label="%s"/>`+"\n", indent, attr(p.Kind), attr(strings.ToUpper(p.Kind[:1])+p.Kind[1:]))
	fmt.Fprintf(b, "%s<summary type=\"text\">%s</summary>\n", indent, esc(Description(p)))
	sub := func(rel, href, typ string, length int64) {
		fmt.Fprintf(b, `%s<link rel="%s" href="%s" type="%s"`, indent, attr(rel), attr(href), attr(typ))
		if length > 0 {
			fmt.Fprintf(b, ` length="%d"`, length)
		}
		b.WriteString("/>\n")
	}
	sub(relAcquisition, l.acquisition(p), p.MIME, p.Size)
	fmt.Fprintf(b, `%s<link rel="alternate" href="%s" type="%s"/>`+"\n", indent, attr(l.publication(1, p.ID)), attr(AtomEntry))
	if p.CoverMIME != nil {
		sub(relImage, l.artwork(p), *p.CoverMIME, 0)
	}
}

// AtomRoot is the navigation feed.
func AtomRoot(l Links, libs []Library, now time.Time) []byte {
	var b bytes.Buffer
	atomHead(&b, "feed")
	fmt.Fprintf(&b, "  <id>urn:litara:opds:v1:root</id>\n  <title>%s</title>\n  <updated>%s</updated>\n  <author><name>%s</name></author>\n", serviceTitleText, rfc(now), serviceTitleText)
	atomLink(&b, relSelf, l.root(1), AtomNavigation, "", 0)
	atomLink(&b, relStart, l.root(1), AtomNavigation, "", 0)
	atomLink(&b, "search", l.root(1)+"/search.xml", OpenSearchDesc, "Search publications", 0)
	nav := func(id, title, href string) {
		fmt.Fprintf(&b, "  <entry>\n    <id>%s</id>\n    <title>%s</title>\n    <updated>%s</updated>\n    <content type=\"text\">%s</content>\n", esc(id), esc(title), rfc(now), esc(title))
		fmt.Fprintf(&b, `    <link rel="%s" href="%s" type="%s"/>`+"\n  </entry>\n", relSubsection, attr(href), attr(AtomAcquisition))
	}
	nav("urn:litara:opds:v1:all", "All publications", l.list(1, Query{Size: 50}, 0))
	for _, lib := range libs {
		id := lib.ID
		nav("urn:uuid:"+lib.ID.String(), lib.Name, l.list(1, Query{LibraryID: &id, Size: 50}, 0))
	}
	b.WriteString("</feed>\n")
	return b.Bytes()
}

// AtomFeed is one acquisition page.
func AtomFeed(l Links, q Query, pubs []Pub, total int64, now time.Time) []byte {
	var b bytes.Buffer
	atomHead(&b, "feed")
	updated := now
	if len(pubs) > 0 {
		updated = pubs[0].Updated
		for _, p := range pubs[1:] {
			if p.Updated.After(updated) {
				updated = p.Updated
			}
		}
	}
	fmt.Fprintf(&b, "  <id>urn:litara:opds:v1:publications:%s</id>\n  <title>%s</title>\n  <updated>%s</updated>\n  <author><name>%s</name></author>\n",
		esc(q.values(q.Page).Encode()), esc(feedTitle(q)), rfc(updated), serviceTitleText)
	fmt.Fprintf(&b, "  <opensearch:totalResults>%d</opensearch:totalResults>\n  <opensearch:itemsPerPage>%d</opensearch:itemsPerPage>\n  <opensearch:startIndex>%d</opensearch:startIndex>\n",
		total, q.Size, q.Page*q.Size+1)
	atomLink(&b, relSelf, l.list(1, q, q.Page), AtomAcquisition, "", 0)
	atomLink(&b, relStart, l.root(1), AtomNavigation, "", 0)
	atomLink(&b, "search", l.root(1)+"/search.xml", OpenSearchDesc, "Search publications", 0)
	lastPage := pageCount(total, q.Size) - 1
	atomLink(&b, "first", l.list(1, q, 0), AtomAcquisition, "", 0)
	if q.Page > 0 {
		atomLink(&b, "previous", l.list(1, q, q.Page-1), AtomAcquisition, "", 0)
	}
	if q.Page < lastPage {
		atomLink(&b, "next", l.list(1, q, q.Page+1), AtomAcquisition, "", 0)
	}
	atomLink(&b, "last", l.list(1, q, lastPage), AtomAcquisition, "", 0)
	for _, p := range pubs {
		b.WriteString("  <entry>\n")
		atomEntry(&b, l, p, "    ")
		b.WriteString("  </entry>\n")
	}
	b.WriteString("</feed>\n")
	return b.Bytes()
}

// AtomPublication is a standalone entry document.
func AtomPublication(l Links, p Pub) []byte {
	var b bytes.Buffer
	atomHead(&b, "entry")
	atomEntry(&b, l, p, "  ")
	b.WriteString("</entry>\n")
	return b.Bytes()
}

// OpenSearch describes the search template.
func OpenSearch(l Links) []byte {
	var b bytes.Buffer
	b.WriteString(xmlHeader)
	fmt.Fprintf(&b, `<OpenSearchDescription xmlns="%s">`+"\n  <ShortName>Litara</ShortName>\n  <Description>Search Litara publications</Description>\n  <InputEncoding>UTF-8</InputEncoding>\n", openSearchNS)
	fmt.Fprintf(&b, `  <Url type="%s" template="%s/publications?q={searchTerms}"/>`+"\n</OpenSearchDescription>\n", attr(AtomAcquisition), attr(l.root(1)))
	return b.Bytes()
}

func feedTitle(q Query) string {
	if q.Q != "" {
		return "Search results"
	}
	return "Publications"
}

func pageCount(total int64, size int) int {
	if total <= 0 || size <= 0 {
		return 1
	}
	return int((total + int64(size) - 1) / int64(size))
}

// ---- JSON (OPDS 2.0) -------------------------------------------------------

type jLink struct {
	Rel       any    `json:"rel,omitempty"`
	Href      string `json:"href"`
	Type      string `json:"type,omitempty"`
	Title     string `json:"title,omitempty"`
	Templated bool   `json:"templated,omitempty"`
}

type jContributor struct {
	Name string `json:"name"`
}

type jSeries struct {
	Name     string   `json:"name"`
	Position *float64 `json:"position,omitempty"`
}

type jBelongs struct {
	Series []jSeries `json:"series,omitempty"`
}

type jPubMeta struct {
	Type        string         `json:"@type"`
	Identifier  string         `json:"identifier"`
	Title       string         `json:"title"`
	Author      []jContributor `json:"author,omitempty"`
	Narrator    []jContributor `json:"narrator,omitempty"`
	Language    string         `json:"language,omitempty"`
	Modified    string         `json:"modified"`
	Description string         `json:"description,omitempty"`
	Publisher   string         `json:"publisher,omitempty"`
	Published   string         `json:"published,omitempty"`
	Pages       int            `json:"numberOfPages,omitempty"`
	BelongsTo   *jBelongs      `json:"belongsTo,omitempty"`
}

type jImage struct {
	Href string `json:"href"`
	Type string `json:"type,omitempty"`
}

type jPub struct {
	Metadata jPubMeta `json:"metadata"`
	Links    []jLink  `json:"links"`
	Images   []jImage `json:"images,omitempty"`
}

func contributors(names []string) []jContributor {
	out := make([]jContributor, 0, len(names))
	for _, n := range names {
		out = append(out, jContributor{Name: n})
	}
	return out
}

func jPublication(l Links, p Pub) jPub {
	typ := "http://schema.org/Book"
	if p.Kind == "audio" {
		typ = "http://schema.org/Audiobook"
	}
	m := jPubMeta{Type: typ, Identifier: "urn:uuid:" + p.ID.String(), Title: DisplayTitle(p), Author: contributors(p.Authors),
		Narrator: contributors(p.Narrators), Modified: rfc(p.Updated), Description: Description(p)}
	if p.Language != nil {
		m.Language = *p.Language
	}
	m.Publisher, m.Published = deref(p.Publisher), deref(p.Published)
	if p.Pages != nil {
		m.Pages = *p.Pages
	}
	if p.SeriesName != nil && *p.SeriesName != "" {
		m.BelongsTo = &jBelongs{Series: []jSeries{{Name: *p.SeriesName, Position: p.SeriesIndex}}}
	}
	out := jPub{Metadata: m, Links: []jLink{
		{Rel: relSelf, Href: l.publication(2, p.ID), Type: JSONPublication},
		{Rel: relAcquisition, Href: l.acquisition(p), Type: p.MIME},
	}}
	if p.CoverMIME != nil {
		out.Images = []jImage{{Href: l.artwork(p), Type: *p.CoverMIME}}
	}
	return out
}

// JSONPublicationDoc is a standalone publication.
func JSONPublicationDoc(l Links, p Pub) []byte {
	b, _ := json.Marshal(jPublication(l, p))
	return b
}

type jNavFeed struct {
	Metadata   map[string]any `json:"metadata"`
	Links      []jLink        `json:"links"`
	Navigation []jLink        `json:"navigation"`
}

// JSONRoot is the navigation document.
func JSONRoot(l Links, libs []Library) []byte {
	search := l.root(2) + "/publications{?q,libraryId,mediaKind}"
	doc := jNavFeed{
		Metadata: map[string]any{"title": serviceTitleText},
		Links: []jLink{
			{Rel: relSelf, Href: l.root(2), Type: JSONFeed},
			{Rel: relStart, Href: l.root(2), Type: JSONFeed},
			{Rel: "search", Href: search, Type: JSONFeed, Templated: true},
		},
		Navigation: []jLink{{Rel: relSubsection, Href: l.list(2, Query{Size: 50}, 0), Type: JSONFeed, Title: "All publications"}},
	}
	for _, lib := range libs {
		id := lib.ID
		doc.Navigation = append(doc.Navigation, jLink{Rel: relSubsection, Href: l.list(2, Query{LibraryID: &id, Size: 50}, 0), Type: JSONFeed, Title: lib.Name})
	}
	b, _ := json.Marshal(doc)
	return b
}

type jFeed struct {
	Metadata     map[string]any `json:"metadata"`
	Links        []jLink        `json:"links"`
	Navigation   []jLink        `json:"navigation,omitempty"`
	Publications []jPub         `json:"publications,omitempty"` // the official schema forbids an empty array
}

// JSONFeedDoc is one page of publications.
func JSONFeedDoc(l Links, q Query, pubs []Pub, total int64) []byte {
	doc := jFeed{Metadata: map[string]any{"title": feedTitle(q), "numberOfItems": total, "itemsPerPage": q.Size, "currentPage": q.Page + 1},
		Links: []jLink{
			{Rel: relSelf, Href: l.list(2, q, q.Page), Type: JSONFeed},
			{Rel: relStart, Href: l.root(2), Type: JSONFeed},
			{Rel: "search", Href: l.root(2) + "/publications{?q,libraryId,mediaKind}", Type: JSONFeed, Templated: true},
			{Rel: "first", Href: l.list(2, q, 0), Type: JSONFeed},
		},
	}
	lastPage := pageCount(total, q.Size) - 1
	if q.Page > 0 {
		doc.Links = append(doc.Links, jLink{Rel: "previous", Href: l.list(2, q, q.Page-1), Type: JSONFeed})
	}
	if q.Page < lastPage {
		doc.Links = append(doc.Links, jLink{Rel: "next", Href: l.list(2, q, q.Page+1), Type: JSONFeed})
	}
	doc.Links = append(doc.Links, jLink{Rel: "last", Href: l.list(2, q, lastPage), Type: JSONFeed})
	for _, p := range pubs {
		doc.Publications = append(doc.Publications, jPublication(l, p))
	}
	if len(pubs) == 0 {
		// The official schema needs publications, navigation or groups: an empty
		// result links back to the catalog root instead of emitting an empty array.
		doc.Navigation = []jLink{{Rel: relStart, Href: l.root(2), Type: JSONFeed, Title: "Catalog home"}}
	}
	b, _ := json.Marshal(doc)
	return b
}
