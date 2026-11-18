package writeback_test

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/ebookmeta"
	"github.com/deranjer/ebooker/apps/server/internal/ingest"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/library"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
	"github.com/deranjer/ebooker/apps/server/internal/writeback"
)

const engineOPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Engine Old</dc:title>
    <dc:creator>Old Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="uid">urn:uuid:00000000-0000-4000-8000-0000000000d1</dc:identifier>
    <dc:publisher>Untouched Publisher</dc:publisher>
  </metadata>
  <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`

type epubEnv struct {
	*env
	epub string
	file uuid.UUID
}

func newEPUBEnv(t *testing.T) *epubEnv {
	pool := testutil.MigratedDatabase(t)
	root := t.TempDir()
	cfg := wire.LibraryConfig{Mode: "index", RootPath: root, ScanIntervalSecs: 900, VerifyIntervalSecs: 86400, StabilitySecs: 30, ProviderOrder: []string{}}
	d, err := library.New(pool).Create(context.Background(), wire.CreateLibrary{Name: "E", Config: cfg})
	if err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, pool: pool, q: sqlcgen.New(pool), root: root, lib: uuid.MustParse(d.Library.ID), now: time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC)}
	insp := inspect.New(inspect.Config{ProbePath: testutil.Tool(t, "ffprobe")})
	e.scanner = &ingest.Scanner{Pool: pool, Inspector: insp, Now: func() time.Time { return e.now }}
	e.svc = &writeback.Service{Pool: pool, Inspector: insp, Scanner: e.scanner, Metadata: metadata.New(pool), Writers: map[string]writeback.Writer{}}

	p := filepath.Join(root, "Author", "Book.epub")
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	f, _ := os.Create(p)
	zw := zip.NewWriter(f)
	w, _ := zw.CreateHeader(&zip.FileHeader{Name: "mimetype", Method: zip.Store})
	w.Write([]byte("application/epub+zip"))
	w, _ = zw.Create("META-INF/container.xml")
	w.Write([]byte(`<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`))
	w, _ = zw.Create("OEBPS/content.opf")
	w.Write([]byte(engineOPF))
	w, _ = zw.Create("OEBPS/c1.xhtml")
	w.Write([]byte(`<html xmlns="http://www.w3.org/1999/xhtml"><body><p>` + strings.Repeat("Words. ", 300) + `</p></body></html>`))
	zw.Close()
	f.Close()
	e.scan()
	e.scan()
	var file uuid.UUID
	if err := pool.QueryRow(context.Background(), `SELECT file_id FROM file_observations WHERE library_id=$1 AND rel_path LIKE '%.epub'`, e.lib).Scan(&file); err != nil {
		t.Fatalf("setup: the epub was not cataloged: %v", err)
	}
	return &epubEnv{env: e, epub: p, file: file}
}

func (e *epubEnv) enable() {
	e.svc.Writers["epub"] = writeback.EPUBWriter{}
	if err := e.q.SetWriterCapability(context.Background(), sqlcgen.SetWriterCapabilityParams{Format: "epub", Enabled: true, EvidenceRef: strPtr("test-only")}); err != nil {
		e.t.Fatal(err)
	}
}

func TestEPUBWriterIsDisabledUntilEnabledWithEvidence(t *testing.T) {
	e := newEPUBEnv(t)
	ch := metadata.Fields{"title": []byte(`"New"`)}
	if _, err := e.svc.PlanInFile(context.Background(), e.file, ch); code(err) != "writer_disabled" {
		t.Fatalf("expected writer_disabled, got %v", err)
	}
	e.svc.Writers["epub"] = writeback.EPUBWriter{} // registered but no evidence recorded
	if _, err := e.svc.PlanInFile(context.Background(), e.file, ch); code(err) != "writer_disabled" {
		t.Fatalf("a registered writer without recorded evidence stays disabled: %v", err)
	}
}

func TestEPUBInFileWriteThroughTheEngine(t *testing.T) {
	e := newEPUBEnv(t)
	ctx := context.Background()
	e.enable()
	cur1, _ := e.q.GetFileCurrent(ctx, e.file)
	beforeSum := e.hash(e.epub)

	plan, err := e.svc.PlanInFile(ctx, e.file, metadata.Fields{"title": []byte(`"Engine New"`), "authors": []byte(`["New One","New Two"]`)})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Execute(ctx, plan.ID); code(err) != "plan_not_runnable" {
		t.Fatalf("an unapproved plan must not run: %v", err)
	}
	if e.hash(e.epub) != beforeSum {
		t.Fatal("nothing may be written before approval")
	}
	if err := e.approveRun(plan.ID); err != nil {
		t.Fatalf("execute: %v", err)
	}
	got, err := ebookmeta.Read(e.epub, "epub")
	if err != nil || got.Title != "Engine New" || strings.Join(got.Authors, "|") != "New One|New Two" || got.Language != "en" {
		t.Fatalf("read back: %+v %v", got, err)
	}
	cur2, _ := e.q.GetFileCurrent(ctx, e.file)
	if cur2.FileID != cur1.FileID || cur2.ContentVersion == cur1.ContentVersion {
		t.Fatalf("same file identity, new content version expected: %v vs %v", cur2.ContentVersion, cur1.ContentVersion)
	}
	zr, _ := zip.OpenReader(e.epub)
	defer zr.Close()
	if zr.File[0].Name != "mimetype" || zr.File[0].Method != zip.Store {
		t.Fatal("mimetype must stay the first stored entry")
	}
	e.noTemps()
	left, _ := filepath.Glob(filepath.Join(e.root, "*", ".litara-write-*"))
	if len(left) != 0 {
		t.Fatalf("staged files left behind: %v", left)
	}
}

// corruptingEPUBWriter wraps the real writer and then damages an unrelated entry: the engine must refuse and leave the original alone.
type corruptingEPUBWriter struct{ writeback.EPUBWriter }

func (c corruptingEPUBWriter) Write(ctx context.Context, src, dst string, ch metadata.Fields) error {
	if err := c.EPUBWriter.Write(ctx, src, dst, ch); err != nil {
		return err
	}
	b, _ := os.ReadFile(dst)
	i := strings.Index(string(b), "Words.")
	if i < 0 { // the chapter is stored compressed; flip a byte deep inside the archive instead
		i = len(b) / 2
	}
	b[i] ^= 0xFF
	return os.WriteFile(dst, b, 0o600)
}

func TestEPUBEngineRefusesAndKeepsTheOriginalWhenTheStagedFileIsDamaged(t *testing.T) {
	e := newEPUBEnv(t)
	ctx := context.Background()
	e.enable()
	e.svc.Writers["epub"] = corruptingEPUBWriter{}
	before := e.hash(e.epub)
	plan, err := e.svc.PlanInFile(ctx, e.file, metadata.Fields{"title": []byte(`"Should Not Land"`)})
	if err != nil {
		t.Fatal(err)
	}
	err = e.approveRun(plan.ID)
	if code(err) != "write_refused" {
		t.Fatalf("a damaged staged file must be refused: %v", err)
	}
	// It must be the writer's own validation that caught the damage, not an incidental failure.
	if !strings.Contains(err.Error(), "Validation failed") || strings.Contains(err.Error(), "could not be inspected") {
		t.Fatalf("refused for the wrong reason: %v", err)
	}
	if e.hash(e.epub) != before {
		t.Fatal("the original must be untouched after a refused write")
	}
	e.noTemps()
}

func TestEPUBEngineRefusesUnsupportedFieldsWithoutTouchingTheFile(t *testing.T) {
	e := newEPUBEnv(t)
	ctx := context.Background()
	e.enable()
	before := e.hash(e.epub)
	plan, err := e.svc.PlanInFile(ctx, e.file, metadata.Fields{"narrators": []byte(`["N"]`)})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.approveRun(plan.ID); code(err) != "write_refused" {
		t.Fatalf("narrators cannot be written into an EPUB: %v", err)
	}
	if e.hash(e.epub) != before {
		t.Fatal("a refused write must not modify the file")
	}
}
