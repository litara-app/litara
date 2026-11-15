package httpapi_test

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func epubIn(t *testing.T, p, title, author, isbn, lang string) []byte {
	idents := ""
	if isbn != "" {
		idents = `<dc:identifier>urn:isbn:` + isbn + `</dc:identifier>`
	} else {
		idents = `<dc:identifier>urn:uuid:` + strings.ReplaceAll(title+author, " ", "-") + `</dc:identifier>`
	}
	return writeZip(t, p, map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
		"OPS/package.opf": `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata>` +
			`<dc:title>` + title + `</dc:title><dc:creator>` + author + `</dc:creator><dc:language>` + lang + `</dc:language>` + idents + `</metadata></package>`,
		"OPS/chapter.xhtml": "<html><body>x</body></html>",
	})
}

// scan-editions: EPUB, a translation EPUB, PDF, FB2 and a comic scanned together twice. Every file is its own
// edition; only strong identifier plus matching title and authors may link works, and identical title text
// alone never collapses two works (ADR-0045 family).
func TestMixedFormatScanKeepsWorksDistinct(t *testing.T) {
	e := apitest.New(t)
	root, _ := filepath.Abs(filepath.Join(e.Cfg.MediaRoot, "ebooks"))
	_ = os.MkdirAll(root, 0o755)
	admin := e.Login(seed.AdminName, "cli").AccessToken
	d := setupLibrary(t, e, admin, root)
	lib := d.Library.ID
	if r := e.Do("PUT", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+lib, admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d %s", r.StatusCode, r.Body)
	}
	userA := e.Login(seed.UserAName, "phone").AccessToken

	const isbn = "978-0-306-40615-7"
	epubIn(t, filepath.Join(root, "A", "english.epub"), "Same Words", "Ann Author", isbn, "en")
	epubIn(t, filepath.Join(root, "A", "english-again.epub"), "Same Words", "Ann Author", isbn, "en") // a true second copy
	epubIn(t, filepath.Join(root, "B", "french.epub"), "Mêmes Mots", "Ann Author", isbn, "fr")       // a translation: same ISBN, other title
	epubIn(t, filepath.Join(root, "C", "other.epub"), "Same Words", "Bob Other", "", "en")           // same text, other author, no identifier
	_ = os.MkdirAll(filepath.Join(root, "D"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "D", "Same Words.pdf"), []byte("%PDF-1.4 minimal"), 0o644)
	_ = os.MkdirAll(filepath.Join(root, "E"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "E", "same.fb2"), []byte(`<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info>`+
		`<author><first-name>Ann</first-name><last-name>Author</last-name></author><book-title>Same Words</book-title><lang>en</lang></title-info></description><body><section><p>x</p></section></body></FictionBook>`), 0o644)
	writeZip(t, filepath.Join(root, "F", "same.cbz"), map[string]string{"ComicInfo.xml": `<ComicInfo><Title>Same Words</Title><Writer>Cy Panel</Writer></ComicInfo>`, "1.png": pngPage(2, 2)})
	scanTwice(t, e, admin, lib)

	var eds wire.T005Editions
	e.Do("GET", "/editions?libraryId="+lib+"&size=100", userA, nil).JSON(t, &eds)
	if eds.Total != 7 {
		t.Fatalf("every file is its own edition: %d", eds.Total)
	}
	files := map[string]bool{}
	titleByFile := map[string]string{} // path-ish key -> title id
	for _, ed := range eds.Items {
		if files[ed.File.ID] {
			t.Fatalf("two editions share file %s", ed.File.ID)
		}
		files[ed.File.ID] = true
		titleByFile[ed.File.Format+"|"+ed.Label] = ed.TitleID
	}
	var ts wire.T005Titles
	e.Do("GET", "/titles?size=100&libraryId="+lib, userA, nil).JSON(t, &ts)
	byID := map[string]wire.T005Title{}
	for _, x := range ts.Items {
		byID[x.ID] = x
	}
	var sameWords, french, ann []wire.T005Title
	for _, x := range ts.Items {
		switch {
		case x.Title == "Same Words":
			sameWords = append(sameWords, x)
			if len(x.Authors) > 0 && x.Authors[0] == "Ann Author" {
				ann = append(ann, x)
			}
		case x.Title == "Mêmes Mots":
			french = append(french, x)
		}
	}
	// Seven files, seven editions; but only the two true copies (same ISBN, same title, same author) share a title.
	if len(french) != 1 || french[0].EditionCount != 1 {
		t.Fatalf("the translation must stay its own work: %+v", french)
	}
	if len(sameWords) != 5 { // linked EPUB pair, other author, PDF, FB2 and comic
		t.Fatalf("title text alone must not collapse works: %d titles named Same Words", len(sameWords))
	}
	linked := 0
	for _, x := range sameWords {
		switch x.EditionCount {
		case 2:
			linked++
			if len(x.Authors) != 1 || x.Authors[0] != "Ann Author" {
				t.Fatalf("the linked pair is the wrong work: %+v", x)
			}
		case 1:
		default:
			t.Fatalf("unexpected edition count: %+v", x)
		}
	}
	if linked != 1 {
		t.Fatalf("exactly one strong-identifier link expected, got %d", linked)
	}
	// The FB2 shares title and author with the linked pair but carries no identifier: it must be separate.
	fb2 := byID[titleByFile["fb2|FB2"]]
	for _, x := range ann {
		if x.EditionCount == 2 && x.ID == fb2.ID {
			t.Fatal("an FB2 without an identifier was folded into an identified work")
		}
	}
	// Provisional titles raise review items for the owner to decide; nothing is merged silently.
	var rv wire.ReviewList
	e.Do("GET", "/admin/libraries/"+lib+"/reviews", admin, nil).JSON(t, &rv)
	grouping := 0
	for _, r := range rv.Items {
		if r.Kind == "grouping" {
			grouping++
		}
	}
	if grouping == 0 {
		t.Fatalf("no grouping review for same-text provisional titles: %+v", rv.Items)
	}
}
