package writeback

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"path/filepath"
	"strings"
	"testing"
)

func testJPEG(t *testing.T, w, h int, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func coverField(b []byte) map[string]any {
	return map[string]any{"cover_image": base64.StdEncoding.EncodeToString(b)}
}

func opfWithCover(version, manifestItem, metaCover string) string {
	return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="` + version + `" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Covered</dc:title><dc:creator>Cora Cover</dc:creator><dc:language>en</dc:language>
    <dc:identifier id="uid">urn:uuid:00000000-0000-4000-8000-000000000001</dc:identifier>` + metaCover + `
  </metadata>
  <manifest>` + manifestItem + `<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`
}

// sameExcept reports every archive entry whose uncompressed bytes differ between two archives.
func sameExcept(t *testing.T, a, b string) []string {
	t.Helper()
	ra, rb := readZip(t, a), readZip(t, b)
	var diff []string
	for name, data := range ra {
		if !bytes.Equal(data, rb[name]) {
			diff = append(diff, name)
		}
	}
	if len(ra) != len(rb) {
		diff = append(diff, "<entry count changed>")
	}
	return diff
}

func TestEPUBCoverReplacesTheDeclaredImageInItsOwnFormat(t *testing.T) {
	want := testJPEG(t, 120, 180, color.RGBA{R: 20, G: 120, B: 40, A: 255})

	// A JPEG cover is replaced byte for byte.
	jpgBook := build(t, opfWithCover("2.0", `<item id="cv" href="cover.jpg" media-type="image/jpeg"/>`, `<meta name="cover" content="cv"/>`),
		func(e *[]entry) {
			*e = append(*e, entry{"OEBPS/cover.jpg", testJPEG(t, 10, 10, color.RGBA{R: 200, A: 255}), zip.Deflate})
		})
	staged := writeAndValidate(t, jpgBook, fields(t, coverField(want)))
	if d := sameExcept(t, jpgBook, staged); len(d) != 1 || d[0] != "OEBPS/cover.jpg" {
		t.Fatalf("only the cover may change: %v", d)
	}
	if !bytes.Equal(readZip(t, staged)["OEBPS/cover.jpg"], want) {
		t.Fatal("the cover is not the requested image")
	}

	// A PNG cover stays a PNG with the same name, so the manifest and every reference stay true.
	pngBook := build(t, opfWithCover("3.0", `<item id="cv" href="images/cover.png" media-type="image/png" properties="cover-image"/>`, ``),
		func(e *[]entry) { *e = append(*e, entry{"OEBPS/images/cover.png", []byte("placeholder"), zip.Store}) })
	staged = writeAndValidate(t, pngBook, fields(t, coverField(want)))
	if d := sameExcept(t, pngBook, staged); len(d) != 1 || d[0] != "OEBPS/images/cover.png" {
		t.Fatalf("only the cover may change: %v", d)
	}
	img, err := png.Decode(bytes.NewReader(readZip(t, staged)["OEBPS/images/cover.png"]))
	if err != nil || img.Bounds().Dx() != 120 || img.Bounds().Dy() != 180 {
		t.Fatalf("not the requested picture as a PNG: %v", err)
	}

	// The archive stays a valid EPUB container: mimetype first and stored, same entry order and comment.
	zr, _ := zip.OpenReader(staged)
	defer zr.Close()
	if zr.File[0].Name != "mimetype" || zr.File[0].Method != zip.Store || zr.Comment != "original archive comment" {
		t.Fatal("the container layout changed")
	}

	// Writing the same cover again changes nothing further.
	again := filepath.Join(t.TempDir(), "again.epub")
	if err := (EPUBWriter{}).Write(context.Background(), staged, again, fields(t, coverField(want))); err != nil {
		t.Fatal(err)
	}
	if d := sameExcept(t, staged, again); len(d) != 0 {
		t.Fatalf("not idempotent: %v", d)
	}
}

func TestEPUBCoverAndMetadataChangeTogether(t *testing.T) {
	book := build(t, opfWithCover("2.0", `<item id="cv" href="cover.jpg" media-type="image/jpeg"/>`, `<meta name="cover" content="cv"/>`),
		func(e *[]entry) {
			*e = append(*e, entry{"OEBPS/cover.jpg", testJPEG(t, 10, 10, color.RGBA{B: 200, A: 255}), zip.Store})
		})
	kv := coverField(testJPEG(t, 60, 90, color.RGBA{R: 90, G: 30, B: 150, A: 255}))
	kv["title"] = "A New Title"
	staged := writeAndValidate(t, book, fields(t, kv))
	d := sameExcept(t, book, staged)
	if len(d) != 2 {
		t.Fatalf("exactly the package document and the cover may change: %v", d)
	}
}

func TestEPUBCoverRefusalsAreExplicit(t *testing.T) {
	good := testJPEG(t, 30, 40, color.RGBA{R: 1, G: 2, B: 3, A: 255})
	empty := build(t, opfPlain("No Cover"), nil) // an empty manifest cannot be extended
	if err := (EPUBWriter{}).Write(context.Background(), empty, filepath.Join(t.TempDir(), "x.epub"), fields(t, coverField(good))); err == nil || !strings.Contains(err.Error(), "manifest is empty") {
		t.Fatalf("an EPUB with an empty manifest: %v", err)
	}
	dangling := build(t, opfWithCover("2.0", ``, `<meta name="cover" content="nowhere"/>`), nil)
	if err := (EPUBWriter{}).Write(context.Background(), dangling, filepath.Join(t.TempDir(), "d.epub"), fields(t, coverField(good))); err == nil || !strings.Contains(err.Error(), "not in its manifest") {
		t.Fatalf("a cover meta that names no manifest item: %v", err)
	}
	taken := build(t, opfWithCover("2.0", ``, ``), func(e *[]entry) {
		*e = append(*e, entry{"OEBPS/litara-cover.jpg", []byte("someone else's file"), zip.Store})
	})
	if err := (EPUBWriter{}).Write(context.Background(), taken, filepath.Join(t.TempDir(), "t.epub"), fields(t, coverField(good))); err == nil || !strings.Contains(err.Error(), "unrelated") {
		t.Fatalf("an unrelated file already named like the cover: %v", err)
	}
	gif := build(t, opfWithCover("2.0", `<item id="cv" href="cover.gif" media-type="image/gif"/>`, `<meta name="cover" content="cv"/>`),
		func(e *[]entry) { *e = append(*e, entry{"OEBPS/cover.gif", []byte("GIF89a"), zip.Store}) })
	if err := (EPUBWriter{}).Write(context.Background(), gif, filepath.Join(t.TempDir(), "y.epub"), fields(t, coverField(good))); err == nil || !strings.Contains(err.Error(), "only JPEG and PNG") {
		t.Fatalf("a GIF cover: %v", err)
	}
	missing := build(t, opfWithCover("2.0", `<item id="cv" href="gone.jpg" media-type="image/jpeg"/>`, `<meta name="cover" content="cv"/>`), nil)
	if err := (EPUBWriter{}).Write(context.Background(), missing, filepath.Join(t.TempDir(), "z.epub"), fields(t, coverField(good))); err == nil {
		t.Fatal("a manifest naming a missing file was written")
	}
	// The cover value itself must be a real JPEG.
	for name, v := range map[string]string{"not base64": "%%%", "not an image": base64.StdEncoding.EncodeToString([]byte("hello")), "empty": ""} {
		if _, err := parseEPUBChanges(fields(t, map[string]any{"cover_image": v})); err == nil {
			t.Fatalf("%s was accepted", name)
		}
	}
}

func TestEPUBCoverValidateCatchesTampering(t *testing.T) {
	book := build(t, opfWithCover("2.0", `<item id="cv" href="cover.jpg" media-type="image/jpeg"/>`, `<meta name="cover" content="cv"/>`),
		func(e *[]entry) {
			*e = append(*e, entry{"OEBPS/cover.jpg", testJPEG(t, 10, 10, color.RGBA{R: 5, A: 255}), zip.Store})
		})
	want := testJPEG(t, 50, 70, color.RGBA{G: 180, A: 255})
	ch := fields(t, coverField(want))
	staged := writeAndValidate(t, book, ch)

	// A staged file with a different image in the cover slot is refused.
	other := rewrite(t, staged, func(name string, b []byte) []byte {
		if name == "OEBPS/cover.jpg" {
			return testJPEG(t, 50, 70, color.RGBA{R: 255, A: 255})
		}
		return b
	})
	if err := (EPUBWriter{}).Validate(context.Background(), book, other, ch); err == nil {
		t.Fatal("a different cover passed validation")
	}
	// So is a staged file where something other than the cover changed.
	chapter := rewrite(t, staged, func(name string, b []byte) []byte {
		if name == "OEBPS/c1.xhtml" {
			return append([]byte{}, []byte("<html>changed</html>")...)
		}
		return b
	})
	if err := (EPUBWriter{}).Validate(context.Background(), book, chapter, ch); err == nil {
		t.Fatal("a changed chapter passed validation")
	}
	// And an unmodified original is not "the requested cover".
	if err := (EPUBWriter{}).Validate(context.Background(), book, book, ch); err == nil {
		t.Fatal("the original passed as if the cover had been written")
	}
}

func TestEPUBAddsACoverWhenNoneIsDeclared(t *testing.T) {
	want := testJPEG(t, 90, 140, color.RGBA{R: 40, G: 90, B: 200, A: 255})
	for _, version := range []string{"2.0", "3.0"} {
		book := build(t, opfWithCover(version, "", ""), nil)
		staged := writeAndValidate(t, book, fields(t, coverField(want)))
		files := readZip(t, staged)
		if !bytes.Equal(files["OEBPS/litara-cover.jpg"], want) {
			t.Fatalf("%s: the new cover entry is not the requested image", version)
		}
		// Only the package document differs among the original entries, and one entry was added at the end.
		if d := sameExcept(t, book, staged); len(d) != 2 {
			t.Fatalf("%s: expected the package document and one new entry to differ: %v", version, d)
		}
		opf := string(files["OEBPS/content.opf"])
		item := `<item id="litara-cover" href="litara-cover.jpg" media-type="image/jpeg"`
		if !strings.Contains(opf, item) || !strings.Contains(opf, `<meta name="cover" content="litara-cover"/>`) {
			t.Fatalf("%s: manifest item or cover meta missing:\n%s", version, opf)
		}
		if strings.Contains(opf, `properties="cover-image"`) != (version == "3.0") {
			t.Fatalf("%s: cover-image property is wrong:\n%s", version, opf)
		}
		zr, _ := zip.OpenReader(staged)
		if zr.File[0].Name != "mimetype" || zr.File[0].Method != zip.Store || zr.File[len(zr.File)-1].Name != "OEBPS/litara-cover.jpg" {
			t.Fatalf("%s: container layout", version)
		}
		zr.Close()

		// The package now declares its cover, so a later write replaces the image in place and adds nothing further.
		next := testJPEG(t, 90, 140, color.RGBA{R: 200, G: 40, B: 40, A: 255})
		again := writeAndValidate(t, staged, fields(t, coverField(next)))
		if d := sameExcept(t, staged, again); len(d) != 1 || d[0] != "OEBPS/litara-cover.jpg" {
			t.Fatalf("%s: the second write must only replace the cover: %v", version, d)
		}
	}

	// With a metadata change in the same write.
	book := build(t, opfWithCover("2.0", "", ""), nil)
	kv := coverField(want)
	kv["title"] = "Brand New Title"
	staged := writeAndValidate(t, book, fields(t, kv))
	if got := string(readZip(t, staged)["OEBPS/content.opf"]); !strings.Contains(got, "Brand New Title") || !strings.Contains(got, `content="litara-cover"`) {
		t.Fatalf("title and cover together:\n%s", got)
	}
}

func TestEPUBAddedCoverValidateCatchesTampering(t *testing.T) {
	book := build(t, opfWithCover("3.0", "", ""), nil)
	want := testJPEG(t, 50, 80, color.RGBA{G: 150, A: 255})
	ch := fields(t, coverField(want))
	staged := writeAndValidate(t, book, ch)

	// A different picture in the added entry, a stray extra change to the manifest, and a missing manifest item are all refused.
	for name, mutate := range map[string]func(string, []byte) []byte{
		"wrong picture": func(n string, b []byte) []byte {
			if n == "OEBPS/litara-cover.jpg" {
				return testJPEG(t, 50, 80, color.RGBA{R: 250, A: 255})
			}
			return b
		},
		"extra manifest item": func(n string, b []byte) []byte {
			if n == "OEBPS/content.opf" {
				return []byte(strings.Replace(string(b), "</manifest>", `<item id="x" href="x.png" media-type="image/png"/></manifest>`, 1))
			}
			return b
		},
		"no manifest item": func(n string, b []byte) []byte {
			if n == "OEBPS/content.opf" {
				i := strings.Index(string(b), `<item id="litara-cover"`)
				j := i + strings.Index(string(b)[i:], "/>") + 2
				return []byte(string(b)[:i] + string(b)[j:])
			}
			return b
		},
		"extra metadata": func(n string, b []byte) []byte {
			if n == "OEBPS/content.opf" {
				return []byte(strings.Replace(string(b), "</metadata>", `<meta name="x" content="y"/></metadata>`, 1))
			}
			return b
		},
	} {
		if err := (EPUBWriter{}).Validate(context.Background(), book, rewrite(t, staged, mutate), ch); err == nil {
			t.Fatalf("%s passed validation", name)
		}
	}
	if err := (EPUBWriter{}).Validate(context.Background(), book, book, ch); err == nil {
		t.Fatal("the original passed as if a cover had been added")
	}
}
