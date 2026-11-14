package ingest_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/ingest"
)

func (e *env) firstReview(kind string) (id uuid.UUID, candidates map[string]any) {
	e.t.Helper()
	rs, _ := e.q.ListOpenReviews(context.Background(), e.lib)
	for _, r := range rs {
		if r.Kind == kind {
			m := map[string]any{}
			_ = jsonUnmarshal(r.Candidates, &m)
			return r.ID, m
		}
	}
	e.t.Fatalf("no open %s review", kind)
	return
}

func (e *env) resolve(id uuid.UUID, in ingest.Resolution) error {
	return e.scanner.ResolveReview(context.Background(), e.lib, id, uuid.Nil, in)
}

func errCode(err error) string {
	if ae, ok := apperr.As(err); ok {
		return ae.Code
	}
	return ""
}

func (e *env) ambiguousMove() (idA, idB uuid.UUID) {
	a := e.audio("a.mp3", 440)
	data, _ := os.ReadFile(a)
	_ = os.WriteFile(filepath.Join(e.root, "b.mp3"), data, 0o644)
	e.settle()
	idA, idB = e.obs()["a.mp3"].FileID, e.obs()["b.mp3"].FileID
	_ = os.Rename(a, filepath.Join(e.root, "c.mp3"))
	_ = os.Rename(filepath.Join(e.root, "b.mp3"), filepath.Join(e.root, "d.mp3"))
	e.scan("manual", time.Minute)
	e.scan("manual", time.Minute)
	return
}

func TestReviewerCanApplyAnAmbiguousMove(t *testing.T) {
	e := newEnv(t)
	idA, idB := e.ambiguousMove()
	id, c := e.firstReview("move")
	if c["sha256"] == nil {
		t.Fatalf("candidates: %v", c)
	}
	// A candidate that was not offered is rejected.
	if err := e.resolve(id, ingest.Resolution{Action: "move", Missing: uuid.NewString(), NewPath: "c.mp3"}); errCode(err) != "validation_failed" {
		t.Fatalf("unoffered candidate: %v", err)
	}
	if err := e.resolve(id, ingest.Resolution{Action: "move", Missing: idA.String(), NewPath: "c.mp3"}); err != nil {
		t.Fatal(err)
	}
	if got := e.obs()["c.mp3"]; got.FileID != idA {
		t.Fatalf("the chosen identity moved: %+v", got)
	}
	if err := e.resolve(id, ingest.Resolution{Action: "move", Missing: idA.String(), NewPath: "c.mp3"}); errCode(err) != "review_closed" {
		t.Fatalf("resolving twice: %v", err)
	}
	// The other pair is still unresolved; the scanner raises its own question again, not the old one.
	e.scan("manual", time.Minute)
	e.scan("manual", time.Minute)
	if got := e.obs()["d.mp3"]; got.FileID == idA {
		t.Fatalf("no identity may be reused: %+v", got)
	}
	_ = idB
}

func TestKeepSeparateAddsNewFilesAndStopsAsking(t *testing.T) {
	e := newEnv(t)
	idA, idB := e.ambiguousMove()
	id, _ := e.firstReview("move")
	if err := e.resolve(id, ingest.Resolution{Action: "keep_separate"}); err != nil {
		t.Fatal(err)
	}
	o := e.scan("manual", time.Minute)
	if o.Added != 2 || o.Review != 0 {
		t.Fatalf("new files, no repeat question: %+v", o)
	}
	got := e.obs()
	if got["c.mp3"].FileID == idA || got["c.mp3"].FileID == idB || got["d.mp3"].FileID == idA || got["d.mp3"].FileID == idB {
		t.Fatal("kept-separate files must get fresh identities")
	}
	if e.openReviews("move") != 0 {
		t.Fatal("the question stays closed")
	}
}

