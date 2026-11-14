package ingest_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/ingest"
)

func (e *env) recordings() []struct {
	ID    uuid.UUID
	Key   string
	Title string
	Link  string
	Files []string
} {
	e.t.Helper()
	rows, err := e.pool.Query(context.Background(), `SELECT r.id, r.group_key, t.title, r.link_state FROM recordings r JOIN titles t ON t.id=r.title_id WHERE r.library_id=$1 ORDER BY r.group_key`, e.lib)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	var out []struct {
		ID    uuid.UUID
		Key   string
		Title string
		Link  string
		Files []string
	}
	for rows.Next() {
		var r struct {
			ID    uuid.UUID
			Key   string
			Title string
			Link  string
			Files []string
		}
		if err := rows.Scan(&r.ID, &r.Key, &r.Title, &r.Link); err != nil {
			e.t.Fatal(err)
		}
		out = append(out, r)
	}
	rows.Close()
	for i := range out {
		frows, err := e.pool.Query(context.Background(), `SELECT o.rel_path FROM recording_files rf JOIN file_observations o ON o.file_id=rf.file_id WHERE rf.recording_id=$1 ORDER BY rf.sequence`, out[i].ID)
		if err != nil {
			e.t.Fatal(err)
		}
		for frows.Next() {
			var p string
			_ = frows.Scan(&p)
			out[i].Files = append(out[i].Files, p)
		}
		frows.Close()
	}
	return out
}

func (e *env) openReviews(kind string) int {
	rs, _ := e.q.ListOpenReviews(context.Background(), e.lib)
	n := 0
	for _, r := range rs {
		if r.Kind == kind {
			n++
		}
	}
	return n
}

func TestFolderBecomesOneRecordingOrderedByTags(t *testing.T) {
	e := newEnv(t)
	// Names deliberately disagree with nothing: tag order and filename order match.
	e.audio("Author - Book/part-2.mp3", 523, "album", "The Book", "artist", "An Author", "track", "2/3")
	e.audio("Author - Book/part-1.mp3", 440, "album", "The Book", "artist", "An Author", "track", "1/3")
	e.audio("Author - Book/part-10.mp3", 659, "album", "The Book", "artist", "An Author", "track", "3/3")
	e.settle()
	recs := e.recordings()
	if len(recs) != 1 || recs[0].Title != "The Book" || recs[0].Link != "confirmed" {
		t.Fatalf("recordings: %+v", recs)
	}
	want := []string{"Author - Book/part-1.mp3", "Author - Book/part-2.mp3", "Author - Book/part-10.mp3"}
	for i, f := range want {
		if recs[0].Files[i] != f {
			t.Fatalf("order %v want %v (natural, not lexical, and tag-consistent)", recs[0].Files, want)
		}
	}
}

func TestDiscFoldersJoinOneRecording(t *testing.T) {
	e := newEnv(t)
	e.audio("Big Book/CD1/01.mp3", 440, "album", "Big Book")
	e.audio("Big Book/CD1/02.mp3", 523, "album", "Big Book")
	e.audio("Big Book/CD2/01.mp3", 659, "album", "Big Book")
	e.settle()
	recs := e.recordings()
	if len(recs) != 1 || len(recs[0].Files) != 3 {
		t.Fatalf("disc folders must merge: %+v", recs)
	}
	if recs[0].Files[2] != "Big Book/CD2/01.mp3" {
		t.Fatalf("disc order: %v", recs[0].Files)
	}
}

func TestConflictingOrderNeedsReviewAndCreatesNoRecording(t *testing.T) {
	e := newEnv(t)
	// Tags say a-second is first; names say the opposite.
	e.audio("Odd/01-first.mp3", 440, "album", "Odd", "track", "2")
	e.audio("Odd/02-second.mp3", 523, "album", "Odd", "track", "1")
	e.settle()
	if recs := e.recordings(); len(recs) != 0 {
		t.Fatalf("a conflicting order must not publish a recording: %+v", recs)
	}
	if e.openReviews("ordering") != 1 {
		t.Fatal("expected one ordering review")
	}
}

func TestAmbiguousNumberingNeedsReview(t *testing.T) {
	e := newEnv(t)
	e.audio("Loose/intro.mp3", 440, "album", "Loose")
	e.audio("Loose/outro.mp3", 523, "album", "Loose")
	e.settle()
	if len(e.recordings()) != 0 || e.openReviews("ordering") != 1 {
		t.Fatalf("no tags and no numbering is ambiguous: %+v", e.recordings())
	}
}

