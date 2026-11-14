// Package ebookmeta reads bounded descriptive metadata from ebook containers
// using only the Go standard library (ADR-0065; no FFmpeg, no parser code
// copied from AGPL sources). Failures are reported, never fatal: callers fall
// back to the file name and record the issue.
package ebookmeta

import (
	"archive/zip"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path"
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

type opf struct {
	Title       []string  `xml:"metadata>title"`
	Creator     []string  `xml:"metadata>creator"`
	Language    []string  `xml:"metadata>language"`
	Identifiers []string  `xml:"metadata>identifier"`
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
	m := Meta{Source: "embedded", Title: first(o.Title), Language: first(o.Language)}
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
	return m, nil
}

type comicInfo struct {
	Title    string `xml:"Title"`
	Series   string `xml:"Series"`
	Number   string `xml:"Number"`
	Writer   string `xml:"Writer"`
	Language string `xml:"LanguageISO"`
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
	m := Meta{Source: "embedded", Title: clean(ci.Title), Series: clean(ci.Series), Language: clean(ci.Language), SeriesIndex: num(ci.Number)}
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
	} `xml:"description>title-info"`
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
		Series: clean(d.Info.Sequence.Name), SeriesIndex: num(d.Info.Sequence.Number)}
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
