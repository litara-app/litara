package writeback_test

import (
	"archive/zip"
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
)

const coverOPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Engine Cover</dc:title><dc:creator>Cora Cover</dc:creator><dc:language>en</dc:language>
    <dc:identifier id="uid">urn:uuid:00000000-0000-4000-8000-0000000000e1</dc:identifier>
    <meta name="cover" content="cv"/>
  </metadata>
  <manifest><item id="cv" href="cover.jpg" media-type="image/jpeg"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`

func solidJPEG(t *testing.T, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 80, 120))
	for y := 0; y < 120; y++ {
		for x := 0; x < 80; x++ {
			img.Set(x, y, c)
		}
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func entryBytes(t *testing.T, epub, name string) []byte {
	t.Helper()
	zr, err := zip.OpenReader(epub)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.Name == name {
			rc, _ := f.Open()
			defer rc.Close()
			b, _ := io.ReadAll(rc)
			return b
		}
	}
	t.Fatalf("no entry %s", name)
	return nil
}

func (e *epubEnv) storeCover(t *testing.T, img []byte) uuid.UUID {
	t.Helper()
	var title uuid.UUID
	if err := e.pool.QueryRow(context.Background(), `SELECT title_id FROM editions WHERE file_id = $1`, e.file).Scan(&title); err != nil {
		t.Fatal(err)
	}
	if _, err := e.q.UpsertTitleCover(context.Background(), sqlcgen.UpsertTitleCoverParams{TitleID: title, Medium: "ebook", Source: "upload", Image: img}); err != nil {
		t.Fatal(err)
	}
	return title
}

// ADR-0086 phase 2: the cover is written through the same plan, approval, staging and validation as any in-file write.
func TestEPUBCoverWriteThroughTheEngine(t *testing.T) {
	old := solidJPEG(t, color.RGBA{R: 200, A: 255})
	e := newEPUBEnvWith(t, coverOPF, map[string][]byte{"OEBPS/cover.jpg": old})
	ctx := context.Background()

	// Nothing to write until a cover is stored; audiobooks are not supported yet; and the writer must be enabled.
	if _, err := e.svc.PlanCoverInFile(ctx, e.file, "ebook"); code(err) != "writer_disabled" && code(err) != "no_cover" {
		t.Fatalf("no stored cover or disabled writer: %v", err)
	}
	if _, err := e.svc.PlanCoverInFile(ctx, e.file, "audio"); code(err) != "cover_embed_unsupported" {
		t.Fatalf("audio: %v", err)
	}
	e.enable()
	if _, err := e.svc.PlanCoverInFile(ctx, e.file, "ebook"); code(err) != "no_cover" {
		t.Fatalf("no stored cover: %v", err)
	}

	want := solidJPEG(t, color.RGBA{G: 180, B: 40, A: 255})
	e.storeCover(t, want)
	before := e.hash(e.epub)
	plan, err := e.svc.PlanCoverInFile(ctx, e.file, "ebook")
	if err != nil {
		t.Fatal(err)
	}
	// The plan carries a reference and a fingerprint, never the image itself.
	if !strings.Contains(string(plan.Diff), `"cover"`) || !strings.Contains(string(plan.Diff), `"sha256"`) || len(plan.Diff) > 2000 {
		t.Fatalf("the reviewed diff should name the cover, not embed it: %s", plan.Diff)
	}
	if err := e.svc.Execute(ctx, plan.ID); code(err) != "plan_not_runnable" || e.hash(e.epub) != before {
		t.Fatalf("an unapproved plan must not run or write: %v", err)
	}
	if err := e.approveRun(plan.ID); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if !bytes.Equal(entryBytes(t, e.epub, "OEBPS/cover.jpg"), want) {
		t.Fatal("the cover inside the file is not the stored cover")
	}
	if got := entryBytes(t, e.epub, "OEBPS/content.opf"); !strings.Contains(string(got), `<meta name="cover" content="cv"/>`) {
		t.Fatal("the package document changed")
	}
	e.noTemps()
}

func TestEPUBCoverChangedAfterReviewIsRefused(t *testing.T) {
	old := solidJPEG(t, color.RGBA{R: 200, A: 255})
	e := newEPUBEnvWith(t, coverOPF, map[string][]byte{"OEBPS/cover.jpg": old})
	ctx := context.Background()
	e.enable()
	e.storeCover(t, solidJPEG(t, color.RGBA{G: 180, A: 255}))
	plan, err := e.svc.PlanCoverInFile(ctx, e.file, "ebook")
	if err != nil {
		t.Fatal(err)
	}
	e.storeCover(t, solidJPEG(t, color.RGBA{B: 255, A: 255})) // someone replaces the cover before the write runs
	before := e.hash(e.epub)
	err = e.approveRun(plan.ID)
	if code(err) != "write_refused" || !strings.Contains(err.Error(), "changed after") {
		t.Fatalf("a cover that changed after review must be refused: %v", err)
	}
	if e.hash(e.epub) != before || !bytes.Equal(entryBytes(t, e.epub, "OEBPS/cover.jpg"), old) {
		t.Fatal("the file was changed by a refused write")
	}
	e.noTemps()
}

func TestEPUBCoverIsAddedWhenNoneIsDeclaredThroughTheEngine(t *testing.T) {
	e := newEPUBEnv(t) // the standard fixture declares no cover
	ctx := context.Background()
	e.enable()
	want := solidJPEG(t, color.RGBA{R: 9, G: 9, B: 200, A: 255})
	e.storeCover(t, want)
	plan, err := e.svc.PlanCoverInFile(ctx, e.file, "ebook")
	if err != nil {
		t.Fatal(err)
	}
	if err := e.approveRun(plan.ID); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if !bytes.Equal(entryBytes(t, e.epub, "OEBPS/litara-cover.jpg"), want) {
		t.Fatal("the added cover is not the stored cover")
	}
	opf := string(entryBytes(t, e.epub, "OEBPS/content.opf"))
	if !strings.Contains(opf, `<meta name="cover" content="litara-cover"/>`) || !strings.Contains(opf, `id="litara-cover"`) {
		t.Fatalf("the package does not declare the new cover:\n%s", opf)
	}
	e.noTemps()
}
