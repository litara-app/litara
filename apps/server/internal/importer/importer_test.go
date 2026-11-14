package importer_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/importer"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/library"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func TestSanitizeAndRender(t *testing.T) {
	cases := map[string]string{
		"..":                     "Unknown",
		"a/b":                    "a_b",
		`c:\x`:                   "c__x",
		"CON":                    "_CON",
		"nul.txt":                "_nul.txt",
		"trailing. ":             "trailing",
		"  .hidden":              "hidden",
		"bad\x00name\x07":        "badname",
		"What? *Is* <this>":      "What_ _Is_ _this_",
		"":                       "Unknown",
		strings.Repeat("é", 200): strings.Repeat("é", 60),
	}
	for in, want := range cases {
		got := importer.SanitizeComponent(in)
		if got != want {
			t.Errorf("%q => %q, want %q", in, got, want)
		}
	}
	if long := importer.SanitizeComponent(strings.Repeat("a", 300) + ".mp3"); len(long) > 120 || !strings.HasSuffix(long, ".mp3") {
		t.Errorf("long names keep their extension and stay bounded: %d %q", len(long), long[len(long)-8:])
	}
	got, err := importer.Render("{author}/{series}/{title}/{filename}", importer.Values{Author: "../../etc", Title: "T/x", Filename: "01.mp3"})
	if err != nil || got != "_.._etc/T_x/01.mp3" {
		t.Fatalf("hostile values cannot escape and an empty optional folder is omitted: %q %v", got, err)
	}
	if got := importer.WithSuffix("A/B/file.mp3", 2); got != "A/B/file (2).mp3" {
		t.Fatalf("suffix: %q", got)
	}
}

func TestValidateTemplate(t *testing.T) {
	for _, ok := range []string{"{filename}", "{author}/{title}/{filename}", "{author}/{series} {series_index}/{filename}"} {
		if err := importer.ValidateTemplate(ok); err != nil {
			t.Errorf("%q: %v", ok, err)
		}
	}
	for _, bad := range []string{"", "/abs/{filename}", "../{filename}", "{author}/{nope}/{filename}", "{author}/{title}", `a\b/{filename}`, "{author", "{author}/x:{filename}"} {
		if err := importer.ValidateTemplate(bad); err == nil {
			t.Errorf("%q must be rejected", bad)
		}
	}
}

type env struct {
	t    *testing.T
	pool *pgxpool.Pool
	root string
	src  string
	lib  uuid.UUID
	svc  *importer.Service
}

func newEnv(t *testing.T, mode string) *env {
	pool := testutil.MigratedDatabase(t)
	root, src := t.TempDir(), t.TempDir()
	d, err := library.New(pool).Create(context.Background(), wire.CreateLibrary{Name: "M", Config: wire.LibraryConfig{
		Mode: mode, RootPath: root, ScanIntervalSecs: 900, VerifyIntervalSecs: 86400, StabilitySecs: 30, ProviderOrder: []string{}}})
	if err != nil {
		t.Fatal(err)
	}
	insp := inspect.New(inspect.Config{ProbePath: testutil.Tool(t, "ffprobe")})
	return &env{t: t, pool: pool, root: root, src: src, lib: uuid.MustParse(d.Library.ID), svc: &importer.Service{Pool: pool, Inspector: insp}}
}

func (e *env) audio(dir, name string, freq int, tags ...string) string {
	p := filepath.Join(dir, name)
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	args := []string{"-f", "lavfi", "-i", fmt.Sprintf("sine=frequency=%d:duration=1", freq)}
	for i := 0; i+1 < len(tags); i += 2 {
		args = append(args, "-metadata", tags[i]+"="+tags[i+1])
	}
	testutil.FFmpeg(e.t, append(args, "-c:a", "libmp3lame", "-b:a", "32k", p)...)
	return p
}

func sha(t *testing.T, p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return fmt.Sprintf("%x", len(b)) + string(b[len(b)/2:len(b)/2+8])
}

func TestIndexLibrariesRefuseImports(t *testing.T) {
	e := newEnv(t, "index")
	if _, _, err := e.svc.Plan(context.Background(), e.lib, e.src, uuid.Nil); err == nil {
		t.Fatal("imports are opt-in per library: index libraries must refuse")
	}
}

