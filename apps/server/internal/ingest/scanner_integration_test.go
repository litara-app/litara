package ingest_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/ingest"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/library"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type env struct {
	t       *testing.T
	pool    *pgxpool.Pool
	q       *sqlcgen.Queries
	root    string
	lib     uuid.UUID
	scanner *ingest.Scanner
	now     time.Time
}

func newEnv(t *testing.T, mutate ...func(*wire.LibraryConfig)) *env {
	t.Helper()
	pool := testutil.MigratedDatabase(t)
	root := t.TempDir()
	cfg := wire.LibraryConfig{Mode: "index", RootPath: root, ScanIntervalSecs: 900, VerifyIntervalSecs: 86400, StabilitySecs: 30, ProviderOrder: []string{}}
	for _, m := range mutate {
		m(&cfg)
	}
	d, err := library.New(pool).Create(context.Background(), wire.CreateLibrary{Name: "Test", Config: cfg})
	if err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, pool: pool, q: sqlcgen.New(pool), root: root, lib: uuid.MustParse(d.Library.ID), now: time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC)}
	insp := inspect.New(inspect.Config{ProbePath: testutil.Tool(t, "ffprobe")})
	e.scanner = &ingest.Scanner{Pool: pool, Inspector: insp, Now: func() time.Time { return e.now }}
	return e
}

// audio writes a small mp3 whose bytes depend on freq (distinct freq => distinct hash).
func (e *env) audio(rel string, freq int, tags ...string) string {
	e.t.Helper()
	p := filepath.Join(e.root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		e.t.Fatal(err)
	}
	args := []string{"-f", "lavfi", "-i", fmt.Sprintf("sine=frequency=%d:duration=1", freq)}
	for i := 0; i+1 < len(tags); i += 2 {
		args = append(args, "-metadata", tags[i]+"="+tags[i+1])
	}
	args = append(args, "-c:a", "libmp3lame", "-b:a", "32k", p)
	testutil.FFmpeg(e.t, args...)
	return p
}

func (e *env) scan(trigger string, advance time.Duration) ingest.Outcome {
	e.t.Helper()
	e.now = e.now.Add(advance)
	run, err := e.q.CreateScanRun(context.Background(), sqlcgen.CreateScanRunParams{LibraryID: e.lib, Trigger: trigger})
	if err != nil {
		e.t.Fatalf("create run: %v", err)
	}
	out, err := e.scanner.Run(context.Background(), run.ID)
	if err != nil {
		e.t.Fatalf("scan: %v", err)
	}
	return out
}

// settle runs the two observations needed before a new or changed file is cataloged.
func (e *env) settle() ingest.Outcome {
	e.scan("manual", time.Minute)
	return e.scan("manual", time.Minute)
}

func (e *env) obs() map[string]sqlcgen.ListObservationsRow {
	rows, err := e.q.ListObservations(context.Background(), e.lib)
	if err != nil {
		e.t.Fatal(err)
	}
	m := map[string]sqlcgen.ListObservationsRow{}
	for _, r := range rows {
		m[r.RelPath] = r
	}
	return m
}

func TestStabilityBeforeCataloging(t *testing.T) {
	e := newEnv(t)
	e.audio("a.mp3", 440)
	e.audio("b.mp3", 523)

	if o := e.scan("manual", 0); o.Added != 0 || o.Pending != 2 || o.Health != "healthy" {
		t.Fatalf("first observation must only record candidates: %+v", o)
	}
	if o := e.scan("manual", 10*time.Second); o.Added != 0 || o.Pending != 2 {
		t.Fatalf("too soon (10s < 30s): %+v", o)
	}
	o := e.scan("manual", 30*time.Second)
	if o.Added != 2 || o.Pending != 0 {
		t.Fatalf("stable after 30s: %+v", o)
	}
	got := e.obs()
	a := got["a.mp3"]
	if a.Sha256 == nil || len(*a.Sha256) != 64 || !a.Available {
		t.Fatalf("fingerprint/availability: %+v", a)
	}
	var dur *int64
	if err := e.pool.QueryRow(context.Background(), `SELECT duration_ms FROM file_versions WHERE content_version=$1`, a.ContentVersion).Scan(&dur); err != nil || dur == nil || *dur < 900 {
		t.Fatalf("duration from real ffprobe: %v %v", dur, err)
	}
	// An unchanged file is not rehashed or re-versioned.
	if o := e.scan("manual", time.Minute); o.Added != 0 || o.Replaced != 0 || o.Moved != 0 {
		t.Fatalf("idempotent rescan: %+v", o)
	}
}

func TestPartialCopyIsNotCatalogedUntilStable(t *testing.T) {
	e := newEnv(t)
	p := e.audio("grow.mp3", 440)
	e.scan("manual", 0)
	f, _ := os.OpenFile(p, os.O_APPEND|os.O_WRONLY, 0)
	_, _ = f.Write([]byte("more bytes arrive"))
	f.Close()
	if o := e.scan("manual", time.Minute); o.Added != 0 || o.Pending != 1 {
		t.Fatalf("size changed between observations: %+v", o)
	}
	if o := e.scan("manual", 31*time.Second); o.Added != 1 {
		t.Fatalf("now stable: %+v", o)
	}
}

