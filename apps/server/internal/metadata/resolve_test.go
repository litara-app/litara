package metadata_test

import (
	"encoding/json"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

func raw(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

func TestPrecedenceUserSidecarEmbeddedProvider(t *testing.T) {
	vals := []metadata.Value{
		{Field: "title", Source: "provider", Raw: raw("Provider Title")},
		{Field: "title", Source: "embedded", Raw: raw("Embedded Title")},
		{Field: "title", Source: "sidecar", Raw: raw("Sidecar Title")},
		{Field: "authors", Source: "embedded", Raw: raw([]string{"E"})},
		{Field: "narrators", Source: "provider", Raw: raw([]string{"P"})},
	}
	eff := metadata.Resolve(vals)
	if e := eff["title"]; e.Source != "sidecar" || string(e.Raw) != `"Sidecar Title"` || len(e.Conflicts) != 2 {
		t.Fatalf("sidecar beats embedded and provider, conflicts reported: %+v", e)
	}
	if eff["authors"].Source != "embedded" || eff["narrators"].Source != "provider" {
		t.Fatalf("lower sources fill only where nothing outranks them: %+v", eff)
	}
	vals = append(vals, metadata.Value{Field: "title", Source: "user", Raw: raw("Mine")})
	if e := metadata.Resolve(vals)["title"]; e.Source != "user" || string(e.Raw) != `"Mine"` {
		t.Fatalf("user edit wins: %+v", e)
	}
}

func TestProtectedClearIsNeverRefilled(t *testing.T) {
	eff := metadata.Resolve([]metadata.Value{
		{Field: "series_name", Source: "user", ProtectedClear: true},
		{Field: "series_name", Source: "sidecar", Raw: raw("Saga")},
		{Field: "series_name", Source: "embedded", Raw: raw("Saga")},
	})
	e := eff["series_name"]
	if !e.Cleared || e.Raw != nil || e.Source != "user" || len(e.Conflicts) != 2 {
		t.Fatalf("a deliberate clear must stay empty and report what it suppressed: %+v", e)
	}
}

func TestEqualValuesAreNotConflicts(t *testing.T) {
	e := metadata.Resolve([]metadata.Value{
		{Field: "authors", Source: "sidecar", Raw: json.RawMessage(`["A", "B"]`)},
		{Field: "authors", Source: "embedded", Raw: json.RawMessage(`["A","B"]`)},
	})["authors"]
	if len(e.Conflicts) != 0 {
		t.Fatalf("formatting differences are not conflicts: %+v", e)
	}
}

func TestParseLitaraJSON(t *testing.T) {
	f, err := metadata.ParseLitaraJSON([]byte(`{"title":" T ","authors":["A"," "],"narrators":["N"],"series":{"name":"S","index":2.5}}`))
	if err != nil || string(f["title"]) != `"T"` || string(f["authors"]) != `["A"]` || string(f["series_index"]) != `2.5` {
		t.Fatalf("%v %v", f, err)
	}
	for _, bad := range []string{`{"title":5}`, `{"unknown":1}`, `[]`, `{`} {
		if _, err := metadata.ParseLitaraJSON([]byte(bad)); err == nil {
			t.Errorf("must reject %s", bad)
		}
	}
}

func TestParseOPF(t *testing.T) {
	f, err := metadata.ParseOPF([]byte(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<metadata><dc:title>OPF Title</dc:title><dc:creator opf:role="aut">An Author</dc:creator><dc:creator opf:role="nrt">A Narrator</dc:creator>
<meta name="calibre:series" content="The Series"/><meta name="calibre:series_index" content="3"/></metadata></package>`))
	if err != nil {
		t.Fatal(err)
	}
	if string(f["title"]) != `"OPF Title"` || string(f["authors"]) != `["An Author"]` || string(f["narrators"]) != `["A Narrator"]` ||
		string(f["series_name"]) != `"The Series"` || string(f["series_index"]) != `3` {
		t.Fatalf("%s", mustJSON(f))
	}
	if _, err := metadata.ParseOPF([]byte(`<not-xml`)); err == nil {
		t.Fatal("malformed OPF must be rejected")
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

func TestSplitIdentifier(t *testing.T) {
	cases := map[string][2]string{"978-0-306-40615-7": {"9780306406157", ""}, "B000TEST01": {"", "B000TEST01"}, "0306406152": {"0306406152", ""}, "nonsense": {"", ""}}
	for in, want := range cases {
		i, a := metadata.SplitIdentifier(in)
		if i != want[0] || a != want[1] {
			t.Errorf("%q => %q %q", in, i, a)
		}
	}
}
