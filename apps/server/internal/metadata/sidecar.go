package metadata

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Bounds and shapes shared by every place a descriptive field is accepted (ADR-0081).
const MaxDescription = 8000

var (
	publishedRe = regexp.MustCompile(`^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$`)
	isbnRe      = regexp.MustCompile(`^(\d{9}[\dX]|\d{13})$`)
	dateLead    = regexp.MustCompile(`^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?`)
)

// normPublished keeps the leading year, month and day of a date as YYYY, YYYY-MM or YYYY-MM-DD, or returns "".
func normPublished(s string) string {
	m := dateLead.FindStringSubmatch(strings.TrimSpace(s))
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

// normISBN returns a bare ISBN-10/13 from "urn:isbn:978-..." or "978-..." text, or "".
func normISBN(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimPrefix(strings.TrimPrefix(s, "urn:isbn:"), "isbn:")
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

// MaxSidecarBytes bounds what is read from a sidecar.
const MaxSidecarBytes = 1 << 20

// Fields is a sidecar's or provider's proposed values, keyed by field.
type Fields map[string]json.RawMessage

func set(f Fields, field string, v any) {
	b, _ := json.Marshal(v)
	f[field] = b
}

// ParseLitaraJSON reads {"title","authors","narrators","series":{"name","index"}}.
// Unknown or mistyped members reject the whole file.
func ParseLitaraJSON(data []byte) (Fields, error) {
	if len(data) > MaxSidecarBytes {
		return nil, fmt.Errorf("sidecar too large")
	}
	var in struct {
		Title     *string  `json:"title"`
		Authors   []string `json:"authors"`
		Narrators []string `json:"narrators"`
		Series    *struct {
			Name  string   `json:"name"`
			Index *float64 `json:"index"`
		} `json:"series"`
		Publisher   *string  `json:"publisher"`
		Published   *string  `json:"published"`
		ISBN        *string  `json:"isbn"`
		Description *string  `json:"description"`
		Language    *string  `json:"language"`
		Tags        []string `json:"tags"`
		PageCount   *int     `json:"pageCount"`
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		return nil, fmt.Errorf("invalid Litara JSON: %w", err)
	}
	f := Fields{}
	if in.Title != nil && strings.TrimSpace(*in.Title) != "" {
		set(f, FieldTitle, strings.TrimSpace(*in.Title))
	}
	if a := clean(in.Authors); len(a) > 0 {
		set(f, FieldAuthors, a)
	}
	if n := clean(in.Narrators); len(n) > 0 {
		set(f, FieldNarrators, n)
	}
	if in.Series != nil {
		if strings.TrimSpace(in.Series.Name) != "" {
			set(f, FieldSeriesName, strings.TrimSpace(in.Series.Name))
		}
		if in.Series.Index != nil {
			set(f, FieldSeriesIndex, *in.Series.Index)
		}
	}
	if in.Language != nil && strings.TrimSpace(*in.Language) != "" {
		if len([]rune(*in.Language)) > 128 {
			return nil, fmt.Errorf("invalid Litara JSON: language is longer than 128 characters")
		}
		set(f, FieldLanguage, strings.TrimSpace(*in.Language))
	}
	if t := clean(in.Tags); len(t) > 0 {
		if len(t) > 100 {
			return nil, fmt.Errorf("invalid Litara JSON: more than 100 tags")
		}
		set(f, FieldTags, t)
	}
	if in.PageCount != nil {
		if *in.PageCount < 1 || *in.PageCount > 100000 {
			return nil, fmt.Errorf("invalid Litara JSON: pageCount must be 1 to 100000")
		}
		set(f, FieldPageCount, *in.PageCount)
	}
	if in.Publisher != nil && strings.TrimSpace(*in.Publisher) != "" {
		if len([]rune(*in.Publisher)) > 512 {
			return nil, fmt.Errorf("invalid Litara JSON: publisher is longer than 512 characters")
		}
		set(f, FieldPublisher, strings.TrimSpace(*in.Publisher))
	}
	if in.Published != nil && strings.TrimSpace(*in.Published) != "" {
		if !publishedRe.MatchString(*in.Published) {
			return nil, fmt.Errorf("invalid Litara JSON: published must be YYYY, YYYY-MM or YYYY-MM-DD")
		}
		set(f, FieldPublished, *in.Published)
	}
	if in.ISBN != nil && strings.TrimSpace(*in.ISBN) != "" {
		isbn := normISBN(*in.ISBN)
		if isbn == "" {
			return nil, fmt.Errorf("invalid Litara JSON: isbn must be an ISBN-10 or ISBN-13")
		}
		set(f, FieldISBN, isbn)
	}
	if in.Description != nil && strings.TrimSpace(*in.Description) != "" {
		if len([]rune(*in.Description)) > MaxDescription {
			return nil, fmt.Errorf("invalid Litara JSON: description is longer than %d characters", MaxDescription)
		}
		set(f, FieldDescription, strings.TrimSpace(*in.Description))
	}
	return f, nil
}

func clean(in []string) []string {
	var out []string
	for _, s := range in {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// ParseOPF reads Dublin Core title/creator and Calibre series metadata from an
// OPF package. DOCTYPE/entity tricks are not interpreted (encoding/xml never
// fetches external entities).
func ParseOPF(data []byte) (Fields, error) {
	if len(data) > MaxSidecarBytes {
		return nil, fmt.Errorf("sidecar too large")
	}
	var pkg struct {
		Metadata struct {
			Titles      []string `xml:"title"`
			Publishers  []string `xml:"publisher"`
			Dates       []string `xml:"date"`
			Identifiers []string `xml:"identifier"`
			Descs       []string `xml:"description"`
			Languages   []string `xml:"language"`
			Subjects    []string `xml:"subject"`
			Creators    []struct {
				Role string `xml:"role,attr"`
				Text string `xml:",chardata"`
			} `xml:"creator"`
			Metas []struct {
				Name     string `xml:"name,attr"`
				Content  string `xml:"content,attr"`
				Property string `xml:"property,attr"`
				Text     string `xml:",chardata"`
			} `xml:"meta"`
		} `xml:"metadata"`
	}
	if err := xml.Unmarshal(data, &pkg); err != nil {
		return nil, fmt.Errorf("invalid OPF: %w", err)
	}
	f := Fields{}
	for _, t := range pkg.Metadata.Titles {
		if t = strings.TrimSpace(t); t != "" {
			set(f, FieldTitle, t)
			break
		}
	}
	for _, p := range pkg.Metadata.Publishers {
		if p = strings.TrimSpace(p); p != "" && len([]rune(p)) <= 512 {
			set(f, FieldPublisher, p)
			break
		}
	}
	for _, d := range pkg.Metadata.Dates {
		if p := normPublished(d); p != "" {
			set(f, FieldPublished, p)
			break
		}
	}
	for _, id := range pkg.Metadata.Identifiers {
		if isbn := normISBN(id); isbn != "" {
			set(f, FieldISBN, isbn)
			break
		}
	}
	for _, d := range pkg.Metadata.Descs {
		if d = strings.TrimSpace(d); d != "" && len([]rune(d)) <= MaxDescription {
			set(f, FieldDescription, d)
			break
		}
	}
	for _, l := range pkg.Metadata.Languages {
		if l = strings.TrimSpace(l); l != "" && len([]rune(l)) <= 128 {
			set(f, FieldLanguage, l)
			break
		}
	}
	if t := clean(pkg.Metadata.Subjects); len(t) > 0 && len(t) <= 100 {
		set(f, FieldTags, t)
	}
	var authors, narrators []string
	for _, c := range pkg.Metadata.Creators {
		name := strings.TrimSpace(c.Text)
		if name == "" {
			continue
		}
		if strings.EqualFold(c.Role, "nrt") {
			narrators = append(narrators, name)
		} else if c.Role == "" || strings.EqualFold(c.Role, "aut") {
			authors = append(authors, name)
		}
	}
	if len(authors) > 0 {
		set(f, FieldAuthors, authors)
	}
	if len(narrators) > 0 {
		set(f, FieldNarrators, narrators)
	}
	for _, m := range pkg.Metadata.Metas {
		switch m.Name {
		case "calibre:series":
			if s := strings.TrimSpace(m.Content); s != "" {
				set(f, FieldSeriesName, s)
			}
		case "calibre:series_index":
			if n, err := strconv.ParseFloat(strings.TrimSpace(m.Content), 64); err == nil {
				set(f, FieldSeriesIndex, n)
			}
		case "litara:page_count", "bookorbit:page_count":
			if n, err := strconv.Atoi(strings.TrimSpace(m.Content)); err == nil && n >= 1 && n <= 100000 {
				set(f, FieldPageCount, n)
			}
		}
		if m.Property == "litara:page_count" || m.Property == "bookorbit:page_count" {
			if n, err := strconv.Atoi(strings.TrimSpace(m.Text)); err == nil && n >= 1 && n <= 100000 {
				set(f, FieldPageCount, n)
			}
		}
	}
	return f, nil
}

// FromTags maps embedded tags to fields. Narrator is only read from an explicit
// narrator tag; composer and similar fields are not guessed.
func FromTags(tags map[string]string) Fields {
	get := func(names ...string) string {
		for _, want := range names {
			for k, v := range tags {
				if strings.EqualFold(k, want) && strings.TrimSpace(v) != "" {
					return strings.TrimSpace(v)
				}
			}
		}
		return ""
	}
	f := Fields{}
	if v := get("album"); v != "" {
		set(f, FieldTitle, v)
	}
	if v := get("album_artist", "artist"); v != "" {
		set(f, FieldAuthors, []string{v})
	}
	if v := get("narrator"); v != "" {
		set(f, FieldNarrators, []string{v})
	}
	if v := get("publisher"); v != "" && len([]rune(v)) <= 512 {
		set(f, FieldPublisher, v)
	}
	if v := get("description"); v != "" && len([]rune(v)) <= MaxDescription {
		set(f, FieldDescription, v)
	}
	if v := normISBN(get("isbn")); v != "" {
		set(f, FieldISBN, v)
	}
	if v := normPublished(get("date", "year")); v != "" {
		set(f, FieldPublished, v)
	}
	if v := get("series"); v != "" {
		set(f, FieldSeriesName, v)
	}
	if v := get("series-part", "series_part"); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			set(f, FieldSeriesIndex, n)
		}
	}
	return f
}
