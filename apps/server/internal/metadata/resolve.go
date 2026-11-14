// Package metadata resolves field values from competing sources with explicit
// precedence and provenance (ADR-0047/0060): protected user edits and clears,
// then an associated sidecar, then embedded values, then provider gap-filling.
package metadata

import (
	"bytes"
	"encoding/json"
	"sort"
)

// Fields that can be edited and resolved.
const (
	FieldTitle       = "title"
	FieldAuthors     = "authors"
	FieldSeriesName  = "series_name"
	FieldSeriesIndex = "series_index"
	FieldNarrators   = "narrators"
)

// Sources, highest precedence first.
const (
	SourceUser     = "user"
	SourceSidecar  = "sidecar"
	SourceEmbedded = "embedded"
	SourceProvider = "provider"
)

var rank = map[string]int{SourceUser: 0, SourceSidecar: 1, SourceEmbedded: 2, SourceProvider: 3}

// SubjectKind returns which row owns a field.
func SubjectKind(field string) string {
	if field == FieldNarrators {
		return "recording"
	}
	return "title"
}

// Valid reports whether field is editable.
func Valid(field string) bool {
	switch field {
	case FieldTitle, FieldAuthors, FieldSeriesName, FieldSeriesIndex, FieldNarrators:
		return true
	}
	return false
}

// Value is one source's value for a field. A nil Raw is "no value".
type Value struct {
	Field          string
	Source         string
	Raw            json.RawMessage
	ProtectedClear bool
}

// Effective is the winning value for a field and the provenance behind it.
type Effective struct {
	Field     string          `json:"field"`
	Source    string          `json:"source"`
	Raw       json.RawMessage `json:"value"`
	Cleared   bool            `json:"cleared"`
	Conflicts []Conflict      `json:"conflicts,omitempty"`
}

// Conflict records a lower-precedence value that disagrees with the winner.
type Conflict struct {
	Source string          `json:"source"`
	Raw    json.RawMessage `json:"value"`
}

func present(v Value) bool {
	return v.ProtectedClear || len(bytes.TrimSpace(v.Raw)) > 0 && string(bytes.TrimSpace(v.Raw)) != "null"
}

// canonical makes equal JSON compare equal regardless of spacing/key order.
func canonical(raw json.RawMessage) string {
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return string(raw)
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// Resolve picks the winner per field. A protected clear wins and yields an
// empty value that lower sources can never refill (ADR-0047). Provider values
// only fill a field that no other source provided.
func Resolve(values []Value) map[string]Effective {
	byField := map[string][]Value{}
	for _, v := range values {
		if present(v) {
			byField[v.Field] = append(byField[v.Field], v)
		}
	}
	out := map[string]Effective{}
	for f, vs := range byField {
		sort.SliceStable(vs, func(i, j int) bool { return rank[vs[i].Source] < rank[vs[j].Source] })
		win := vs[0]
		e := Effective{Field: f, Source: win.Source, Raw: win.Raw, Cleared: win.ProtectedClear}
		if win.ProtectedClear {
			e.Raw = nil
		}
		for _, o := range vs[1:] {
			if win.ProtectedClear || canonical(o.Raw) != canonical(win.Raw) {
				e.Conflicts = append(e.Conflicts, Conflict{Source: o.Source, Raw: o.Raw})
			}
		}
		out[f] = e
	}
	return out
}
