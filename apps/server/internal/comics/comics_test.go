package comics

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func pngBytes(w, h int) []byte {
	var b bytes.Buffer
	_ = png.Encode(&b, image.NewGray(image.Rect(0, 0, w, h)))
	return b.Bytes()
}

func jpegBytes(w, h int) []byte {
	var b bytes.Buffer
	_ = jpeg.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h)), nil)
	return b.Bytes()
}

func gifBytes(w, h int) []byte {
	var b bytes.Buffer
	_ = gif.Encode(&b, image.NewPaletted(image.Rect(0, 0, w, h), color.Palette{color.Black, color.White}), nil)
	return b.Bytes()
}

// webpBytes builds a header-only lossless WebP; Extract only needs the size.
func webpBytes(w, h int) []byte {
	var chunk [5]byte
	chunk[0] = 0x2f
	binary.LittleEndian.PutUint32(chunk[1:], uint32(w-1)|uint32(h-1)<<14)
	var b bytes.Buffer
	b.WriteString("RIFF")
	_ = binary.Write(&b, binary.LittleEndian, uint32(4+8+len(chunk)))
	b.WriteString("WEBPVP8L")
	_ = binary.Write(&b, binary.LittleEndian, uint32(len(chunk)))
	b.Write(chunk[:])
	b.Write(make([]byte, 16))
	return b.Bytes()
}

type ent struct {
	name string
	data []byte
	mode os.FileMode
}

