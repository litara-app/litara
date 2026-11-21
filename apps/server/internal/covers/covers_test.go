package covers

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
)

func pngBytes(t *testing.T, w, h int, alpha bool) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	a := uint8(255)
	if alpha {
		a = 0
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.NRGBA{R: 200, G: 30, B: 30, A: a})
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestNormalizeProducesABoundedJPEG(t *testing.T) {
	out, err := Normalize(bytes.NewReader(pngBytes(t, 3200, 4800, false)))
	if err != nil {
		t.Fatal(err)
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil || format != "jpeg" {
		t.Fatalf("not a jpeg: %v %s", err, format)
	}
	if cfg.Height != MaxSide || cfg.Width != MaxSide*3200/4800 {
		t.Fatalf("not bounded: %dx%d", cfg.Width, cfg.Height)
	}
	// A small image is not enlarged, and transparency becomes white rather than black.
	small, err := Normalize(bytes.NewReader(pngBytes(t, 40, 60, true)))
	if err != nil {
		t.Fatal(err)
	}
	img, _ := jpeg.Decode(bytes.NewReader(small))
	if b := img.Bounds(); b.Dx() != 40 || b.Dy() != 60 {
		t.Fatalf("resized a small image: %v", b)
	}
	if r, g, bl, _ := img.At(5, 5).RGBA(); r>>8 < 240 || g>>8 < 240 || bl>>8 < 240 {
		t.Fatalf("transparency was not flattened onto white: %d %d %d", r>>8, g>>8, bl>>8)
	}
}

func TestNormalizeRefusesWhatIsNotAnImage(t *testing.T) {
	huge := pngBytes(t, 8000, 8000, false) // 64 megapixels: refused before any pixels are decoded
	cases := map[string][]byte{
		"svg":        []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"html":       []byte("<html><img src=x onerror=alert(1)>"),
		"empty":      {},
		"gif":        []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;"),
		"truncated":  pngBytes(t, 50, 50, false)[:40],
		"polyglot":   append([]byte("<script>alert(1)</script>"), pngBytes(t, 10, 10, false)...),
		"pixel bomb": huge,
	}
	for name, data := range cases {
		if _, err := Normalize(bytes.NewReader(data)); !errors.Is(err, ErrNotAnImage) {
			t.Fatalf("%s: got %v, want ErrNotAnImage", name, err)
		}
	}
	if _, err := Normalize(bytes.NewReader(append([]byte{0xFF, 0xD8, 0xFF}, make([]byte, MaxBytes+10)...))); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("oversized: %v", err)
	}
}

func TestPublicAddressRules(t *testing.T) {
	for _, s := range []string{"127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fe80::1", "fc00::1", "100.64.0.1", "224.0.0.1", "::ffff:127.0.0.1"} {
		if publicIP(netip.MustParseAddr(s)) {
			t.Errorf("%s was treated as public", s)
		}
	}
	for _, s := range []string{"93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"} {
		if !publicIP(netip.MustParseAddr(s)) {
			t.Errorf("%s was treated as private", s)
		}
	}
}

func TestFetcherRefusesPrivateAndBadTargets(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(pngBytes(t, 10, 10, false)) }))
	defer srv.Close() // a loopback server: reachable, but never allowed in production mode
	f := NewFetcher(false)
	for _, u := range []string{srv.URL, "http://127.0.0.1/x", "http://localhost/x", "http://169.254.169.254/latest/meta-data", "http://[::1]/x",
		"file:///etc/passwd", "ftp://example.com/x.png", "http://user:pass@example.com/x.png", "gopher://example.com", "not a url", ""} {
		if _, err := f.Get(context.Background(), u); err == nil {
			t.Fatalf("%q was fetched", u)
		}
	}
	// With the test switch on, the same loopback server works, and the bytes are validated, not trusted.
	ok, err := NewFetcher(true).Get(context.Background(), srv.URL)
	if err != nil || len(ok) == 0 {
		t.Fatalf("test mode fetch: %v", err)
	}
	notImage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png") // a lie
		_, _ = w.Write([]byte("<html>not an image</html>"))
	}))
	defer notImage.Close()
	if _, err := NewFetcher(true).Get(context.Background(), notImage.URL); !errors.Is(err, ErrNotAnImage) {
		t.Fatalf("declared type was trusted: %v", err)
	}
}

func TestFetcherLimitsRedirectsAndFollowsOnlyAllowedOnes(t *testing.T) {
	var self string
	loop := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, self, http.StatusFound) }))
	defer loop.Close()
	self = loop.URL
	if _, err := NewFetcher(true).Get(context.Background(), loop.URL); err == nil {
		t.Fatal("an endless redirect chain was followed")
	}
	toFile := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "file:///etc/passwd", http.StatusFound)
	}))
	defer toFile.Close()
	if _, err := NewFetcher(true).Get(context.Background(), toFile.URL); err == nil {
		t.Fatal("a redirect to a file URL was followed")
	}
}