func TestMixedAlbumsInOneFolderAreNotGrouped(t *testing.T) {
	e := newEnv(t)
	e.audio("Dump/1.mp3", 440, "album", "Book One")
	e.audio("Dump/2.mp3", 523, "album", "Book Two")
	e.settle()
	if len(e.recordings()) != 0 || e.openReviews("grouping") != 1 {
		t.Fatalf("unrelated albums must stay ungrouped: %+v", e.recordings())
	}
}

func TestRegroupingNeverMovesAssignedFilesAndNewFileBumpsLayout(t *testing.T) {
	e := newEnv(t)
	e.audio("B/1.mp3", 440, "album", "B")
	e.audio("B/2.mp3", 523, "album", "B")
	e.settle()
	recs := e.recordings()
	if len(recs) != 1 {
		t.Fatalf("setup: %+v", recs)
	}
	var layout1 uuid.UUID
	_ = e.pool.QueryRow(context.Background(), `SELECT layout_revision FROM recordings WHERE id=$1`, recs[0].ID).Scan(&layout1)

	e.audio("B/3.mp3", 659, "album", "B")
	e.settle()
	recs = e.recordings()
	if len(recs) != 1 || len(recs[0].Files) != 3 || recs[0].ID != e.recordings()[0].ID {
		t.Fatalf("the same recording is extended: %+v", recs)
	}
	var layout2 uuid.UUID
	_ = e.pool.QueryRow(context.Background(), `SELECT layout_revision FROM recordings WHERE id=$1`, recs[0].ID).Scan(&layout2)
	if layout1 == layout2 {
		t.Fatal("membership change must bump the layout revision")
	}
}

func TestSameTitleWithoutIdentifierIsProvisional(t *testing.T) {
	e := newEnv(t)
	e.audio("One/1.mp3", 440, "album", "Same Name", "artist", "Same Author")
	e.audio("Two/1.mp3", 523, "album", "Same Name", "artist", "Same Author")
	e.settle()
	recs := e.recordings()
	if len(recs) != 2 {
		t.Fatalf("both recordings exist: %+v", recs)
	}
	prov := 0
	for _, r := range recs {
		if r.Link == "provisional" {
			prov++
		}
	}
	if prov != 1 || e.openReviews("grouping") != 1 {
		t.Fatalf("exactly the later recording is provisional with one review: prov=%d reviews=%d", prov, e.openReviews("grouping"))
	}
}

func TestSharedIdentifierLinksSecondRecordingToSameTitle(t *testing.T) {
	e := newEnv(t)
	e.audio("One/1.mp3", 440, "album", "Same Name", "artist", "Same Author", "asin", "B000TEST01")
	e.audio("Two/1.mp3", 523, "album", "Same Name", "artist", "Same Author", "asin", "B000TEST01")
	e.settle()
	var titles int
	_ = e.pool.QueryRow(context.Background(), `SELECT count(DISTINCT title_id) FROM recordings WHERE library_id=$1`, e.lib).Scan(&titles)
	if len(e.recordings()) != 2 || titles != 1 || e.openReviews("grouping") != 0 {
		t.Fatalf("strong identifier plus metadata agreement links: titles=%d", titles)
	}
}

func cue(files ...string) string {
	s := ""
	for i := 0; i+1 < len(files); i += 2 {
		s += "FILE \"" + files[i] + "\" MP3\n  TRACK 01 AUDIO\n    TITLE \"Chapter " + files[i+1] + "\"\n    INDEX 01 00:00:00\n"
		s += "  TRACK 02 AUDIO\n    TITLE \"Later\"\n    INDEX 01 00:30:00\n"
	}
	return s
}

func (e *env) write(rel, content string) {
	p := filepath.Join(e.root, filepath.FromSlash(rel))
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) assoc(rel string) (state string, rec *uuid.UUID) {
	rows, _ := e.q.ListAssociations(context.Background(), e.lib)
	for _, a := range rows {
		if a.RelPath == rel {
			if a.RecordingID.Valid {
				id := a.RecordingID.UUID
				return a.State, &id
			}
			return a.State, nil
		}
	}
	return "absent", nil
}

func TestSingleCueIsAssociatedAndWritesChapterSource(t *testing.T) {
	e := newEnv(t)
	e.audio("Book/1.mp3", 440, "album", "Book")
	e.audio("Book/2.mp3", 523, "album", "Book")
	e.write("Book/book.cue", cue("1.mp3", "A", "2.mp3", "B"))
	e.settle()
	st, rec := e.assoc("Book/book.cue")
	if st != "associated" || rec == nil {
		t.Fatalf("assoc: %s", st)
	}
	var raw []byte
	if err := e.pool.QueryRow(context.Background(), `SELECT starts FROM chapter_sources WHERE recording_id=$1 AND source='cue'`, *rec).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var starts []struct {
		OffsetMs int64
		Label    string
	}
	_ = json.Unmarshal(raw, &starts)
	if len(starts) != 4 || starts[1].OffsetMs != 30000 {
		t.Fatalf("starts: %s", raw)
	}
}

