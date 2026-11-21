// Package ebookmeta reads bounded descriptive metadata from ebook containers
// using only the Go standard library (ADR-0065; no FFmpeg, no parser code
// copied from AGPL sources). Failures are reported, never fatal: callers fall
// back to the file name and record the issue.
package ebookmeta

import (
	"archive/zip"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"path"
	"regexp"
	"strconv"
	"strings"
)

// Limits bound memory and work for untrusted containers.
const (
	maxEntries  = 10000
	maxXMLBytes = 1 << 20
)

// Meta is what could be read; empty fields were not present.
type Meta struct {
	Title       string
	Authors     []string
	Language    string
	Series      string
	SeriesIndex *float64
	Identifier  string // ISBN or other strong identifier (dc:identifier)
	Publisher   string
	Published   string // YYYY, YYYY-MM or YYYY-MM-DD
	Description string // plain text, markup removed
	PageCount   *int
	Source      string // embedded | filename
}

// ErrUnsupported means the format has no embedded metadata reader here.
var ErrUnsupported = errors.New("no embedded metadata reader for this format")

// Read dispatches on format ("epub", "kepub", "fb2", "cbz").
func Read(abs, format string) (Meta, error) {
	switch format {
	case "epub", "kepub":
		return readEPUB(abs)
	case "cbz":
		return readComicInfo(abs)
	case "fb2":
		return readFB2(abs)
	}
	return Meta{}, ErrUnsupported
}

func openZip(abs string) (*zip.ReadCloser, error) {
	zr, err := zip.OpenReader(abs)
	if err != nil {
		return nil, err
	}
	if len(zr.File) > maxEntries {
		zr.Close()
		return nil, fmt.Errorf("archive has more than %d entries", maxEntries)
	}
	return zr, nil
}

func readEntry(zr *zip.ReadCloser, name string) ([]byte, error) {
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		if f.UncompressedSize64 > maxXMLBytes {
			return nil, fmt.Errorf("%s exceeds %d bytes", name, maxXMLBytes)
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		b, err := io.ReadAll(io.LimitReader(rc, maxXMLBytes+1))
		if err != nil {
			return nil, err
		}
		if len(b) > maxXMLBytes {
			return nil, fmt.Errorf("%s exceeds %d bytes", name, maxXMLBytes)
		}
		return b, nil
	}
	return nil, fmt.Errorf("%s not found", name)
}

type container struct {
	Rootfiles []struct {
		FullPath string `xml:"full-path,attr"`
	} `xml:"rootfiles>rootfile"`
}

type opfMeta struct {
	Name     string `xml:"name,attr"`
	Content  string `xml:"content,attr"`
	Property string `xml:"property,attr"`
	Text     string `xml:",chardata"`
}

type opfDate struct {
	Event string `xml:"event,attr"`
	Text  string `xml:",chardata"`
}

type opf struct {
	Title       []string  `xml:"metadata>title"`
	Creator     []string  `xml:"metadata>creator"`
	Language    []string  `xml:"metadata>language"`
	Identifiers []string  `xml:"metadata>identifier"`
	Publisher   []string  `xml:"metadata>publisher"`
	Date        []opfDate `xml:"metadata>date"`
	Description []string  `xml:"metadata>description"`
	Meta        []opfMeta `xml:"metadata>meta"`
}

