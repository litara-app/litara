package metadata

import (
	"encoding/json"
	"strings"
	"testing"
)

func str(t *testing.T, f Fields, k string) string {
	t.Helper()
	var v string
	if raw, ok := f[k]; ok {
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatalf("%s: %v", k, err)
		}
	}
	return v
}

func TestLitaraJSONDescriptiveFields(t *testing.T) {
	f, err := ParseLitaraJSON([]byte(`{"title":"T","publisher":" Old House ","published":"1895-05","isbn":"978-3-16-148410-0","description":"A traveller builds a machine."}`))
	if err != nil {
		t.Fatal(err)
	}
	if str(t, f, FieldPublisher) != "Old House" || str(t, f, FieldPublished) != "1895-05" || str(t, f, FieldISBN) != "9783161484100" || str(t, f, FieldDescription) == "" {
		t.Fatalf("%v", f)
	}
	for name, body := range map[string]string{
		"bad date":    `{"published":"1895-13"}`,
		"bad isbn":    `{"isbn":"12345"}`,
		"long text":   `{"description":"` + strings.Repeat("x", MaxDescription+1) + `"}`,
		"unknown key": `{"publisherName":"x"}`,
	} {
		if _, err := ParseLitaraJSON([]byte(body)); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestOPFAndTagDescriptiveFields(t *testing.T) {
	f, err := ParseOPF([]byte(`<package xmlns:dc="x"><metadata><dc:title>T</dc:title><dc:publisher>Old House</dc:publisher><dc:date>1895-05-07T00:00:00Z</dc:date>` +
		`<dc:identifier>urn:uuid:abc</dc:identifier><dc:identifier>urn:isbn:9783161484100</dc:identifier><dc:description>Hi there.</dc:description></metadata></package>`))
	if err != nil {
		t.Fatal(err)
	}
	if str(t, f, FieldPublisher) != "Old House" || str(t, f, FieldPublished) != "1895-05-07" || str(t, f, FieldISBN) != "9783161484100" || str(t, f, FieldDescription) != "Hi there." {
		t.Fatalf("%v", f)
	}
	g := FromTags(map[string]string{"album": "A", "publisher": "Audible Studios", "date": "2019-03-12"})
	if str(t, g, FieldPublisher) != "Audible Studios" || str(t, g, FieldPublished) != "2019-03-12" {
		t.Fatalf("%v", g)
	}
	for _, field := range []string{FieldPublisher, FieldPublished, FieldISBN, FieldDescription} {
		if !Valid(field) {
			t.Errorf("%s is not editable", field)
		}
	}
	if validate(FieldISBN, json.RawMessage(`"9783161484100"`)) != nil || validate(FieldISBN, json.RawMessage(`"978-3-16"`)) == nil || validate(FieldPublished, json.RawMessage(`"2020-02"`)) != nil {
		t.Fatal("validation")
	}
}
