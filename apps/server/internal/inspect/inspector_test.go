package inspect_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
)

func newInspector(t *testing.T, mut func(*inspect.Config)) *inspect.Inspector {
	t.Helper()
	cfg := inspect.Config{ProbePath: testutil.Tool(t, "ffprobe"), Timeout: 30 * time.Second}
	if mut != nil {
		mut(&cfg)
	}
	return inspect.New(cfg)
}

func hash(t *testing.T, p string) [32]byte {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return sha256.Sum256(b)
}

func wantErr(t *testing.T, err error, want inspect.Outcome) {
	t.Helper()
	got, _ := inspect.OutcomeOf(err)
	if err == nil || got != want {
		t.Fatalf("want outcome %q, got err=%v", want, err)
	}
}

func near(t *testing.T, got *int64, want, tol int64) {
	t.Helper()
	if got == nil {
		t.Fatalf("duration unknown, want ~%d", want)
	}
	if d := *got - want; d < -tol || d > tol {
		t.Fatalf("duration %d ms, want %d±%d", *got, want, tol)
	}
}

func TestCommonFormats(t *testing.T) {
	dir := t.TempDir()
	cases := []struct {
		name  string
		args  []string
		codec string
	}{
		{"cbr.mp3", []string{"-c:a", "libmp3lame", "-b:a", "64k"}, "mp3"},
		{"vbr.mp3", []string{"-c:a", "libmp3lame", "-q:a", "4"}, "mp3"},
		{"book.m4b", []string{"-c:a", "aac", "-f", "ipod"}, "aac"},
		{"track.flac", []string{"-c:a", "flac"}, "flac"},
		{"track.opus", []string{"-c:a", "libopus", "-b:a", "32k"}, "opus"},
		{"track.ogg", []string{"-c:a", "libvorbis"}, "vorbis"},
	}
	insp := newInspector(t, nil)
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := filepath.Join(dir, c.name)
			testutil.FFmpeg(t, append(append(testutil.Sine(3), c.args...), p)...)
			before := hash(t, p)
			res, err := insp.Inspect(context.Background(), p)
			if err != nil {
				t.Fatal(err)
			}
			if res.Completeness != inspect.Complete {
				t.Fatalf("completeness %s issues %v", res.Completeness, res.Issues)
			}
			near(t, res.Format.DurationMs, 3000, 250)
			if len(res.Streams) == 0 || res.Streams[0].Codec != c.codec {
				t.Fatalf("streams %+v", res.Streams)
			}
			if res.Tool.Name != "ffprobe" || res.Tool.Version == "" || res.Source.SizeBytes == 0 {
				t.Fatalf("provenance missing: %+v %+v", res.Tool, res.Source)
			}
			if hash(t, p) != before {
				t.Fatal("inspection modified the original file")
			}
		})
	}
}

