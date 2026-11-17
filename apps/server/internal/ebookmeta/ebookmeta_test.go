package ebookmeta

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func zipFile(t *testing.T, files map[string]string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "b.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for n, b := range files {
		w, _ := zw.Create(n)
		_, _ = w.Write([]byte(b))
	}
	_ = zw.Close()
	_ = f.Close()
	return p
}

const containerXML = `<container><rootfiles><rootfile full-path="OPS/p.opf"/></rootfiles></container>`

func TestEPUBMetadata(t *testing.T) {
	p := zipFile(t, map[string]string{
		"META-INF/container.xml": containerXML,
		"OPS/p.opf": `<package xmlns:dc="x"><metadata><dc:title> A  Title </dc:title><dc:creator>One</dc:creator><dc:creator>Two</dc:creator>` +
			`<dc:language>de</dc:language><dc:identifier>urn:uuid:abc</dc:identifier><dc:identifier>urn:isbn:978-3-16-148410-0</dc:identifier>` +
			`<meta property="belongs-to-collection">Series X</meta><meta property="group-position">3</meta></metadata></package>`,
	})
	m, err := Read(p, "epub")
	if err != nil {
		t.Fatal(err)
	}
	if m.Title != "A Title" || len(m.Authors) != 2 || m.Language != "de" || m.Identifier != "9783161484100" ||
		m.Series != "Series X" || m.SeriesIndex == nil || *m.SeriesIndex != 3 || m.Source != "embedded" {
		t.Fatalf("%+v", m)
	}
}

func TestEPUBRejectsEscapingRootAndOversize(t *testing.T) {
	bad := zipFile(t, map[string]string{"META-INF/container.xml": `<container><rootfiles><rootfile full-path="../../etc/x"/></rootfiles></container>`})
	if _, err := Read(bad, "epub"); err == nil {
		t.Fatal("escaping rootfile accepted")
	}
	big := zipFile(t, map[string]string{"META-INF/container.xml": containerXML, "OPS/p.opf": strings.Repeat("x", maxXMLBytes+10)})
	if _, err := Read(big, "epub"); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("oversize opf: %v", err)
	}
	notZip := filepath.Join(t.TempDir(), "n.epub")
	_ = os.WriteFile(notZip, []byte("not a zip"), 0o644)
	if _, err := Read(notZip, "epub"); err == nil {
		t.Fatal("non-zip accepted")
	}
}

func TestComicInfoAndFB2AndUnsupported(t *testing.T) {
	p := zipFile(t, map[string]string{"ComicInfo.xml": `<ComicInfo><Title>T</Title><Series>S</Series><Number>1.5</Number><Writer>A, B</Writer></ComicInfo>`})
	m, err := Read(p, "cbz")
	if err != nil || m.Title != "T" || m.Series != "S" || *m.SeriesIndex != 1.5 || len(m.Authors) != 2 {
		t.Fatalf("%+v %v", m, err)
	}
	fb := filepath.Join(t.TempDir(), "b.fb2")
	_ = os.WriteFile(fb, []byte(`<FictionBook><description><title-info><author><first-name>Ann</first-name><last-name>Lee</last-name></author>`+
		`<book-title>FB Title</book-title><lang>en</lang><sequence name="Sq" number="2"/></title-info></description><body/></FictionBook>`), 0o644)
	m, err = Read(fb, "fb2")
	if err != nil || m.Title != "FB Title" || m.Authors[0] != "Ann Lee" || m.Series != "Sq" {
		t.Fatalf("%+v %v", m, err)
	}
	if _, err := Read(fb, "pdf"); err != ErrUnsupported {
		t.Fatalf("pdf: %v", err)
	}
}

func TestISBN(t *testing.T) {
	for in, want := range map[string]string{"urn:isbn:0-306-40615-2": "0306406152", "ISBN:978 0 306 40615 7": "9780306406157", "urn:uuid:1234": "", "12345": ""} {
		if got := normISBN(in); got != want {
			t.Errorf("%q: %q want %q", in, got, want)
		}
	}
}
