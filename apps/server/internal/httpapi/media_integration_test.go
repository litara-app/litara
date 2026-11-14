package httpapi_test

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func contentPath(f wire.File) string { return f.ContentPath[len("/api/v1"):] }

func snapshot(t *testing.T, e *apitest.Env, token string, rec uuid.UUID) wire.Recording {
	t.Helper()
	r := e.Do("GET", "/recordings/"+rec.String(), token, nil)
	status(t, r, 200, "")
	var s wire.Recording
	r.JSON(t, &s)
	return s
}

func TestOriginalBytesAndRangeSemantics(t *testing.T) {
	e := apitest.New(t)
	a := e.Login("fixture-user-a", "Phone A")
	snap := snapshot(t, e, a.AccessToken, e.Fix.ThreeFile)
	f := snap.Files[1]
	disk, err := os.ReadFile(e.Fix.Files["r1-f2"].Path)
	if err != nil {
		t.Fatal(err)
	}
	if int64(len(disk)) != *f.SizeBytes {
		t.Fatalf("snapshot size %d != stat %d", *f.SizeBytes, len(disk))
	}
	path := contentPath(f)

	full := e.Do("GET", path, a.AccessToken, nil)
	status(t, full, 200, "")
	if !bytes.Equal(full.Body, disk) {
		t.Fatal("served bytes differ from the original file")
	}
	h := full.Header
	if h.Get("Content-Type") != "audio/mpeg" || h.Get("Accept-Ranges") != "bytes" || h.Get("Cache-Control") != "private, no-store" ||
		h.Get("Content-Length") != strconv.Itoa(len(disk)) || h.Get("ETag") != fmt.Sprintf("%q", f.ContentVersion) || h.Get("Content-Encoding") != "" {
		t.Fatalf("headers: %v", h)
	}

	size := len(disk)
	cases := []struct {
		rng        string
		status     int
		start, end int
	}{
		{"bytes=0-", 206, 0, size - 1},
		{"bytes=10-19", 206, 10, 19},
		{"bytes=-8", 206, size - 8, size - 1},
		{fmt.Sprintf("bytes=%d-%d", size-10, size+500), 206, size - 10, size - 1},
		{fmt.Sprintf("bytes=-%d", size+1000), 206, 0, size - 1}, // suffix larger than the file: whole representation as 206
		{fmt.Sprintf("bytes=%d-", size), 416, 0, 0},
		{"bytes=-0", 416, 0, 0},
		{"bytes=0-1,4-5", 200, 0, size - 1}, // multiple ranges are ignored as a whole
		{"garbage", 400, 0, 0},
	}
	for _, c := range cases {
		r := e.Do("GET", path, a.AccessToken, nil, "Range", c.rng)
		if r.StatusCode != c.status {
			t.Errorf("%s: status %d want %d (%s)", c.rng, r.StatusCode, c.status, r.Body)
			continue
		}
		switch c.status {
		case 206:
			want := fmt.Sprintf("bytes %d-%d/%d", c.start, c.end, size)
			if r.Header.Get("Content-Range") != want || !bytes.Equal(r.Body, disk[c.start:c.end+1]) ||
				r.Header.Get("Content-Length") != strconv.Itoa(c.end-c.start+1) {
				t.Errorf("%s: content-range %q (want %q), %d bytes", c.rng, r.Header.Get("Content-Range"), want, len(r.Body))
			}
		case 416:
			if r.Header.Get("Content-Range") != fmt.Sprintf("bytes */%d", size) || r.Code() != "range_not_satisfiable" {
				t.Errorf("%s: 416 headers %v code %q", c.rng, r.Header, r.Code())
			}
		case 200:
			if !bytes.Equal(r.Body, disk) {
				t.Errorf("%s: ignored range must return the full file", c.rng)
			}
		}
	}

	// HEAD mirrors GET headers and status with no body.
	hd := e.Do("HEAD", path, a.AccessToken, nil, "Range", "bytes=10-19")
	if hd.StatusCode != 206 || len(hd.Body) != 0 || hd.Header.Get("Content-Range") != fmt.Sprintf("bytes 10-19/%d", size) || hd.Header.Get("Content-Length") != "10" {
		t.Fatalf("HEAD: %d %v body=%d", hd.StatusCode, hd.Header, len(hd.Body))
	}
	if hh := e.Do("HEAD", path, a.AccessToken, nil); hh.StatusCode != 200 || hh.Header.Get("Content-Length") != strconv.Itoa(size) || len(hh.Body) != 0 {
		t.Fatalf("HEAD full: %d %v", hh.StatusCode, hh.Header)
	}

	// Validators.
	etag := h.Get("ETag")
	status(t, e.Do("GET", path, a.AccessToken, nil, "If-None-Match", etag), 304, "")
	status(t, e.Do("GET", path, a.AccessToken, nil, "If-Match", `"nope"`), 412, "precondition_failed")
	if r := e.Do("GET", path, a.AccessToken, nil, "If-Match", etag, "Range", "bytes=0-3"); r.StatusCode != 206 {
		t.Fatalf("If-Match match: %d", r.StatusCode)
	}
	if r := e.Do("GET", path, a.AccessToken, nil, "Range", "bytes=0-3", "If-Range", etag); r.StatusCode != 206 || len(r.Body) != 4 {
		t.Fatalf("If-Range match: %d", r.StatusCode)
	}
	if r := e.Do("GET", path, a.AccessToken, nil, "Range", "bytes=0-3", "If-Range", `"stale"`); r.StatusCode != 200 || !bytes.Equal(r.Body, disk) {
		t.Fatalf("If-Range mismatch must return the full 200: %d", r.StatusCode)
	}

	// M4B/M4A media serve with the fixed MIME and exact bytes too.
	alt := snapshot(t, e, a.AccessToken, e.Fix.Alternate)
	m4b := e.Do("GET", contentPath(alt.Files[0]), a.AccessToken, nil)
	want, _ := os.ReadFile(e.Fix.Files["r2-f1"].Path)
	if m4b.StatusCode != 200 || !bytes.Equal(m4b.Body, want) || m4b.Header.Get("Content-Type") != "audio/mp4" {
		t.Fatalf("m4b: %d %s", m4b.StatusCode, m4b.Header.Get("Content-Type"))
	}
}