func TestUniqueMovePreservesIdentity(t *testing.T) {
	e := newEnv(t)
	old := e.audio("old/name.mp3", 440)
	e.settle()
	before := e.obs()["old/name.mp3"]

	if err := os.MkdirAll(filepath.Join(e.root, "new"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(old, filepath.Join(e.root, "new", "renamed.mp3")); err != nil {
		t.Fatal(err)
	}
	e.scan("manual", time.Minute) // new path becomes a candidate
	o := e.scan("manual", time.Minute)
	if o.Moved != 1 || o.Added != 0 {
		t.Fatalf("move: %+v", o)
	}
	after := e.obs()["new/renamed.mp3"]
	if after.FileID != before.FileID || after.ContentVersion != before.ContentVersion {
		t.Fatalf("identity/version must survive a move: %+v vs %+v", after, before)
	}
	if _, still := e.obs()["old/name.mp3"]; still {
		t.Fatal("old path must be replaced")
	}
}

func TestAmbiguousMoveGoesToReview(t *testing.T) {
	e := newEnv(t)
	a := e.audio("a.mp3", 440)
	b := filepath.Join(e.root, "b.mp3")
	data, _ := os.ReadFile(a)
	if err := os.WriteFile(b, data, 0o644); err != nil { // identical bytes, distinct file
		t.Fatal(err)
	}
	e.settle()
	idA, idB := e.obs()["a.mp3"].FileID, e.obs()["b.mp3"].FileID
	if idA == idB {
		t.Fatal("duplicate content must still be two files")
	}
	_ = os.Rename(a, filepath.Join(e.root, "c.mp3"))
	_ = os.Rename(b, filepath.Join(e.root, "d.mp3"))
	e.scan("manual", time.Minute)
	o := e.scan("manual", time.Minute)
	if o.Moved != 0 || o.Review != 1 {
		t.Fatalf("ambiguous: %+v", o)
	}
	reviews, _ := e.q.ListOpenReviews(context.Background(), e.lib)
	if len(reviews) != 1 || reviews[0].Kind != "move" {
		t.Fatalf("reviews: %+v", reviews)
	}
	if _, ok := e.obs()["c.mp3"]; ok {
		t.Fatal("no identity may be transferred without review")
	}
	// Re-scanning refreshes the same question; it does not duplicate it.
	e.scan("manual", time.Minute)
	if reviews, _ = e.q.ListOpenReviews(context.Background(), e.lib); len(reviews) != 1 {
		t.Fatalf("duplicate review items: %d", len(reviews))
	}
}

func TestSamePathReplacementCreatesNewVersion(t *testing.T) {
	e := newEnv(t)
	p := e.audio("book.mp3", 440)
	e.settle()
	before := e.obs()["book.mp3"]

	e.audio("book.mp3", 880) // different bytes, same path
	_ = p
	e.scan("manual", time.Minute)
	o := e.scan("manual", time.Minute)
	if o.Replaced != 1 || o.Added != 0 {
		t.Fatalf("replace: %+v", o)
	}
	after := e.obs()["book.mp3"]
	if after.FileID != before.FileID || after.ContentVersion == before.ContentVersion {
		t.Fatalf("same file ID, new version expected: %+v vs %+v", after, before)
	}
	var cur, total int
	_ = e.pool.QueryRow(context.Background(), `SELECT count(*) FILTER (WHERE current), count(*) FROM file_versions WHERE file_id=$1`, before.FileID).Scan(&cur, &total)
	if cur != 1 || total != 2 {
		t.Fatalf("versions current=%d total=%d", cur, total)
	}
}

func TestAbsenceNeedsTwoHealthyScansAndNeverDeletes(t *testing.T) {
	e := newEnv(t)
	e.audio("keep.mp3", 440)
	gone := e.audio("gone.mp3", 523)
	e.settle()

	_ = os.Remove(gone)
	if o := e.scan("manual", time.Minute); o.Absent != 1 {
		t.Fatalf("first absence: %+v", o)
	}
	if g := e.obs()["gone.mp3"]; g.Missing || !g.Available {
		t.Fatalf("one absence must not mark missing: %+v", g)
	}
	e.scan("manual", time.Minute)
	g := e.obs()["gone.mp3"]
	if !g.Missing || g.Available {
		t.Fatalf("two absences mark missing/unavailable: %+v", g)
	}
	var n int
	_ = e.pool.QueryRow(context.Background(), `SELECT count(*) FROM media_files`).Scan(&n)
	if n != 2 {
		t.Fatalf("catalog rows must be retained, have %d", n)
	}

	// The file coming back restores availability under the same identity.
	e.audio("gone.mp3", 523)
	e.scan("manual", time.Minute)
	e.scan("manual", time.Minute)
	if g2 := e.obs()["gone.mp3"]; g2.Missing || !g2.Available || g2.FileID != g.FileID {
		t.Fatalf("restore: %+v", g2)
	}
}

func TestUnavailableRootRetainsCatalog(t *testing.T) {
	e := newEnv(t)
	e.audio("a.mp3", 440)
	e.settle()

	away := e.root + "-away"
	if err := os.Rename(e.root, away); err != nil {
		t.Skipf("cannot rename root on this platform: %v", err)
	}
	t.Cleanup(func() { _ = os.Rename(away, e.root) })
	for i := 0; i < 3; i++ {
		if o := e.scan("manual", time.Minute); o.Health != "unavailable" {
			t.Fatalf("health: %+v", o)
		}
	}
	if a := e.obs()["a.mp3"]; a.Missing || a.MissingScans != 0 || !a.Available {
		t.Fatalf("nothing may be marked missing while the root is unavailable: %+v", a)
	}
	rh, _ := e.q.GetRootHealth(context.Background(), e.lib)
	if rh.State != "unavailable" {
		t.Fatalf("stored health: %+v", rh)
	}
}

func TestIdentitySentinelBlocksAbsenceHandling(t *testing.T) {
	sentinel := "LITARA-LIBRARY-ID"
	var e *env
	e = newEnv(t, func(c *wire.LibraryConfig) {
		// Sentinel is written before the library is configured, as an operator would.
		_ = os.WriteFile(filepath.Join(c.RootPath, sentinel), []byte("library-one"), 0o644)
		sum, _, _ := ingest.HashFile(context.Background(), filepath.Join(c.RootPath, sentinel))
		p := sentinel
		c.SentinelPath, c.SentinelSHA256 = &p, &sum
	})
	e.audio("a.mp3", 440)
	if o := e.settle(); o.Health != "healthy" || o.Added != 1 {
		t.Fatalf("with a matching sentinel: %+v", o)
	}
	// A different share is now mounted at the same path: same sentinel name, other content, no files.
	for _, ent := range mustGlob(t, e.root) {
		_ = os.Remove(ent)
	}
	_ = os.WriteFile(filepath.Join(e.root, sentinel), []byte("some-other-share"), 0o644)
	o := e.scan("manual", time.Minute)
	if o.Health != "identity_mismatch" {
		t.Fatalf("health: %+v", o)
	}
	e.scan("manual", time.Minute)
	if a := e.obs()["a.mp3"]; a.Missing || a.MissingScans != 0 {
		t.Fatalf("mismatched root must not cause absence: %+v", a)
	}
	// The sentinel is never created by the server.
	_ = os.Remove(filepath.Join(e.root, sentinel))
	e.scan("manual", time.Minute)
	if _, err := os.Stat(filepath.Join(e.root, sentinel)); err == nil {
		t.Fatal("scanner must never create a marker file")
	}
}

func mustGlob(t *testing.T, dir string) []string {
	m, err := filepath.Glob(filepath.Join(dir, "*"))
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestEmptyListingWithoutSentinelIsNotTrusted(t *testing.T) {
	e := newEnv(t)
	a := e.audio("a.mp3", 440)
	e.settle()
	_ = os.Remove(a)
	o := e.scan("manual", time.Minute)
	if o.Health != "unavailable" {
		t.Fatalf("an empty listing with no identity check proves nothing: %+v", o)
	}
	if g := e.obs()["a.mp3"]; g.MissingScans != 0 {
		t.Fatalf("must not count absence: %+v", g)
	}
}

func TestSymlinksIgnoredByDefaultAndContained(t *testing.T) {
	outside := t.TempDir()
	e := newEnv(t)
	secret := filepath.Join(outside, "outside.mp3")
	testutil.FFmpeg(t, append(testutil.Sine(1), "-c:a", "libmp3lame", secret)...)
	if err := os.Symlink(secret, filepath.Join(e.root, "link.mp3")); err != nil {
		t.Skipf("symlinks unavailable on this platform/privilege: %v", err)
	}
	e.audio("real.mp3", 440)
	e.settle()
	got := e.obs()
	if _, ok := got["link.mp3"]; ok || len(got) != 1 {
		t.Fatalf("symlink must be ignored by default: %v", got)
	}
}

func TestVerificationDetectsChangedBytesWithPreservedStat(t *testing.T) {
	e := newEnv(t)
	p := e.audio("same.mp3", 440)
	e.settle()
	before := e.obs()["same.mp3"]
	info, _ := os.Stat(p)

	data, _ := os.ReadFile(p)
	data[len(data)/2] ^= 0xFF // flip bytes, keep length
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(p, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if o := e.scan("manual", time.Minute); o.Replaced != 0 {
		t.Fatalf("an ordinary scan must not claim to detect this: %+v", o)
	}
	o := e.scan("verify", time.Minute)
	if o.Replaced != 1 {
		t.Fatalf("verification scan: %+v", o)
	}
	if after := e.obs()["same.mp3"]; after.ContentVersion == before.ContentVersion || after.FileID != before.FileID {
		t.Fatalf("expected new version for the same file: %+v", after)
	}
}