func readEPUB(abs string) (Meta, error) {
	zr, err := openZip(abs)
	if err != nil {
		return Meta{}, err
	}
	defer zr.Close()
	cb, err := readEntry(zr, "META-INF/container.xml")
	if err != nil {
		return Meta{}, err
	}
	var c container
	if err := xml.Unmarshal(cb, &c); err != nil || len(c.Rootfiles) == 0 {
		return Meta{}, errors.New("container.xml has no rootfile")
	}
	root := path.Clean(c.Rootfiles[0].FullPath)
	if strings.HasPrefix(root, "..") || path.IsAbs(root) {
		return Meta{}, errors.New("rootfile path escapes the archive")
	}
	ob, err := readEntry(zr, root)
	if err != nil {
		return Meta{}, err
	}
	var o opf
	if err := xml.Unmarshal(ob, &o); err != nil {
		return Meta{}, fmt.Errorf("opf: %w", err)
	}
	m := Meta{Source: "embedded", Title: first(o.Title), Language: first(o.Language), Publisher: first(o.Publisher)}
	for _, d := range o.Date {
		if strings.EqualFold(d.Event, "modification") {
			continue // the file's last-modified stamp is not the publication date
		}
		if p := normDate(d.Text); p != "" {
			m.Published = p
			break
		}
	}
	for _, d := range o.Description {
		if t := stripMarkup(d); t != "" {
			m.Description = t
			break
		}
	}
	for _, a := range o.Creator {
		if a = clean(a); a != "" {
			m.Authors = append(m.Authors, a)
		}
	}
	for _, id := range o.Identifiers {
		if isbn := normISBN(id); isbn != "" {
			m.Identifier = isbn
			break
		}
	}
	for _, mt := range o.Meta {
		switch {
		case mt.Name == "calibre:series" && m.Series == "":
			m.Series = clean(mt.Content)
		case mt.Name == "calibre:series_index" && m.SeriesIndex == nil:
			m.SeriesIndex = num(mt.Content)
		case mt.Property == "belongs-to-collection" && m.Series == "":
			m.Series = clean(mt.Text)
		case mt.Property == "group-position" && m.SeriesIndex == nil:
			m.SeriesIndex = num(mt.Text)
		}
	}
	m.PageCount = opfPageCount(o.Meta)
	return m, nil
}

type comicInfo struct {
	Title     string `xml:"Title"`
	Series    string `xml:"Series"`
	Number    string `xml:"Number"`
	Writer    string `xml:"Writer"`
	Language  string `xml:"LanguageISO"`
	Publisher string `xml:"Publisher"`
	Year      string `xml:"Year"`
	Month     string `xml:"Month"`
	Day       string `xml:"Day"`
	Summary   string `xml:"Summary"`
	Pages     string `xml:"PageCount"`
}

func readComicInfo(abs string) (Meta, error) {
	zr, err := openZip(abs)
	if err != nil {
		return Meta{}, err
	}
	defer zr.Close()
	b, err := readEntry(zr, "ComicInfo.xml")
	if err != nil {
		return Meta{}, err
	}
	var ci comicInfo
	if err := xml.Unmarshal(b, &ci); err != nil {
		return Meta{}, fmt.Errorf("ComicInfo.xml: %w", err)
	}
	m := Meta{Source: "embedded", Title: clean(ci.Title), Series: clean(ci.Series), Language: clean(ci.Language), SeriesIndex: num(ci.Number),
		Publisher: clean(ci.Publisher), Description: stripMarkup(ci.Summary), PageCount: count(ci.Pages)}
	if y := strings.TrimSpace(ci.Year); len(y) == 4 {
		m.Published = normDate(strings.Trim(y+"-"+pad2(ci.Month)+"-"+pad2(ci.Day), "-"))
	}
	for _, a := range strings.Split(ci.Writer, ",") {
		if a = clean(a); a != "" {
			m.Authors = append(m.Authors, a)
		}
	}
	return m, nil
}

type fb2Author struct {
	First  string `xml:"first-name"`
	Middle string `xml:"middle-name"`
	Last   string `xml:"last-name"`
}

type fb2 struct {
	Info struct {
		Title    string      `xml:"book-title"`
		Lang     string      `xml:"lang"`
		Authors  []fb2Author `xml:"author"`
		Sequence struct {
			Name   string `xml:"name,attr"`
			Number string `xml:"number,attr"`
		} `xml:"sequence"`
		Annotation struct {
			Inner string `xml:",innerxml"`
		} `xml:"annotation"`
	} `xml:"description>title-info"`
	Publish struct {
		Publisher string `xml:"publisher"`
		Year      string `xml:"year"`
	} `xml:"description>publish-info"`
}

func readFB2(abs string) (Meta, error) {
	f, err := openLimited(abs)
	if err != nil {
		return Meta{}, err
	}
	var d fb2
	if err := xml.NewDecoder(f).Decode(&d); err != nil {
		return Meta{}, fmt.Errorf("fb2: %w", err)
	}
	m := Meta{Source: "embedded", Title: clean(d.Info.Title), Language: clean(d.Info.Lang),
		Series: clean(d.Info.Sequence.Name), SeriesIndex: num(d.Info.Sequence.Number),
		Publisher: clean(d.Publish.Publisher), Published: normDate(d.Publish.Year), Description: stripMarkup(d.Info.Annotation.Inner)}
	for _, a := range d.Info.Authors {
		if n := clean(strings.Join([]string{a.First, a.Middle, a.Last}, " ")); n != "" {
			m.Authors = append(m.Authors, n)
		}
	}
	return m, nil
}

