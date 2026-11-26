package reading

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func ids() (string, string) { return uuid.NewString(), uuid.NewString() }

func data(kind string, loc wire.Locator, sel *wire.Selection, text string) wire.AnnotationData {
	f, v := ids()
	return wire.AnnotationData{Kind: kind, Text: text, Anchor: wire.EditionAnchor{FileID: f, ContentVersion: v, Locator: loc}, Selection: wire.Some(sel)}
}

func TestValidateAnnotationRules(t *testing.T) {
	cfi := wire.Locator{CFI: &wire.CFILocator{Kind: "foliate-cfi", Version: 1, CFI: "epubcfi(/6/2)"}}
	pdf := wire.Locator{PDF: &wire.PDFLocator{Kind: "pdf-page", Version: 1, PageIndex: 3, X: .1, Y: .2}}
	comic := wire.Locator{Comic: &wire.ComicLocator{Kind: "comic-page", Version: 1, PageIndex: 1, EntryID: strings.Repeat("a", 64), ManifestVersion: uuid.NewString()}}
	rng := &wire.Selection{CFI: &wire.CFIRange{Kind: "foliate-range", Version: 1, CFI: "epubcfi(/6/2,/1:0,/1:3)"}}
	rects := func(page int) *wire.Selection {
		return &wire.Selection{PDF: &wire.PDFRange{Kind: "pdf-rectangles", Version: 1, PageIndex: page,
			Rectangles: []wire.Rectangle{{X: .1, Y: .1, Width: .2, Height: .05}}}}
	}
	epub, pdfEd, cbz := edition{Format: "epub"}, edition{Format: "pdf"}, edition{Format: "cbz"}
	cases := []struct {
		name string
		ed   edition
		d    wire.AnnotationData
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
