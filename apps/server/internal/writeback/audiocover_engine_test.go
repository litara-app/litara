package writeback_test

import (
	"bytes"
	"context"
	"image/color"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
	"github.com/deranjer/ebooker/apps/server/internal/writeback"
)

// ADR-0086: an audiobook's stored cover is planned for every file of the recording and written through the engine, which
// accepts one more picture in the file but nothing else.
func TestAudiobookCoverWriteThroughTheEngine(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	var title uuid.UUID
	if err := e.pool.QueryRow(ctx, `SELECT title_id FROM recordings WHERE id = $1`, e.rec).Scan(&title); err != nil {
		t.Fatal(err)
	}

	// The writer is off until evidence is recorded, and there must be a stored cover.
	if _, err := e.svc.PlanCoverInRecording(ctx, e.rec); code(err) != "no_cover" {
		t.Fatalf("no stored cover: %v", err)
	}
	want := solidJPEG(t, color.RGBA{R: 220, G: 90, B: 30, A: 255})
	if _, err := e.q.UpsertTitleCover(ctx, sqlcgen.UpsertTitleCoverParams{TitleID: title, Medium: "audio", Source: "upload", Image: want}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.PlanCoverInRecording(ctx, e.rec); code(err) != "writer_disabled" {
		t.Fatalf("writer off: %v", err)
	}
	if _, err := e.svc.PlanCoverInFile(ctx, e.file, "ebook"); code(err) != "cover_embed_unsupported" {
		t.Fatalf("an audio file is not an ebook edition: %v", err)
	}

	e.enableMP3(writeback.BuiltInWriters()["mp3"])
	plans, err := e.svc.PlanCoverInRecording(ctx, e.rec)
	if err != nil || len(plans) != 1 {
		t.Fatalf("plans: %v %d", err, len(plans))
	}
	before := e.hash(e.media)
	if err := e.svc.Execute(ctx, plans[0].ID); code(err) != "plan_not_runnable" || e.hash(e.media) != before {
		t.Fatalf("an unapproved plan must not run or write: %v", err)
	}
	if err := e.approveRun(plans[0].ID); err != nil {
		t.Fatalf("execute: %v", err)
	}
	res, err := inspect.New(inspect.Config{ProbePath: testutil.Tool(t, "ffprobe")}).Inspect(ctx, e.media)
	if err != nil || len(res.Artwork) != 1 {
		t.Fatalf("the file should now hold one picture: %+v %v", res.Artwork, err)
	}
	out := filepath.Join(t.TempDir(), "cover.jpg")
	testutil.FFmpeg(t, "-v", "error", "-i", e.media, "-map", "0:v:0", "-c", "copy", "-f", "image2", out)
	if got, err := os.ReadFile(out); err != nil || !bytes.Equal(got, want) {
		t.Fatalf("the embedded picture is not the stored cover: %v", err)
	}
	e.noTemps()
}