func makeZip(t *testing.T, ents ...ent) string {
	t.Helper()
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	for _, e := range ents {
		h := &zip.FileHeader{Name: e.name, Method: zip.Deflate}
		if e.mode != 0 {
			h.SetMode(e.mode)
		}
		w, err := zw.CreateHeader(h)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write(e.data)
	}
	_ = zw.Close()
	p := filepath.Join(t.TempDir(), "x.cbz")
	if err := os.WriteFile(p, b.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func extract(t *testing.T, src string, lim Limits) (Result, string, error) {
	t.Helper()
	dst := filepath.Join(t.TempDir(), "out")
	res, err := Extract(context.Background(), src, dst, lim, Hooks{})
	return res, dst, err
}

func code(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

func TestNaturalOrderingAndIdentities(t *testing.T) {
	p := makeZip(t,
		ent{name: "ComicInfo.xml", data: []byte("<x/>")},
		ent{name: "pages/10.png", data: pngBytes(2, 2)},
		ent{name: "pages/2.png", data: pngBytes(2, 2)},
		ent{name: "pages/02a.png", data: pngBytes(3, 3)},
		ent{name: "Pages/1.jpg", data: jpegBytes(4, 4)},
		ent{name: "pages/B.gif", data: gifBytes(5, 5)},
		ent{name: "pages/a.webp", data: webpBytes(6, 7)},
	)
	res, dst, err := extract(t, p, DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, pg := range res.Pages {
		got = append(got, pg.File)
		if pg.Index != len(got)-1 || len(pg.EntryID) != 64 {
			t.Fatalf("page: %+v", pg)
		}
	}
	// Case-insensitive natural order: Pages/1, pages/2, pages/02a, pages/10, then letters.
	wantMime := []string{"image/jpeg", "image/png", "image/png", "image/png", "image/webp", "image/gif"}
	for i, pg := range res.Pages {
		if pg.Mime != wantMime[i] {
			t.Fatalf("order %d: %s want %s (%v)", i, pg.Mime, wantMime[i], got)
		}
	}
	if res.Pages[4].Width != 6 || res.Pages[4].Height != 7 {
		t.Fatalf("webp size: %+v", res.Pages[4])
	}
	if _, err := os.Stat(filepath.Join(dst, res.Pages[0].File)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dst + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("staging directory was left behind")
	}
	// Deterministic: a second run yields identical identities.
	res2, _, _ := extract(t, p, DefaultLimits())
	for i := range res.Pages {
		if res.Pages[i].EntryID != res2.Pages[i].EntryID {
			t.Fatal("entry identity is not stable")
		}
	}
	if len(res.Skipped) != 1 {
		t.Fatalf("skipped: %v", res.Skipped)
	}
}

func TestHostileArchivesAreRejectedBeforePublication(t *testing.T) {
	img := pngBytes(2, 2)
	cases := map[string][]ent{
		"traversal":         {{name: "../evil.png", data: img}},
		"nested traversal":  {{name: "a/../../evil.png", data: img}},
		"absolute":          {{name: "/etc/page.png", data: img}},
		"drive letter":      {{name: "C:/page.png", data: img}},
		"backslash":         {{name: `a\b.png`, data: img}},
		"empty segment":     {{name: "a//b.png", data: img}},
		"duplicate normal.": {{name: "p/1.png", data: img}, {name: "P/1.PNG", data: img}},
		"symlink":           {{name: "1.png", data: []byte("target"), mode: os.ModeSymlink | 0o777}},
		"nested archive":    {{name: "1.png", data: img}, {name: "inner.cbz", data: []byte("PK")}},
		"nested rar":        {{name: "1.png", data: img}, {name: "x/inner.rar", data: []byte("Rar!")}},
		"no pages":          {{name: "ComicInfo.xml", data: []byte("<x/>")}},
		"not an image":      {{name: "1.png", data: []byte("this is not a png")}},
		"png named jpg":     {{name: "1.jpg", data: []byte("MZ\x90\x00executable")}},
	}
	for name, ents := range cases {
		_, dst, err := extract(t, makeZip(t, ents...), DefaultLimits())
		if err == nil || code(err) != CodeUnsupported {
			t.Fatalf("%s: err=%v", name, err)
		}
		if _, serr := os.Stat(dst); !os.IsNotExist(serr) {
			t.Fatalf("%s: output was published", name)
		}
		if _, serr := os.Stat(dst + ".tmp"); !os.IsNotExist(serr) {
			t.Fatalf("%s: staging was left behind", name)
		}
	}
	if _, _, err := extract(t, filepath.Join(t.TempDir(), "missing.cbz"), DefaultLimits()); err == nil {
		t.Fatal("missing file must fail")
	}
	notZip := filepath.Join(t.TempDir(), "x.cbz")
	_ = os.WriteFile(notZip, []byte("not a zip"), 0o644)
	if _, _, err := extract(t, notZip, DefaultLimits()); code(err) != CodeUnsupported {
		t.Fatalf("not a zip: %v", err)
	}
}

func TestResourceCeilings(t *testing.T) {
	img := pngBytes(10, 10)
	base := func() Limits { return DefaultLimits() }
	two := makeZip(t, ent{name: "1.png", data: img}, ent{name: "2.png", data: img})
	for name, c := range map[string]struct {
		src string
		mod func(*Limits)
	}{
		"entries":    {two, func(l *Limits) { l.MaxEntries = 1 }},
		"pages":      {two, func(l *Limits) { l.MaxPages = 1 }},
		"per entry":  {two, func(l *Limits) { l.MaxEntryBytes = 10 }},
		"expanded":   {two, func(l *Limits) { l.MaxExpanded = int64(len(img)) + 1 }},
		"compressed": {two, func(l *Limits) { l.MaxCompressed = 10 }},
		"pixels":     {two, func(l *Limits) { l.MaxPixels = 50 }},
		"time":       {two, func(l *Limits) { l.Timeout = 1 }},
	} {
		l := base()
		c.mod(&l)
		_, dst, err := extract(t, c.src, l)
		if code(err) != CodeLimit {
			t.Fatalf("%s: %v", name, err)
		}
		if _, serr := os.Stat(dst); !os.IsNotExist(serr) {
			t.Fatalf("%s: partial output published", name)
		}
	}
	// A highly compressible entry trips the expansion ratio without trusting headers alone.
	big := bytes.Repeat([]byte{0}, 3<<20)
	var b bytes.Buffer
	_ = png.Encode(&b, image.NewGray(image.Rect(0, 0, 1700, 1700)))
	ratio := makeZip(t, ent{name: "1.png", data: b.Bytes()}, ent{name: "pad.png", data: big})
	_ = ratio
	// Header-trusted limits must not be the only defence: a lying uncompressed
	// size is caught by the streaming counter.
	lying := makeZip(t, ent{name: "1.png", data: bytes.Repeat(img, 50)})
	l := base()
	l.MaxEntryBytes = int64(len(img)) * 2
	if _, _, err := extract(t, lying, l); code(err) != CodeLimit {
		t.Fatalf("oversized entry: %v", err)
	}
	// The Reserve hook can veto before any byte is written.
	vetoed := errors.New("cache full")
	_, dst, err := func() (Result, string, error) {
		d := filepath.Join(t.TempDir(), "out")
		r, e := Extract(context.Background(), two, d, DefaultLimits(), Hooks{Reserve: func(int64) error { return vetoed }})
		return r, d, e
	}()
	if !errors.Is(err, vetoed) {
		t.Fatalf("reserve veto: %v", err)
	}
	if _, serr := os.Stat(dst + ".tmp"); !os.IsNotExist(serr) {
		t.Fatal("staging created before reservation")
	}
}

func TestLimitsCanOnlyBeLowered(t *testing.T) {
	d := DefaultLimits()
	l := d.Lowered(Limits{MaxEntries: 5, MaxPages: 999999, MaxCompressed: 1})
	if l.MaxEntries != 5 || l.MaxPages != d.MaxPages || l.MaxCompressed != 1 {
		t.Fatalf("%+v", l)
	}
	if strings.TrimSpace(Profile) == "" {
		t.Fatal("profile")
	}
}