func TestChaptersAndArtwork(t *testing.T) {
	dir := t.TempDir()
	meta := filepath.Join(dir, "meta.txt")
	if err := os.WriteFile(meta, []byte(";FFMETADATA1\ntitle=Test Book\n"+
		"[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=One\n"+
		"[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=4000\ntitle=Two\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cover := filepath.Join(dir, "cover.png")
	testutil.FFmpeg(t, "-f", "lavfi", "-i", "color=c=red:s=64x48", "-frames:v", "1", cover)
	book := filepath.Join(dir, "book with chapters.m4b")
	testutil.FFmpeg(t, append(append(testutil.Sine(4), "-i", cover, "-i", meta,
		"-map", "0:a", "-map", "1:v", "-map_metadata", "2", "-map_chapters", "2",
		"-c:a", "aac", "-c:v", "copy", "-disposition:v", "attached_pic", "-f", "ipod"), book)...)

	res, err := newInspector(t, nil).Inspect(context.Background(), book)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Chapters) != 2 {
		t.Fatalf("chapters: %+v", res.Chapters)
	}
	c1, c2 := res.Chapters[0], res.Chapters[1]
	if c1.Title != "One" || c1.StartMs != 0 || c2.Title != "Two" || c2.StartMs != 1500 {
		t.Fatalf("chapters: %+v", res.Chapters)
	}
	if c2.TimeBase == "" || c2.RawStart == 0 {
		t.Fatalf("source units not preserved: %+v", c2)
	}
	if len(res.Artwork) != 1 || res.Artwork[0].Source != "attached_picture" || res.Artwork[0].Width == nil || *res.Artwork[0].Width != 64 {
		t.Fatalf("artwork: %+v", res.Artwork)
	}
	if res.Format.Tags["title"] != "Test Book" {
		t.Fatalf("tags: %v", res.Format.Tags)
	}
}

func TestShellSignificantFilenames(t *testing.T) {
	dir := t.TempDir()
	names := []string{"a b.mp3", "semi;colon.mp3", "dollar$(touch pwned).mp3", "quote's.mp3", "-leading-dash.mp3", "pipe&amp.mp3", "percent%20name.mp3"}
	insp := newInspector(t, nil)
	for _, n := range names {
		p := filepath.Join(dir, n)
		testutil.FFmpeg(t, append(testutil.Sine(1), "-c:a", "libmp3lame", p)...)
		res, err := insp.Inspect(context.Background(), p)
		if err != nil {
			t.Fatalf("%q: %v", n, err)
		}
		near(t, res.Format.DurationMs, 1000, 250)
	}
	if _, err := os.Stat(filepath.Join(dir, "pwned")); err == nil {
		t.Fatal("shell expansion executed")
	}
	if _, err := os.Stat("pwned"); err == nil {
		t.Fatal("shell expansion executed in cwd")
	}
}

func TestFailureOutcomesAreDistinct(t *testing.T) {
	dir := t.TempDir()
	insp := newInspector(t, nil)
	ctx := context.Background()

	_, err := insp.Inspect(ctx, filepath.Join(dir, "nope.mp3"))
	wantErr(t, err, inspect.OutcomeMissingInput)

	_, err = insp.Inspect(ctx, dir)
	wantErr(t, err, inspect.OutcomeUnreadableInput)

	_, err = insp.Inspect(ctx, "relative.mp3")
	wantErr(t, err, inspect.OutcomeMissingInput)

	junk := filepath.Join(dir, "junk.mp3")
	if err := os.WriteFile(junk, bytes.Repeat([]byte("not media "), 5000), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = insp.Inspect(ctx, junk)
	wantErr(t, err, inspect.OutcomeMalformedMedia)
	if _, retry := inspect.OutcomeOf(err); retry {
		t.Fatal("malformed media must not be retryable")
	}

	empty := filepath.Join(dir, "empty.m4a")
	if err := os.WriteFile(empty, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = insp.Inspect(ctx, empty)
	wantErr(t, err, inspect.OutcomeMalformedMedia)

	// Truncated real media: container damaged mid-stream.
	good := filepath.Join(dir, "good.m4a")
	testutil.FFmpeg(t, append(testutil.Sine(3), "-c:a", "aac", good)...)
	b, _ := os.ReadFile(good)
	trunc := filepath.Join(dir, "trunc.m4a")
	if err := os.WriteFile(trunc, b[:len(b)/3], 0o600); err != nil {
		t.Fatal(err)
	}
	if res, err := insp.Inspect(ctx, trunc); err == nil {
		// Some builds recover partial files; then it must not claim complete.
		if res.Completeness == inspect.Complete {
			t.Fatalf("truncated file reported complete: %+v", res.Issues)
		}
	}

	_, err = newInspector(t, func(c *inspect.Config) { c.ProbePath = filepath.Join(dir, "no-such-ffprobe") }).Inspect(ctx, good)
	wantErr(t, err, inspect.OutcomeToolUnavailable)
	if _, retry := inspect.OutcomeOf(err); !retry {
		t.Fatal("tool_unavailable should be retryable")
	}

	_, err = newInspector(t, func(c *inspect.Config) { c.MaxOutputBytes = 64 }).Inspect(ctx, good)
	wantErr(t, err, inspect.OutcomeOutputLimit)

	_, err = newInspector(t, func(c *inspect.Config) { c.MediaRoot = filepath.Join(dir, "sub") }).Inspect(ctx, good)
	wantErr(t, err, inspect.OutcomeUnreadableInput)
}

func TestTimeoutAndCancellation(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.m4a")
	testutil.FFmpeg(t, append(testutil.Sine(2), "-c:a", "aac", p)...)

	_, err := newInspector(t, func(c *inspect.Config) { c.Timeout = time.Nanosecond }).Inspect(context.Background(), p)
	wantErr(t, err, inspect.OutcomeTimeout)
	if _, retry := inspect.OutcomeOf(err); !retry {
		t.Fatal("timeout should be retryable")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = newInspector(t, nil).Inspect(ctx, p)
	wantErr(t, err, inspect.OutcomeCancelled)
}

func TestLargeSparseFileIsBoundedAndUnchanged(t *testing.T) {
	// Exercises: a 3 GiB zero-filled file (extended, not written) is rejected
	// quickly as malformed without reading it fully or modifying it. It does
	// NOT prove large *valid* audiobook handling; see research/backend/fixtures.md.
	p := filepath.Join(t.TempDir(), "huge.m4b")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(3 << 30); err != nil {
		f.Close()
		t.Skipf("filesystem cannot extend file: %v", err)
	}
	f.Close()
	start := time.Now()
	_, err = newInspector(t, nil).Inspect(context.Background(), p)
	if err == nil {
		t.Fatal("expected failure for zero-filled file")
	}
	if time.Since(start) > 25*time.Second {
		t.Fatalf("took too long: %s", time.Since(start))
	}
	if fi, _ := os.Stat(p); fi.Size() != 3<<30 {
		t.Fatal("file size changed")
	}
}

func TestNormalizeMissingTimingIsUnknownNotZero(t *testing.T) {
	res, err := inspect.Normalize([]byte(`{"format":{"format_name":"aac","duration":"N/A","probe_score":51},
		"streams":[{"index":0,"codec_type":"audio","codec_name":"aac","sample_rate":"44100","channels":1}],
		"chapters":[{"id":1,"time_base":"1/1000","start":0,"start_time":"N/A","end":10,"end_time":"0.010000"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if res.Format.DurationMs != nil {
		t.Fatalf("duration fabricated: %d", *res.Format.DurationMs)
	}
	if res.Completeness != inspect.Incomplete {
		t.Fatalf("completeness %s", res.Completeness)
	}
	if len(res.Chapters) != 0 {
		t.Fatalf("chapter without start time should be skipped: %+v", res.Chapters)
	}
	codes := map[string]bool{}
	for _, i := range res.Issues {
		codes[i.Code] = true
	}
	if !codes["duration_unknown"] || !codes["chapter_timing_unknown"] {
		t.Fatalf("issues: %+v", res.Issues)
	}
}

func TestNormalizeZeroDurationAndStreamFallback(t *testing.T) {
	res, err := inspect.Normalize([]byte(`{"format":{"format_name":"ogg","duration":"0.000000"},
		"streams":[{"index":0,"codec_type":"audio","codec_name":"opus","duration":"12.3456"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if res.Format.DurationMs == nil || *res.Format.DurationMs != 12346 || res.Completeness != inspect.Complete {
		t.Fatalf("%+v", res)
	}
	if _, err := inspect.Normalize([]byte(`{}`)); err == nil {
		t.Fatal("empty document must be malformed")
	}
}