func TestTwoValidCuesAreNotChosen(t *testing.T) {
	e := newEnv(t)
	e.audio("Book/1.mp3", 440, "album", "Book")
	e.audio("Book/2.mp3", 523, "album", "Book")
	e.write("Book/a.cue", cue("1.mp3", "A", "2.mp3", "B"))
	e.write("Book/b.cue", cue("1.mp3", "X", "2.mp3", "Y"))
	e.settle()
	// Each CUE alone matches the recording, so each is its own unambiguous
	// candidate set only if it is the single one; two together must go to review.
	a, _ := e.assoc("Book/a.cue")
	b, _ := e.assoc("Book/b.cue")
	if a == "associated" && b == "associated" {
		t.Fatal("two CUEs for one recording must not both be applied")
	}
}

func TestCueReferencingOutsideFilesIsInvalid(t *testing.T) {
	e := newEnv(t)
	e.audio("Book/1.mp3", 440, "album", "Book")
	e.write("Book/bad.cue", cue("1.mp3", "A", "missing.mp3", "B"))
	e.settle()
	if st, _ := e.assoc("Book/bad.cue"); st != "invalid" {
		t.Fatalf("a CUE naming a file that is not in the recording is rejected whole: %s", st)
	}
	var n int
	_ = e.pool.QueryRow(context.Background(), `SELECT count(*) FROM chapter_sources WHERE source='cue'`).Scan(&n)
	if n != 0 {
		t.Fatal("no chapter source may come from an invalid CUE")
	}
}

func TestParseCueRejectsMalformed(t *testing.T) {
	for name, in := range map[string]string{
		"no tracks":    "FILE \"a.mp3\" MP3\n",
		"bad time":     "FILE \"a.mp3\" MP3\n TRACK 01 AUDIO\n  INDEX 01 00:99:00\n",
		"track first":  "TRACK 01 AUDIO\n INDEX 01 00:00:00\n",
		"unterminated": "FILE \"a.mp3 MP3\n TRACK 01 AUDIO\n  INDEX 01 00:00:00\n",
	} {
		if _, err := ingest.ParseCue([]byte(in)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
	tr, err := ingest.ParseCue([]byte("\ufeffFILE \"a.mp3\" MP3\r\n TRACK 01 AUDIO\r\n  INDEX 01 01:02:37\r\n"))
	if err != nil || len(tr) != 1 || tr[0].OffsetMs != 62000+37*1000/75 {
		t.Fatalf("parse: %+v %v", tr, err)
	}
}

func TestSidecarAssociation(t *testing.T) {
	e := newEnv(t)
	e.audio("Book/1.mp3", 440, "album", "Book")
	e.write("Book/metadata.opf", "<package/>")
	e.write("Book/litara.json", "{}")
	e.write("Elsewhere/metadata.opf", "<package/>") // no recording here
	e.write("package.json", "{}")                   // unrelated JSON is ignored
	e.settle()
	if st, _ := e.assoc("Book/metadata.opf"); st != "associated" {
		t.Fatalf("opf: %s", st)
	}
	if st, _ := e.assoc("Book/litara.json"); st != "associated" {
		t.Fatalf("json: %s", st)
	}
	if st, _ := e.assoc("Elsewhere/metadata.opf"); st != "needs_review" {
		t.Fatalf("orphan sidecar must not attach to a neighbour: %s", st)
	}
	if st, _ := e.assoc("package.json"); st != "absent" {
		t.Fatalf("non-Litara JSON must be ignored: %s", st)
	}
}

func TestReplacedFileBumpsRecordingLayout(t *testing.T) {
	e := newEnv(t)
	e.audio("R/1.mp3", 440, "album", "R")
	e.settle()
	rec := e.recordings()[0].ID
	var before uuid.UUID
	_ = e.pool.QueryRow(context.Background(), `SELECT layout_revision FROM recordings WHERE id=$1`, rec).Scan(&before)
	e.audio("R/1.mp3", 880, "album", "R")
	e.scan("manual", time.Minute)
	e.scan("manual", time.Minute)
	var after uuid.UUID
	_ = e.pool.QueryRow(context.Background(), `SELECT layout_revision FROM recordings WHERE id=$1`, rec).Scan(&after)
	if before == after {
		t.Fatal("a content replacement must invalidate the recording timeline")
	}
}