func TestMediaAuthorizationAndTokenExpiryRetry(t *testing.T) {
	e := apitest.New(t)
	a := e.Login("fixture-user-a", "Phone A")
	b := e.Login("fixture-user-b", "Phone B")
	admin := e.Login("fixture-admin", "admin")
	snap := snapshot(t, e, a.AccessToken, e.Fix.ThreeFile)
	path := contentPath(snap.Files[0])

	status(t, e.Do("GET", path, "", nil), 401, "")
	status(t, e.Do("GET", path, b.AccessToken, nil), 403, "library_access_denied")
	status(t, e.Do("HEAD", path, b.AccessToken, nil), 403, "")
	status(t, e.Do("GET", path, admin.AccessToken, nil), 403, "library_access_denied") // administrators have no read bypass
	status(t, e.Do("GET", "/files/"+uuid.NewString()+"/versions/"+uuid.NewString()+"/content", a.AccessToken, nil), 404, "not_found")
	status(t, e.Do("GET", "/files/"+snap.Files[0].ID+"/versions/"+uuid.NewString()+"/content", a.AccessToken, nil), 404, "not_found")
	// Authorization precedes validators: an unauthorized caller learns nothing from conditional headers.
	status(t, e.Do("GET", path, b.AccessToken, nil, "If-None-Match", fmt.Sprintf("%q", snap.Files[0].ContentVersion)), 403, "")

	// Token expiry mid-download: a new range request is refused, refresh, then continue; never append a 200 full body.
	first := e.Do("GET", path, a.AccessToken, nil, "Range", "bytes=0-99")
	status(t, first, 206, "")
	e.Clock.Advance(16 * 60 * 1e9)
	status(t, e.Do("GET", path, a.AccessToken, nil, "Range", "bytes=100-199"), 401, "token_expired")
	rr := refresh(e, a.RefreshToken, uuid.NewString())
	status(t, rr, 200, "")
	var tp wire.TokenPair
	rr.JSON(t, &tp)
	rest := e.Do("GET", path, tp.AccessToken, nil, "Range", "bytes=100-199")
	status(t, rest, 206, "")
	disk, _ := os.ReadFile(e.Fix.Files["r1-f1"].Path)
	if !bytes.Equal(append(first.Body, rest.Body...), disk[:200]) {
		t.Fatal("resumed bytes differ")
	}

	// Revoking the grant applies to the next delivery request of every kind.
	admin = e.Login("fixture-admin", "admin again")
	status(t, e.Do("DELETE", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+e.Fix.Lib1.String(), admin.AccessToken, nil), 204, "")
	status(t, e.Do("GET", path, tp.AccessToken, nil, "Range", "bytes=0-9"), 403, "library_access_denied")
	status(t, e.Do("GET", "/recordings/"+e.Fix.ThreeFile.String(), tp.AccessToken, nil), 403, "")
	status(t, e.Do("GET", (*snap.Artwork.ThumbnailPath)[len("/api/v1"):], tp.AccessToken, nil), 403, "")
}