func TestPlanReviewApproveCopyKeepsSourceAndNeverOverwrites(t *testing.T) {
	e := newEnv(t, "managed")
	ctx := context.Background()
	a := e.audio(e.src, "01.mp3", 440, "album", "The Book", "artist", "An Author")
	b := e.audio(e.src, "02.mp3", 523, "album", "The Book", "artist", "An Author")
	before := map[string]string{a: sha(t, a), b: sha(t, b)}

	// An existing library file already occupies the first target name.
	existing := e.audio(filepath.Join(e.root, "An Author", "The Book"), "01.mp3", 880)
	existingSum := sha(t, existing)

	plan, items, err := e.svc.Plan(ctx, e.lib, e.src, uuid.Nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("items: %+v", items)
	}
	byTarget := map[string]bool{}
	var suffixed int
	for _, it := range items {
		byTarget[it.TargetRel] = true
		if it.Suffixed {
			suffixed++
		}
	}
	if !byTarget["An Author/The Book/01 (2).mp3"] || !byTarget["An Author/The Book/02.mp3"] || suffixed != 1 {
		t.Fatalf("collision gets a visible suffix, not an overwrite: %v", byTarget)
	}
	for _, p := range []string{a, b} {
		if sha(t, p) != before[p] {
			t.Fatal("planning must not modify the source")
		}
	}
	// Nothing was copied by planning alone.
	if _, err := os.Stat(filepath.Join(e.root, "An Author", "The Book", "02.mp3")); err == nil {
		t.Fatal("no copy before approval")
	}

	if err := e.svc.Execute(ctx, plan.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(e.root, "An Author", "The Book", "02.mp3")); err == nil {
		t.Fatal("an unapproved plan must not run")
	}
	if err := e.svc.Approve(ctx, plan.ID, uuid.Nil); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Execute(ctx, plan.ID); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"An Author/The Book/01 (2).mp3", "An Author/The Book/02.mp3"} {
		if _, err := os.Stat(filepath.Join(e.root, filepath.FromSlash(rel))); err != nil {
			t.Fatalf("%s not published: %v", rel, err)
		}
	}
	if sha(t, existing) != existingSum {
		t.Fatal("an existing library file was modified")
	}
	for _, p := range []string{a, b} {
		if sha(t, p) != before[p] {
			t.Fatal("source must be retained unchanged")
		}
	}
	left, _ := filepath.Glob(filepath.Join(e.root, "*", "*", ".litara-import-*"))
	if len(left) != 0 {
		t.Fatalf("temporary copies left behind: %v", left)
	}
	// Re-running a completed plan changes nothing.
	if err := e.svc.Execute(ctx, plan.ID); err != nil {
		t.Fatal(err)
	}
}

