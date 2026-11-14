package writeback_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/ingest"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/library"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
	"github.com/deranjer/ebooker/apps/server/internal/writeback"
)

// ffmpegWriter is a TEST-ONLY mp3 tag writer (stream copy). It stands in for a
// real writer to exercise the engine; no production writer is registered.
type ffmpegWriter struct {
	t       *testing.T
	dropMap bool // simulate a lossy writer that loses a stream
}

func (w ffmpegWriter) Format() string { return "mp3" }
func (w ffmpegWriter) Write(ctx context.Context, src, dst string, ch metadata.Fields) error {
	args := []string{"-v", "error", "-y", "-i", src, "-map", "0:a", "-c", "copy", "-f", "mp3"}
	if t, ok := ch["title"]; ok {
		args = append(args, "-metadata", "title="+strings.Trim(string(t), `"`))
	}
	if w.dropMap {
		args = []string{"-v", "error", "-y", "-i", src, "-t", "0.2", "-c", "copy", "-f", "mp3", dst}
		return exec.CommandContext(ctx, testutil.Tool(w.t, "ffmpeg"), args...).Run()
	}
	args = append(args, dst)
	return exec.CommandContext(ctx, testutil.Tool(w.t, "ffmpeg"), args...).Run()
}
func (ffmpegWriter) Validate(context.Context, string, string, metadata.Fields) error { return nil }

type env struct {
	t       *testing.T
	pool    *pgxpool.Pool
	q       *sqlcgen.Queries
	root    string
	lib     uuid.UUID
	scanner *ingest.Scanner
	svc     *writeback.Service
	now     time.Time
	rec     uuid.UUID
	file    uuid.UUID
	media   string
}

func newEnv(t *testing.T, mutate ...func(*wire.LibraryConfig)) *env {
	pool := testutil.MigratedDatabase(t)
	root := t.TempDir()
	cfg := wire.LibraryConfig{Mode: "index", RootPath: root, ScanIntervalSecs: 900, VerifyIntervalSecs: 86400, StabilitySecs: 30, ProviderOrder: []string{}}
	for _, m := range mutate {
		m(&cfg)
	}
	d, err := library.New(pool).Create(context.Background(), wire.CreateLibrary{Name: "W", Config: cfg})
	if err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, pool: pool, q: sqlcgen.New(pool), root: root, lib: uuid.MustParse(d.Library.ID), now: time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC)}
	insp := inspect.New(inspect.Config{ProbePath: testutil.Tool(t, "ffprobe")})
	e.scanner = &ingest.Scanner{Pool: pool, Inspector: insp, Now: func() time.Time { return e.now }}
	e.svc = &writeback.Service{Pool: pool, Inspector: insp, Scanner: e.scanner, Metadata: metadata.New(pool), Writers: map[string]writeback.Writer{}}

	e.media = filepath.Join(root, "Book", "1.mp3")
	_ = os.MkdirAll(filepath.Dir(e.media), 0o755)
	testutil.FFmpeg(t, append(testutil.Sine(1), "-metadata", "album=Book", "-metadata", "artist=Author", "-c:a", "libmp3lame", "-b:a", "32k", e.media)...)
	e.scan()
	e.scan()
	recs, _ := e.q.ListLibraryRecordings(context.Background(), e.lib)
	if len(recs) != 1 {
		t.Fatalf("setup: %d recordings", len(recs))
	}
	e.rec = recs[0].ID
	e.file, _ = e.q.FirstRecordingFile(context.Background(), e.rec)
	return e
}

func (e *env) scan() {
	e.now = e.now.Add(time.Minute)
	run, err := e.q.CreateScanRun(context.Background(), sqlcgen.CreateScanRunParams{LibraryID: e.lib, Trigger: "manual"})
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.scanner.Run(context.Background(), run.ID); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) hash(p string) string {
	s, err := writebackHash(p)
	if err != nil {
		e.t.Fatal(err)
	}
	return s
}

func writebackHash(p string) (string, error) {
	s, _, err := ingest.HashFile(context.Background(), p)
	return s, err
}

