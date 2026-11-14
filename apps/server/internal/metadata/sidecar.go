package metadata

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"strconv"
	"strings"
)

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
			Titles   []string `xml:"title"`
			Creators []struct {
				Role string `xml:"role,attr"`
				Text string `xml:",chardata"`
			} `xml:"creator"`
			Metas []struct {
				Name    string `xml:"name,attr"`
				Content string `xml:"content,attr"`
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
