package reading

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func ids() (string, string) { return uuid.NewString(), uuid.NewString() }

func data(kind string, loc wire.T005Locator, sel *wire.T005Selection, text string) wire.T005AnnotationData {
	f, v := ids()
	return wire.T005AnnotationData{Kind: kind, Text: text, Anchor: wire.T005Anchor{FileID: f, ContentVersion: v, Locator: loc}, Selection: wire.Some(sel)}
}

func TestValidateAnnotationRules(t *testing.T) {
	cfi := wire.T005Locator{CFI: &wire.T005CFI{Kind: "foliate-cfi", Version: 1, CFI: "epubcfi(/6/2)"}}
	pdf := wire.T005Locator{PDF: &wire.T005PDF{Kind: "pdf-page", Version: 1, PageIndex: 3, X: .1, Y: .2}}
	comic := wire.T005Locator{Comic: &wire.T005Comic{Kind: "comic-page", Version: 1, PageIndex: 1, EntryID: strings.Repeat("a", 64), ManifestVersion: uuid.NewString()}}
	rng := &wire.T005Selection{CFI: &wire.T005CFIRange{Kind: "foliate-range", Version: 1, CFI: "epubcfi(/6/2,/1:0,/1:3)"}}
	rects := func(page int) *wire.T005Selection {
		return &wire.T005Selection{PDF: &wire.T005PDFRange{Kind: "pdf-rectangles", Version: 1, PageIndex: page,
			Rectangles: []wire.T005Rectangle{{X: .1, Y: .1, Width: .2, Height: .05}}}}
	}
	epub, pdfEd, cbz := edition{Format: "epub"}, edition{Format: "pdf"}, edition{Format: "cbz"}
	cases := []struct {
		name string
		ed   edition
		d    wire.T005AnnotationData
		ok   bool
	}{
		{"epub highlight", epub, data("highlight", cfi, rng, ""), true},
		{"pdf highlight on its page", pdfEd, data("highlight", pdf, rects(3), ""), true},
		{"pdf highlight on another page", pdfEd, data("highlight", pdf, rects(4), ""), false},
		{"pdf locator with a CFI range", pdfEd, data("highlight", pdf, rng, ""), false},
		{"highlight without a selection", epub, data("highlight", cfi, nil, ""), false},
		{"comic highlight", cbz, data("highlight", comic, rng, ""), false},
		{"comic page note", cbz, data("note", comic, nil, "page is great"), true},
		{"comic bookmark", cbz, data("bookmark", comic, nil, ""), true},
		{"note without text", epub, data("note", cfi, nil, "   "), false},
		{"note over a range", epub, data("note", cfi, rng, "text"), true},
		{"bookmark with text", epub, data("bookmark", cfi, nil, "label"), true},
		{"bookmark with a selection", epub, data("bookmark", cfi, rng, ""), false},
		{"unknown kind", epub, data("sticker", cfi, nil, "x"), false},
	}
	for _, c := range cases {
		if err := validateAnnotation(c.ed, c.d); (err == nil) != c.ok {
			t.Errorf("%s: err=%v want ok=%v", c.name, err, c.ok)
		}
	}
}

func TestValidateFilterBounds(t *testing.T) {
	p := func(field, op, v string) wire.T005Filter {
		return wire.T005Filter{Predicate: &wire.T005Predicate{Kind: "predicate", Field: field, Operator: op, Value: v}}
	}
	not := func(f wire.T005Filter) wire.T005Filter {
		return wire.T005Filter{Not: &wire.T005FilterNot{Kind: "not", Child: f}}
	}
	group := func(fs ...wire.T005Filter) wire.T005Filter {
		return wire.T005Filter{Group: &wire.T005FilterGroup{Kind: "all", Children: fs}}
	}
	if err := ValidateFilter(not(not(not(p("title", "contains", "x"))))); err != nil {
		t.Fatalf("depth 4: %v", err)
	}
	if err := ValidateFilter(not(not(not(not(p("title", "contains", "x")))))); err == nil {
		t.Fatal("depth 5 must be rejected")
	}
	many := make([]wire.T005Filter, 0, 32)
	for i := 0; i < 32; i++ {
		many = append(many, p("title", "contains", "x"))
	}
	if err := ValidateFilter(group(many...)); err != nil {
		t.Fatalf("32 predicates: %v", err)
	}
	if err := ValidateFilter(group(group(many...), p("title", "contains", "y"))); err == nil {
		t.Fatal("33 predicates must be rejected")
	}
	if err := ValidateFilter(p("title", "contains", strings.Repeat("a", 513))); err == nil {
		t.Fatal("over-long value")
	}
	for _, bad := range []wire.T005Filter{
		p("finished", "contains", "true"), p("inProgress", "equals", "TRUE"), p("mediaKind", "equals", "video"),
		p("format", "equals", "exe"), p("format", "contains", "epub"), p("title", "like", "x"), p("nonsense", "equals", "x"),
	} {
		if ValidateFilter(bad) == nil {
			t.Errorf("accepted %+v", *bad.Predicate)
		}
	}
	// Folding: NFC plus lower case, so a decomposed accent equals the composed one.
	if fold("Café") != fold("CAFÉ") {
		t.Error("NFC folding")
	}
}