func TestIncompleteAndMissingMedia(t *testing.T) {
	e := apitest.New(t)
	a := e.Login("fixture-user-a", "Phone A")
	snap := snapshot(t, e, a.AccessToken, e.Fix.Incomplete)
	if snap.Readiness != "incomplete" || snap.Capabilities.Play || snap.Capabilities.Download || snap.Capabilities.WholeRecordingSeek || snap.DurationMs != nil {
		t.Fatalf("incomplete snapshot: %+v", snap)
	}
	codes := map[string]bool{}
	for _, i := range snap.Issues {
		codes[i.Code] = true
	}
	if !codes["file_unavailable"] || !codes["file_timing_unknown"] || !codes["file_size_unknown"] {
		t.Fatalf("issues: %+v", snap.Issues)
	}
	if snap.Files[1].DurationMs != nil || snap.Files[1].SizeBytes != nil || snap.Files[1].Available {
		t.Fatalf("unknown values must be null, not zero: %+v", snap.Files[1])
	}
	// Even the readable file of an incomplete recording is not deliverable as a whole recording.
	status(t, e.Do("GET", contentPath(snap.Files[0]), a.AccessToken, nil), 409, "recording_incomplete")
	status(t, e.Do("GET", contentPath(snap.Files[1]), a.AccessToken, nil), 409, "recording_incomplete")

	// A transient storage failure on a ready file is 503 (never a deletion); recovery needs no reset.
	ready := snapshot(t, e, a.AccessToken, e.Fix.Alternate)
	p := e.Fix.Files["r2-f1"].Path
	if err := os.Rename(p, p+".away"); err != nil {
		t.Fatal(err)
	}
	r := e.Do("GET", contentPath(ready.Files[0]), a.AccessToken, nil)
	status(t, r, 503, "temporarily_unavailable")
	if r.Header.Get("Retry-After") == "" {
		t.Fatal("missing Retry-After")
	}
	if again := snapshot(t, e, a.AccessToken, e.Fix.Alternate); again.Readiness != "ready" {
		t.Fatal("transient storage loss must not change catalog state")
	}
	if err := os.Rename(p+".away", p); err != nil {
		t.Fatal(err)
	}
	status(t, e.Do("GET", contentPath(ready.Files[0]), a.AccessToken, nil), 200, "")
}