func first(v []string) string {
	for _, s := range v {
		if s = clean(s); s != "" {
			return s
		}
	}
	return ""
}

func clean(s string) string { return strings.Join(strings.Fields(s), " ") }

func num(s string) *float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || f < 0 {
		return nil
	}
	return &f
}

// normISBN returns a bare ISBN-10/13 from "urn:isbn:978-..." style values.
func normISBN(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimPrefix(s, "urn:isbn:")
	s = strings.TrimPrefix(s, "isbn:")
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9', r == 'x':
			b.WriteRune(r)
		case r == '-' || r == ' ':
		default:
			return ""
		}
	}
	if n := b.Len(); n != 10 && n != 13 {
		return ""
	}
	return strings.ToUpper(b.String())
}

var markup = regexp.MustCompile(`<[^>]*>`)

// stripMarkup turns an embedded description (often HTML or XHTML) into plain text: paragraph and line breaks become
// blank-line and line breaks, tags and entities are removed, and the result is bounded.
func stripMarkup(s string) string {
	s = strings.NewReplacer("</p>", "\n\n", "<br>", "\n", "<br/>", "\n", "<br />", "\n", "</div>", "\n").Replace(s)
	s = html.UnescapeString(markup.ReplaceAllString(s, ""))
	lines := strings.Split(strings.ReplaceAll(s, "\r", ""), "\n")
	var out []string
	blank := false
	for _, l := range lines {
		l = clean(l)
		if l == "" {
			blank = len(out) > 0
			continue
		}
		if blank {
			out = append(out, "")
			blank = false
		}
		out = append(out, l)
	}
	r := []rune(strings.Join(out, "\n"))
	if len(r) > maxDescription {
		r = r[:maxDescription]
	}
	return strings.TrimSpace(string(r))
}

const maxDescription = 8000

// PlainText is how a description reads back from a file: markup removed, whitespace tidied and bounded.
func PlainText(s string) string { return stripMarkup(s) }

// normDate keeps the leading year, month and day of a date as YYYY, YYYY-MM or YYYY-MM-DD, or returns "".
func normDate(s string) string {
	m := dateRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return ""
	}
	out := m[1]
	if m[2] != "" {
		if mo, _ := strconv.Atoi(m[2]); mo >= 1 && mo <= 12 {
			out += "-" + m[2]
			if m[3] != "" {
				if d, _ := strconv.Atoi(m[3]); d >= 1 && d <= 31 {
					out += "-" + m[3]
				}
			}
		}
	}
	return out
}

var dateRe = regexp.MustCompile(`^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?`)

func pad2(s string) string {
	s = strings.TrimSpace(s)
	if len(s) == 1 {
		return "0" + s
	}
	return s
}

func count(s string) *int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n <= 0 || n > 100000 {
		return nil
	}
	return &n
}

// opfPageCount reads a page count the way other library tools write it: Litara's own litara:page_count, BookOrbit's
// bookorbit:page_count (as a property or a name/content pair) and a Calibre custom column named #pagecount or #page_count.
// A count is never estimated from the book's text.
func opfPageCount(metas []opfMeta) *int {
	rank := func(mt opfMeta) (int, string) {
		switch {
		case mt.Name == "litara:page_count":
			return 1, mt.Content
		case mt.Property == "litara:page_count":
			return 1, mt.Text
		case mt.Name == "bookorbit:page_count":
			return 2, mt.Content
		case mt.Property == "bookorbit:page_count":
			return 2, mt.Text
		case mt.Name == "calibre:user_metadata:#pagecount" || mt.Name == "calibre:user_metadata:#page_count":
			var col struct {
				Value any `json:"#value#"`
			}
			if json.Unmarshal([]byte(mt.Content), &col) == nil {
				switch v := col.Value.(type) {
				case float64:
					return 3, strconv.FormatFloat(v, 'f', -1, 64)
				case string:
					return 3, v
				}
			}
		}
		return 0, ""
	}
	best, bestRank := (*int)(nil), 99
	for _, mt := range metas {
		if r, text := rank(mt); r > 0 && r < bestRank {
			if n := count(text); n != nil {
				best, bestRank = n, r
			}
		}
	}
	return best
}