func TestDuplicatesAreSkippedUnlessKept(t *testing.T) {
	e := newEnv(t, "managed")
	ctx := context.Background()
	// The library already holds these bytes (cataloged with a fingerprint).
	dup := e.audio(e.src, "dup.mp3", 440, "album", "D", "artist", "A")
	data, _ := os.ReadFile(dup)
	libFile := filepath.Join(e.root, "A", "D", "existing.mp3")
	_ = os.MkdirAll(filepath.Dir(libFile), 0o755)
	_ = os.WriteFile(libFile, data, 0o644)
	sum := importerHash(t, libFile)
	var fid, ver uuid.UUID = uuid.New(), uuid.New()
	for _, q := range []string{
		fmt.Sprintf(`INSERT INTO media_files (id) VALUES ('%s')`, fid),
		fmt.Sprintf(`INSERT INTO file_versions (content_version,file_id,locator,filename,mime_type,size_bytes) VALUES ('%s','%s','x','existing.mp3','audio/mpeg',%d)`, ver, fid, len(data)),
		fmt.Sprintf(`INSERT INTO fingerprints (content_version,sha256,size_bytes,mtime) VALUES ('%s','%s',%d,now())`, ver, sum, len(data)),
		fmt.Sprintf(`INSERT INTO file_observations (file_id,library_id,rel_path,size_bytes,mtime) VALUES ('%s','%s','A/D/existing.mp3',%d,now())`, fid, e.lib, len(data)),
	} {
		if _, err := e.pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	e.audio(e.src, "fresh.mp3", 659, "album", "F", "artist", "A")
	// A second copy of the same fresh bytes inside the import is also a duplicate.
	fd, _ := os.ReadFile(filepath.Join(e.src, "fresh.mp3"))
	_ = os.WriteFile(filepath.Join(e.src, "zz-copy.mp3"), fd, 0o644)

	plan, items, err := e.svc.Plan(ctx, e.lib, e.src, uuid.Nil)
	if err != nil {
		t.Fatal(err)
	}
	dec := map[string]string{}
	for _, it := range items {
		dec[it.SourceRel] = it.Decision
	}
	if dec["dup.mp3"] != "skip" || dec["fresh.mp3"] != "pending" || dec["zz-copy.mp3"] != "skip" {
		t.Fatalf("decisions: %v", dec)
	}
	// A reviewer may keep a duplicate explicitly.
	for _, it := range items {
		if it.SourceRel == "dup.mp3" {
			if err := e.svc.SetDecision(ctx, plan.ID, it.ID, "import"); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := e.svc.Approve(ctx, plan.ID, uuid.Nil); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SetDecision(ctx, plan.ID, items[0].ID, "skip"); err == nil {
		t.Fatal("an approved plan is no longer editable")
	}
	if err := e.svc.Execute(ctx, plan.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(e.root, "A", "D", "dup.mp3")); err != nil {
		t.Fatal("kept duplicate must be imported")
	}
	if _, err := os.Stat(filepath.Join(e.root, "A", "F", "fresh.mp3")); err != nil {
		t.Fatal("fresh file must be imported")
	}
	if _, err := os.Stat(filepath.Join(e.root, "A", "F", "zz-copy.mp3")); err == nil {
		t.Fatal("skipped duplicate must not be copied")
	}
}

func importerHash(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return sha256hex(b)
}

func TestSourceChangedAfterReviewIsNotImported(t *testing.T) {
	e := newEnv(t, "managed")
	ctx := context.Background()
	p := e.audio(e.src, "01.mp3", 440, "album", "Book", "artist", "Auth")
	plan, _, err := e.svc.Plan(ctx, e.lib, e.src, uuid.Nil)
	if err != nil {
		t.Fatal(err)
	}
	e.audio(e.src, "01.mp3", 880, "album", "Book", "artist", "Auth") // changes after review
	_ = p
	_ = e.svc.Approve(ctx, plan.ID, uuid.Nil)
	_ = e.svc.Execute(ctx, plan.ID)
	if _, err := os.Stat(filepath.Join(e.root, "Auth", "Book", "01.mp3")); err == nil {
		t.Fatal("bytes that differ from the reviewed plan must not be published")
	}
	var state, detail string
	_ = e.pool.QueryRow(ctx, `SELECT state, COALESCE(detail,'') FROM import_items WHERE plan_id=$1`, plan.ID).Scan(&state, &detail)
	if state != "failed" || !strings.Contains(detail, "changed after review") {
		t.Fatalf("item: %s %q", state, detail)
	}
	left, _ := filepath.Glob(filepath.Join(e.root, "*", "*", ".litara-import-*"))
	if len(left) != 0 {
		t.Fatalf("no temp files: %v", left)
	}
}

func TestSourceInsideRootOrContainingItIsRejected(t *testing.T) {
	e := newEnv(t, "managed")
	if _, _, err := e.svc.Plan(context.Background(), e.lib, filepath.Join(e.root), uuid.Nil); err == nil {
		t.Fatal("importing the library root into itself must be rejected")
	}
	if _, _, err := e.svc.Plan(context.Background(), e.lib, "relative/path", uuid.Nil); err == nil {
		t.Fatal("source must be absolute")
	}
}

func TestInterruptedCopyResumes(t *testing.T) {
	e := newEnv(t, "managed")
	ctx := context.Background()
	e.audio(e.src, "01.mp3", 440, "album", "Book", "artist", "Auth")
	plan, items, _ := e.svc.Plan(ctx, e.lib, e.src, uuid.Nil)
	_ = e.svc.Approve(ctx, plan.ID, uuid.Nil)
	// Simulate a crash mid-copy: a leftover temp file and an item stuck in "copying".
	dir := filepath.Join(e.root, "Auth", "Book")
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(filepath.Join(dir, ".litara-import-"+items[0].ID.String()+".tmp"), []byte("partial"), 0o644)
	_, _ = e.pool.Exec(ctx, `UPDATE import_items SET state='copying' WHERE id=$1`, items[0].ID)
	_, _ = e.pool.Exec(ctx, `UPDATE import_plans SET state='running' WHERE id=$1`, plan.ID)
	if err := e.svc.Execute(ctx, plan.ID); err != nil {
		t.Fatal(err)
	}
	if got := importerHash(t, filepath.Join(dir, "01.mp3")); got != items[0].SourceSha256 {
		t.Fatal("resumed copy must match the reviewed bytes")
	}
	if left, _ := filepath.Glob(filepath.Join(dir, ".litara-import-*")); len(left) != 0 {
		t.Fatalf("stale temp file remains: %v", left)
	}
	var state string
	_ = e.pool.QueryRow(ctx, `SELECT state FROM import_plans WHERE id=$1`, plan.ID).Scan(&state)
	if state != "completed" {
		t.Fatalf("plan: %s", state)
	}
}

func sha256hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