func TestContentReplacementAndReorderKeepOldVersionsHonest(t *testing.T) {
	e := apitest.New(t)
	ctx := context.Background()
	a := e.Login("fixture-user-a", "Phone A")
	before := snapshot(t, e, a.AccessToken, e.Fix.ThreeFile)
	old := before.Files[0]

	// Replace the bytes of file 0: same file ID, new content version, new layout revision.
	newPath := filepath.Join(e.Cfg.MediaRoot, "r1-part1-v2.mp3")
	src, _ := os.ReadFile(e.Fix.Files["r1-f1"].Path)
	if err := os.WriteFile(newPath, append(append([]byte{}, src...), 0), 0o600); err != nil { // one extra byte: different content
		t.Fatal(err)
	}
	newVer, err := seed.ReplaceContent(ctx, e.Pool, e.Fix.Files["r1-f1"], newPath, int64(len(src)+1), *old.DurationMs)
	if err != nil {
		t.Fatal(err)
	}
	after := snapshot(t, e, a.AccessToken, e.Fix.ThreeFile)
	if after.LayoutRevision == before.LayoutRevision || after.Files[0].ContentVersion != newVer.String() || after.Files[0].ID != old.ID {
		t.Fatalf("replacement did not change layout/version while keeping the file ID")
	}
	// The formerly known version is not promised: 412 content_changed; a never-known version is 404.
	status(t, e.Do("GET", contentPath(old), a.AccessToken, nil), 412, "content_changed")
	status(t, e.Do("GET", contentPath(after.Files[0]), a.AccessToken, nil), 200, "")

	// Reordering keeps IDs/versions but changes the layout revision.
	if err := seed.Reorder(ctx, e.Pool, e.Fix.ThreeFile, []uuid.UUID{e.Fix.Files["r1-f3"].ID, e.Fix.Files["r1-f1"].ID, e.Fix.Files["r1-f2"].ID}); err != nil {
		t.Fatal(err)
	}
	re := snapshot(t, e, a.AccessToken, e.Fix.ThreeFile)
	if re.LayoutRevision == after.LayoutRevision || re.Files[0].ID != e.Fix.Files["r1-f3"].ID.String() || re.Files[0].Sequence != 0 {
		t.Fatalf("reorder: %+v", re.Files)
	}
	// Chapters were anchored to the old order: the embedded source is now descending and is rejected as a whole.
	if re.Chapters[0].Source != "generated" || !re.Chapters[0].Generated {
		t.Fatalf("chapters after reorder: %+v", re.Chapters)
	}
	var rejected bool
	for _, i := range re.Issues {
		rejected = rejected || i.Code == "chapter_source_rejected"
	}
	if !rejected {
		t.Fatalf("issues: %+v", re.Issues)
	}
}

func TestSparseOffsetsAboveFourGiB(t *testing.T) {
	e := apitest.New(t)
	ctx := context.Background()
	a := e.Login("fixture-user-a", "Phone A")

	// A sparse file proves offset arithmetic above 4 GiB; it is not a valid audiobook.
	sp := filepath.Join(e.Cfg.MediaRoot, "sparse.mp3")
	f, err := os.Create(sp)
	if err != nil {
		t.Fatal(err)
	}
	size := int64(8)<<30 + 12345
	if err := f.Truncate(size); err != nil {
		t.Skipf("cannot create sparse file: %v", err)
	}
	if _, err := f.WriteAt([]byte("SPARSE-MARK"), 4<<30+77); err != nil {
		t.Skipf("cannot write beyond 4 GiB: %v", err)
	}
	f.Close()
	e.AddSparseRecording(ctx, e.Fix.Lib1, sp, size)
	var list wire.Recordings
	e.Do("GET", "/recordings?q=sparse", a.AccessToken, nil).JSON(t, &list)
	if list.Total != 1 {
		t.Fatalf("sparse recording missing: %+v", list)
	}
	snap := snapshot(t, e, a.AccessToken, uuid.MustParse(list.Items[0].ID))
	start := int64(4)<<30 + 77
	r := e.Do("GET", contentPath(snap.Files[0]), a.AccessToken, nil, "Range", fmt.Sprintf("bytes=%d-%d", start, start+10))
	status(t, r, 206, "")
	if string(r.Body) != "SPARSE-MARK" || r.Header.Get("Content-Range") != fmt.Sprintf("bytes %d-%d/%d", start, start+10, size) {
		t.Fatalf("large offset: %q %s", r.Body, r.Header.Get("Content-Range"))
	}
	if *snap.Files[0].SizeBytes != size {
		t.Fatalf("size %d", *snap.Files[0].SizeBytes)
	}
	status(t, e.Do("GET", contentPath(snap.Files[0]), a.AccessToken, nil, "Range", fmt.Sprintf("bytes=%d-", size)), 416, "range_not_satisfiable")
}