func TestReviewerSetsOrderAndRecordingIsCreated(t *testing.T) {
	e := newEnv(t)
	e.audio("Odd/intro.mp3", 440, "album", "Odd")
	e.audio("Odd/outro.mp3", 523, "album", "Odd")
	e.settle()
	id, _ := e.firstReview("ordering")
	if err := e.resolve(id, ingest.Resolution{Action: "order", Files: []string{"Odd/outro.mp3"}}); errCode(err) != "validation_failed" {
		t.Fatalf("must list every file: %v", err)
	}
	if err := e.resolve(id, ingest.Resolution{Action: "order", Files: []string{"Odd/outro.mp3", "Odd/intro.mp3"}}); err != nil {
		t.Fatal(err)
	}
	recs := e.recordings()
	if len(recs) != 1 || recs[0].Files[0] != "Odd/outro.mp3" || recs[0].Files[1] != "Odd/intro.mp3" {
		t.Fatalf("recording in the reviewer's order: %+v", recs)
	}
	e.scan("manual", time.Minute)
	if len(e.recordings()) != 1 || e.openReviews("ordering") != 0 {
		t.Fatal("a rescan must keep the decision")
	}
}

func TestProvisionalTitleCanBeLinkedOrKeptSeparate(t *testing.T) {
	e := newEnv(t)
	e.audio("One/1.mp3", 440, "album", "Same Name", "artist", "Same Author")
	e.audio("Two/1.mp3", 523, "album", "Same Name", "artist", "Same Author")
	e.settle()
	id, c := e.firstReview("grouping")
	existing := c["existingTitles"].([]any)[0].(string)
	if err := e.resolve(id, ingest.Resolution{Action: "link", TitleID: uuid.NewString()}); errCode(err) != "validation_failed" {
		t.Fatalf("only offered titles can be linked: %v", err)
	}
	if err := e.resolve(id, ingest.Resolution{Action: "link", TitleID: existing}); err != nil {
		t.Fatal(err)
	}
	var titles, prov int
	_ = e.pool.QueryRow(context.Background(), `SELECT count(DISTINCT title_id), count(*) FILTER (WHERE link_state='provisional') FROM recordings WHERE library_id=$1`, e.lib).Scan(&titles, &prov)
	if titles != 1 || prov != 0 {
		t.Fatalf("linked: titles=%d provisional=%d", titles, prov)
	}
	var orphan int
	_ = e.pool.QueryRow(context.Background(), `SELECT count(*) FROM titles t WHERE NOT EXISTS (SELECT 1 FROM recordings r WHERE r.title_id=t.id)`).Scan(&orphan)
	if orphan != 0 {
		t.Fatal("the unused provisional title should not linger")
	}
}

func TestChoosingACueSurvivesRescans(t *testing.T) {
	e := newEnv(t)
	e.audio("Book/1.mp3", 440, "album", "Book")
	e.write("Book/a.cue", cue("1.mp3", "A"))
	e.write("Book/b.cue", cue("1.mp3", "B"))
	e.settle()
	id, _ := e.firstReview("association")
	if err := e.resolve(id, ingest.Resolution{Action: "choose", Path: "Book/other.cue"}); errCode(err) != "validation_failed" {
		t.Fatalf("must choose an offered CUE: %v", err)
	}
	if err := e.resolve(id, ingest.Resolution{Action: "choose", Path: "Book/b.cue"}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		e.scan("manual", time.Minute)
	}
	if st, rec := e.assoc("Book/b.cue"); st != "associated" || rec == nil {
		t.Fatalf("chosen: %s", st)
	}
	if st, _ := e.assoc("Book/a.cue"); st != "invalid" {
		t.Fatalf("the other is set aside: %s", st)
	}
	if e.openReviews("association") != 0 {
		t.Fatal("the question stays closed after rescans")
	}
	var label string
	_ = e.pool.QueryRow(context.Background(), `SELECT starts->0->>'label' FROM chapter_sources WHERE source='cue'`).Scan(&label)
	if label != "Chapter B" {
		t.Fatalf("chapters come from the chosen CUE: %q", label)
	}
}

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }
