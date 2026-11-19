package ingest_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
)

// epubBytes builds a minimal EPUB whose OPF carries the given title and author.
func epubBytes(t *testing.T, title, author string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name, body string, method uint16) {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: method})
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(body))
	}
	add("mimetype", "application/epub+zip", zip.Store)
	add("META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`, zip.Deflate)
	add("content.opf", fmt.Sprintf(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:refresh-1</dc:identifier><dc:title>%s</dc:title><dc:creator>%s</dc:creator><dc:language>en</dc:language></metadata><manifest/><spine/></package>`, title, author), zip.Deflate)
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func (e *env) writeBytes(rel string, b []byte) {
	e.t.Helper()
	p := filepath.Join(e.root, filepath.FromSlash(rel))
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, b, 0o644); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) titleOfFile(rel string) (title string, authors []string, evTitle string) {
	e.t.Helper()
	ctx := context.Background()
	fid := e.obs()[rel].FileID
	ed, err := e.q.GetEditionByFileID(ctx, fid)
	if err != nil {
		e.t.Fatalf("edition for %s: %v", rel, err)
	}
	row, err := e.q.GetTitleRow(ctx, ed.TitleID)
	if err != nil {
		e.t.Fatal(err)
	}
	vals, _ := e.q.ListEditionMetadataValues(ctx, ed.ID)
	for _, v := range vals {
		if v.Field == "title" && v.Source == "embedded" {
			_ = json.Unmarshal(v.Value, &evTitle)
		}
	}
	return row.Title, row.Authors, evTitle
}

// A same-path replacement (including an approved write-back) must carry the file's new embedded metadata into the catalog.
func TestReplacedEbookRefreshesEmbeddedMetadata(t *testing.T) {
	e := newEnv(t)
	e.writeBytes("A/Book.epub", epubBytes(t, "Old Title", "Old Author"))
	e.settle()
	if title, _, ev := e.titleOfFile("A/Book.epub"); title != "Old Title" || ev != "Old Title" {
		t.Fatalf("setup: title %q evidence %q", title, ev)
	}
	ed, _ := e.q.GetEditionByFileID(context.Background(), e.obs()["A/Book.epub"].FileID)

	e.writeBytes("A/Book.epub", epubBytes(t, "New Title", "New Author"))
	e.settle()
	title, authors, ev := e.titleOfFile("A/Book.epub")
	if title != "New Title" || ev != "New Title" || len(authors) != 1 || authors[0] != "New Author" {
		t.Fatalf("catalog did not follow the file: title %q authors %v evidence %q", title, authors, ev)
	}
	after, _ := e.q.GetEditionByFileID(context.Background(), e.obs()["A/Book.epub"].FileID)
	if after.ID != ed.ID || after.Revision == ed.Revision {
		t.Fatalf("same edition with a bumped revision expected: %+v -> %+v", ed, after)
	}
}

// An administrator's edit is never overwritten by what the file says.
func TestReplacedEbookKeepsAdministratorEdits(t *testing.T) {
	e := newEnv(t)
	e.writeBytes("A/Book.epub", epubBytes(t, "Old Title", "Old Author"))
	e.settle()
	ctx := context.Background()
	ed, _ := e.q.GetEditionByFileID(ctx, e.obs()["A/Book.epub"].FileID)
	if err := e.q.UpsertEditionMetadataValue(ctx, sqlcgen.UpsertEditionMetadataValueParams{EditionID: ed.ID, Field: "title", Source: "user", Value: []byte(`"My Title"`)}); err != nil {
		t.Fatal(err)
	}
	if err := e.q.UpdateTitleFields(ctx, sqlcgen.UpdateTitleFieldsParams{ID: ed.TitleID, Title: "My Title", Authors: []string{"Old Author"}}); err != nil {
		t.Fatal(err)
	}

	e.writeBytes("A/Book.epub", epubBytes(t, "New Title", "New Author"))
	e.settle()
	title, authors, ev := e.titleOfFile("A/Book.epub")
	if title != "My Title" {
		t.Fatalf("an administrator's title must win, got %q", title)
	}
	if ev != "New Title" || len(authors) != 1 || authors[0] != "New Author" {
		t.Fatalf("unprotected fields and evidence still follow the file: authors %v evidence %q", authors, ev)
	}
}