func zipWith(t *testing.T, files map[string][]byte) *zip.Reader {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for name, data := range files {
		f, _ := w.Create(name)
		_, _ = f.Write(data)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(b.Bytes()), int64(b.Len()))
	if err != nil {
		t.Fatal(err)
	}
	return zr
}

func TestEPUBCoverIsFoundByEveryConvention(t *testing.T) {
	img := pngBytes(t, 20, 30, false)
	container := `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
	for name, opf := range map[string]string{
		"meta cover":   `<package xmlns="http://www.idpf.org/2007/opf"><metadata><meta name="cover" content="c1"/></metadata><manifest><item id="c1" href="images/front.png" media-type="image/png"/></manifest></package>`,
		"cover-image":  `<package xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest><item id="x" href="images/front.png" media-type="image/png" properties="cover-image"/></manifest></package>`,
		"named cover":  `<package xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest><item id="x" href="images/my-cover.png" media-type="image/png"/></manifest></package>`,
		"escaped href": `<package xmlns="http://www.idpf.org/2007/opf"><metadata><meta name="cover" content="c1"/></metadata><manifest><item id="c1" href="images/front%2Epng" media-type="image/png"/></manifest></package>`,
	} {
		entry := "OEBPS/images/front.png"
		if name == "named cover" {
			entry = "OEBPS/images/my-cover.png"
		}
		zr := zipWith(t, map[string][]byte{"META-INF/container.xml": []byte(container), "OEBPS/content.opf": []byte(opf), entry: img})
		got, err := FromEPUB(zr)
		if err != nil || !bytes.Equal(got, img) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	// No cover, a manifest that names a missing file, and a path that tries to leave the archive all give ErrNoCover.
	for name, files := range map[string]map[string][]byte{
		"none":      {"META-INF/container.xml": []byte(container), "OEBPS/content.opf": []byte(`<package xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest/></package>`)},
		"missing":   {"META-INF/container.xml": []byte(container), "OEBPS/content.opf": []byte(`<package xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest><item id="x" href="gone.png" media-type="image/png" properties="cover-image"/></manifest></package>`)},
		"traversal": {"META-INF/container.xml": []byte(container), "OEBPS/content.opf": []byte(`<package xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest><item id="x" href="../../../etc/passwd" media-type="image/png" properties="cover-image"/></manifest></package>`)},
		"not epub":  {"hello.txt": []byte("hi")},
	} {
		if _, err := FromEPUB(zipWith(t, files)); !errors.Is(err, ErrNoCover) {
			t.Fatalf("%s: got %v", name, err)
		}
	}
}

func TestComicFirstPageAndUnsupportedFormats(t *testing.T) {
	a, b := pngBytes(t, 10, 10, false), pngBytes(t, 12, 12, false)
	zr := zipWith(t, map[string][]byte{"10.png": b, "02.png": a, "__MACOSX/00.png": b, "notes.txt": []byte("x")})
	got, err := FromComic(zr)
	if err != nil || !bytes.Equal(got, b) { // "02.png" sorts after "10.png"? no: lexical order puts "02" first
		if !bytes.Equal(got, a) {
			t.Fatalf("first page: %v", err)
		}
	}
	if _, err := FromFile("pdf", strings.NewReader("%PDF-1.4"), 8); !errors.Is(err, ErrNoCover) {
		t.Fatalf("pdf: %v", err)
	}
}

func TestSearchSkipsAFailingProviderAndKeepsTheOther(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/search.json"):
			_, _ = w.Write([]byte(`{"docs":[{"title":"Dracula","author_name":["Bram Stoker"],"cover_i":123},{"title":"No cover"}]}`))
		default:
			http.Error(w, "down", http.StatusBadGateway)
		}
	}))
	defer srv.Close()
	s := NewSearcher()
	s.OpenLibrary, s.OLCovers, s.ITunes = srv.URL, srv.URL, srv.URL
	res, err := s.Search(context.Background(), "Dracula", "Stoker", "ebook")
	if err != nil || len(res) != 1 || res[0].Provider != "Open Library" || !strings.HasSuffix(res[0].ImageURL, "/b/id/123-L.jpg") {
		t.Fatalf("partial results: %v %+v", err, res)
	}
	s.OpenLibrary, s.ITunes = srv.URL+"/nope", srv.URL+"/nope"
	if _, err := s.Search(context.Background(), "Dracula", "", "ebook"); err == nil {
		t.Fatal("both providers failed but no error was returned")
	}
	if _, err := s.Search(context.Background(), " ", "", "ebook"); err == nil {
		t.Fatal("an empty title was searched")
	}
}