func (e *env) approveRun(plan uuid.UUID) error {
	if err := e.svc.Approve(context.Background(), plan, uuid.Nil); err != nil {
		e.t.Fatal(err)
	}
	return e.svc.Execute(context.Background(), plan)
}

func (e *env) noTemps() {
	e.t.Helper()
	left, _ := filepath.Glob(filepath.Join(e.root, "*", ".litara-write-*"))
	if len(left) != 0 {
		e.t.Fatalf("staged files left behind: %v", left)
	}
}

func code(err error) string {
	if ae, ok := apperr.As(err); ok {
		return ae.Code
	}
	return fmt.Sprint(err)
}

func TestSidecarExportNeedsApprovalAndLeavesMediaUntouched(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	mediaBefore := e.hash(e.media)

	plan, err := e.svc.PlanSidecar(ctx, e.rec)
	if err != nil {
		t.Fatal(err)
	}
	if plan.TargetRel != "Book/litara.json" || plan.Kind != "sidecar" {
		t.Fatalf("plan: %+v", plan)
	}
	if err := e.svc.Execute(ctx, plan.ID); code(err) != "plan_not_runnable" {
		t.Fatalf("an unapproved plan must not run: %v", err)
	}
	if _, err := os.Stat(filepath.Join(e.root, "Book", "litara.json")); err == nil {
		t.Fatal("nothing is written before approval")
	}
	if err := e.approveRun(plan.ID); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(e.root, "Book", "litara.json"))
	if err != nil || !strings.Contains(string(b), `"title": "Book"`) {
		t.Fatalf("sidecar: %s %v", b, err)
	}
	if e.hash(e.media) != mediaBefore {
		t.Fatal("a sidecar export must not touch the media file")
	}
	e.noTemps()

	// A next scan associates the new sidecar (unambiguous), closing the loop.
	e.scan()
	assoc, _ := e.q.ListAssociations(ctx, e.lib)
	found := false
	for _, a := range assoc {
		if a.RelPath == "Book/litara.json" && a.State == "associated" {
			found = true
		}
	}
	if !found {
		t.Fatalf("exported sidecar should associate: %+v", assoc)
	}
}

func TestChangedAfterReviewIsRefused(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	target := filepath.Join(e.root, "Book", "litara.json")
	_ = os.WriteFile(target, []byte(`{"title":"Old"}`), 0o644)
	plan, err := e.svc.PlanSidecar(ctx, e.rec)
	if err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(target, []byte(`{"title":"Edited by someone else"}`), 0o644) // changes after review
	if err := e.approveRun(plan.ID); code(err) != "write_refused" {
		t.Fatalf("expected refusal, got %v", err)
	}
	if b, _ := os.ReadFile(target); !strings.Contains(string(b), "someone else") {
		t.Fatal("the changed file must be left exactly as found")
	}
	e.noTemps()
	if p, _ := e.q.GetWritebackPlan(ctx, plan.ID); p.Stage != "refused" {
		t.Fatalf("stage: %s", p.Stage)
	}
}

func TestInFileWritingIsDisabledUntilEvidenceIsRecorded(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	ch := metadata.Fields{"title": []byte(`"New"`)}
	if _, err := e.svc.PlanInFile(ctx, e.file, ch); code(err) != "writer_disabled" {
		t.Fatalf("no writer is registered: %v", err)
	}
	e.svc.Writers["mp3"] = ffmpegWriter{t: t}
	if _, err := e.svc.PlanInFile(ctx, e.file, ch); code(err) != "writer_disabled" {
		t.Fatalf("a registered writer without recorded evidence stays disabled: %v", err)
	}
	if _, err := e.pool.Exec(ctx, `UPDATE writer_capabilities SET enabled=true WHERE format='mp3'`); err == nil {
		t.Fatal("the schema must refuse enabling a writer without an evidence reference")
	}
}

func (e *env) enableMP3(w writeback.Writer) {
	e.svc.Writers["mp3"] = w
	if err := e.q.SetWriterCapability(context.Background(), sqlcgen.SetWriterCapabilityParams{Format: "mp3", Enabled: true, EvidenceRef: strPtr("test-only")}); err != nil {
		e.t.Fatal(err)
	}
}