func TestArtworkRoutes(t *testing.T) {
	e := apitest.New(t)
	a := e.Login("fixture-user-a", "A")
	b := e.Login("fixture-user-b", "B")
	snap := snapshot(t, e, a.AccessToken, e.Fix.ThreeFile)
	thumb := (*snap.Artwork.ThumbnailPath)[len("/api/v1"):]
	r := e.Do("GET", thumb, a.AccessToken, nil)
	disk, _ := os.ReadFile(filepath.Join(e.Cfg.MediaRoot, "thumb.png"))
	if r.StatusCode != 200 || !bytes.Equal(r.Body, disk) || r.Header.Get("Content-Type") != "image/png" ||
		r.Header.Get("Cache-Control") != "private, no-store" || r.Header.Get("Content-Length") != strconv.Itoa(len(disk)) || len(disk) > 5<<20 {
		t.Fatalf("thumbnail: %d %v", r.StatusCode, r.Header)
	}
	hd := e.Do("HEAD", thumb, a.AccessToken, nil)
	if hd.StatusCode != 200 || len(hd.Body) != 0 || hd.Header.Get("Content-Length") != r.Header.Get("Content-Length") {
		t.Fatalf("HEAD thumbnail: %d", hd.StatusCode)
	}
	status(t, e.Do("GET", thumb, b.AccessToken, nil), 403, "library_access_denied")
	status(t, e.Do("GET", thumb, "", nil), 401, "")
	// A recording without artwork returns typed absence, not an error page.
	status(t, e.Do("GET", "/recordings/"+e.Fix.Alternate.String()+"/artwork/cover", a.AccessToken, nil), 404, "not_found")
	var alt wire.Recording
	e.Do("GET", "/recordings/"+e.Fix.Alternate.String(), a.AccessToken, nil).JSON(t, &alt)
	if alt.Artwork.ThumbnailPath != nil || alt.Artwork.CoverPath != nil {
		t.Fatal("absent artwork must be null")
	}
}

func TestThreeFileChaptersAndAlternateRecording(t *testing.T) {
	e := apitest.New(t)
	a := e.Login("fixture-user-a", "A")
	s := snapshot(t, e, a.AccessToken, e.Fix.ThreeFile)
	if s.Readiness != "ready" || *s.DurationMs != 180000 || len(s.Files) != 3 || !s.Capabilities.Play {
		t.Fatalf("snapshot: %+v", s.RecordingSummary)
	}
	var cum int64
	for i, f := range s.Files {
		if f.Sequence != int64(i) {
			t.Fatal("sequence must be contiguous from zero")
		}
		cum += *f.DurationMs
	}
	if cum != *s.DurationMs {
		t.Fatal("total must be the sum of known file durations")
	}
	wantStarts := []int64{0, 45000, 90000, 160000}
	if len(s.Chapters) != 4 {
		t.Fatalf("chapters %+v", s.Chapters)
	}
	for i, c := range s.Chapters {
		if c.Source != "embedded" || c.Generated || *c.RecordingStartMs != wantStarts[i] {
			t.Fatalf("chapter %d: %+v", i, c)
		}
	}
	// Chapter ends are not published; a chapter may span files up to the next start.
	// The alternate recording shares the title but is its own recording, with generated markers.
	alt := snapshot(t, e, a.AccessToken, e.Fix.Alternate)
	if alt.TitleID != s.TitleID || alt.ID == s.ID || len(alt.Chapters) != 1 || alt.Chapters[0].Source != "generated" || !alt.Chapters[0].Generated {
		t.Fatalf("alternate: %+v", alt)
	}
	if alt.Files[0].ID == s.Files[0].ID {
		t.Fatal("alternate recording must have distinct files")
	}
}