func strPtr(s string) *string { return &s }

func TestInFileWriteCreatesNewContentVersionAndInvalidatesLayout(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.enableMP3(ffmpegWriter{t: t})
	var layout1 uuid.UUID
	_ = e.pool.QueryRow(ctx, `SELECT layout_revision FROM recordings WHERE id=$1`, e.rec).Scan(&layout1)
	cur1, _ := e.q.GetFileCurrent(ctx, e.file)

	plan, err := e.svc.PlanInFile(ctx, e.file, metadata.Fields{"title": []byte(`"Rewritten"`)})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.approveRun(plan.ID); err != nil {
		t.Fatalf("execute: %v", err)
	}
	res, err := inspect.New(inspect.Config{ProbePath: testutil.Tool(t, "ffprobe")}).Inspect(ctx, e.media)
	if err != nil || res.Format.Tags["title"] != "Rewritten" {
		t.Fatalf("tag written: %+v %v", res.Format.Tags, err)
	}
	cur2, _ := e.q.GetFileCurrent(ctx, e.file)
	if cur2.FileID != cur1.FileID || cur2.ContentVersion == cur1.ContentVersion {
		t.Fatalf("same file ID, new version expected: %v vs %v", cur2.ContentVersion, cur1.ContentVersion)
	}
	var layout2 uuid.UUID
	_ = e.pool.QueryRow(ctx, `SELECT layout_revision FROM recordings WHERE id=$1`, e.rec).Scan(&layout2)
	if layout1 == layout2 {
		t.Fatal("changed bytes must invalidate the layout, not silently carry positions over")
	}
	e.noTemps()
}

func TestLossyWriterIsRejectedByValidation(t *testing.T) {
	e := newEnv(t)
	e.enableMP3(ffmpegWriter{t: t, dropMap: true}) // truncates the audio
	before := e.hash(e.media)
	plan, err := e.svc.PlanInFile(context.Background(), e.file, metadata.Fields{"title": []byte(`"X"`)})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.approveRun(plan.ID); code(err) != "write_refused" {
		t.Fatalf("a writer that changes the duration must be refused: %v", err)
	}
	if e.hash(e.media) != before {
		t.Fatal("original changed despite failed validation")
	}
	e.noTemps()
}

func TestBackupsDefaultOffAndOptInFailureBlocksTheWrite(t *testing.T) {
	// Default: no backup is made and the write proceeds.
	e := newEnv(t)
	plan, _ := e.svc.PlanSidecar(context.Background(), e.rec)
	if err := e.approveRun(plan.ID); err != nil {
		t.Fatal(err)
	}
	if p, _ := e.q.GetWritebackPlan(context.Background(), plan.ID); p.BackupRef != nil {
		t.Fatalf("backups are off by default: %v", *p.BackupRef)
	}

	// Opt-in with an unusable backup location: the write is blocked.
	blocker := filepath.Join(t.TempDir(), "file-not-dir")
	_ = os.WriteFile(blocker, []byte("x"), 0o644)
	bad := filepath.Join(blocker, "backups") // a path beneath a regular file
	e2 := newEnv(t, func(c *wire.LibraryConfig) { c.WritebackBackups, c.BackupRoot = true, &bad })
	e2.enableMP3(ffmpegWriter{t: t})
	before := e2.hash(e2.media)
	p2, err := e2.svc.PlanInFile(context.Background(), e2.file, metadata.Fields{"title": []byte(`"X"`)})
	if err != nil {
		t.Fatal(err)
	}
	if err := e2.approveRun(p2.ID); code(err) != "write_refused" {
		t.Fatalf("backup failure must block: %v", err)
	}
	if e2.hash(e2.media) != before {
		t.Fatal("original must be untouched when the backup fails")
	}
	e2.noTemps()

	// Opt-in with a working backup location: the original is preserved verbatim.
	good := t.TempDir()
	e3 := newEnv(t, func(c *wire.LibraryConfig) { c.WritebackBackups, c.BackupRoot = true, &good })
	e3.enableMP3(ffmpegWriter{t: t})
	orig := e3.hash(e3.media)
	p3, _ := e3.svc.PlanInFile(context.Background(), e3.file, metadata.Fields{"title": []byte(`"Y"`)})
	if err := e3.approveRun(p3.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := e3.q.GetWritebackPlan(context.Background(), p3.ID)
	if got.BackupRef == nil || e3.hash(*got.BackupRef) != orig {
		t.Fatalf("backup must hold the original bytes: %+v", got.BackupRef)
	}
	if e3.hash(e3.media) == orig {
		t.Fatal("the write should have changed the file")
	}
}

// Crash at each journal stage (backups off): recovery completes a verified
// replacement or leaves the original, and the target is never torn.
func TestCrashRecoveryAtEveryJournalStage(t *testing.T) {
	for _, tc := range []struct {
		stage     string
		completed bool
	}{{"after_stage_write", false}, {"after_validated", true}} {
		t.Run(tc.stage, func(t *testing.T) {
			e := newEnv(t)
			ctx := context.Background()
			e.enableMP3(ffmpegWriter{t: t})
			orig := e.hash(e.media)
			e.svc.Crash = func(stage string) error {
				if stage == tc.stage {
					return errors.New("simulated crash")
				}
				return nil
			}
			plan, _ := e.svc.PlanInFile(ctx, e.file, metadata.Fields{"title": []byte(`"After crash"`)})
			if err := e.approveRun(plan.ID); err == nil || !strings.Contains(err.Error(), "simulated crash") {
				t.Fatalf("expected the simulated crash, got %v", err)
			}
			mid := e.hash(e.media)
			if mid != orig {
				t.Fatal("a crash before publish must leave the original byte-identical")
			}
			e.svc.Crash = nil
			done, gone, err := e.svc.Recover(ctx)
			if err != nil {
				t.Fatal(err)
			}
			now := e.hash(e.media)
			switch {
			case tc.completed:
				if done != 1 || gone != 0 || now == orig {
					t.Fatalf("a verified journaled stage is completed: done=%d abandoned=%d", done, gone)
				}
				res, err := inspect.New(inspect.Config{ProbePath: testutil.Tool(t, "ffprobe")}).Inspect(ctx, e.media)
				if err != nil || res.Format.Tags["title"] != "After crash" {
					t.Fatalf("recovered file must be whole and carry the change: %v %v", res, err)
				}
			default:
				if done != 0 || gone != 1 || now != orig {
					t.Fatalf("an unverified stage is abandoned with the original intact: done=%d abandoned=%d", done, gone)
				}
			}
			e.noTemps()
			// Recovery is idempotent.
			if d2, g2, _ := e.svc.Recover(ctx); d2 != 0 || g2 != 0 {
				t.Fatalf("second recovery found work: %d %d", d2, g2)
			}
		})
	}
}

func TestCrashAfterPublishBeforeJournalIsRecognized(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.enableMP3(ffmpegWriter{t: t})
	plan, _ := e.svc.PlanInFile(ctx, e.file, metadata.Fields{"title": []byte(`"P"`)})
	e.svc.Crash = func(stage string) error {
		if stage == "after_validated" {
			return errors.New("simulated crash")
		}
		return nil
	}
	_ = e.approveRun(plan.ID)
	// Simulate: the rename happened but the journal never advanced past 'validated'.
	p, _ := e.q.GetWritebackPlan(ctx, plan.ID)
	if err := os.Rename(*p.StagedPath, e.media); err != nil {
		t.Fatal(err)
	}
	e.svc.Crash = nil
	done, _, err := e.svc.Recover(ctx)
	if err != nil || done != 1 {
		t.Fatalf("already-in-place recovery: %d %v", done, err)
	}
	if p2, _ := e.q.GetWritebackPlan(ctx, plan.ID); p2.Stage != "published" {
		t.Fatalf("stage: %s", p2.Stage)
	}
}
