package catalog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

// Runs contracts/t003/fixtures/chapter-sources.json: protected-source priority,
// whole-source rejection and generated file-boundary fallback.
func TestChapterSourceFixtures(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "t003", "fixtures", "chapter-sources.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Recording string `json:"recording"`
		Cases     []struct {
			Name    string `json:"name"`
			Sources []struct {
				Source string `json:"source"`
				Starts []struct {
					FileID         uuid.UUID `json:"fileId"`
					ContentVersion uuid.UUID `json:"contentVersion"`
					OffsetMs       int64     `json:"offsetMs"`
				} `json:"starts"`
			} `json:"sources"`
			Expected               string  `json:"expected"`
			ExpectedRecordingStart []int64 `json:"expectedRecordingStarts"`
			PreserveRejected       bool    `json:"preserveRejected"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	// The 60/90/30 second layout the fixture's ids describe.
	d := func(v int64) *int64 { return &v }
	id := func(s string) uuid.UUID { return uuid.MustParse("00000000-0000-4000-8000-" + s) }
	files := []FileInfo{
		{ID: id("000000000300"), Version: id("000000000400"), Sequence: 0, Filename: "track 1.mp3", DurationMs: d(60000)},
		{ID: id("000000000301"), Version: id("000000000401"), Sequence: 1, Filename: "track 2.mp3", DurationMs: d(90000)},
		{ID: id("000000000302"), Version: id("000000000402"), Sequence: 2, Filename: "track 3.mp3", DurationMs: d(30000)},
	}
	rec := uuid.MustParse(fx.Recording)
	for _, c := range fx.Cases {
		var cands []Candidate
		for _, s := range c.Sources {
			cand := Candidate{Source: s.Source}
			for _, st := range s.Starts {
				cand.Starts = append(cand.Starts, Start{FileID: st.FileID, ContentVersion: st.ContentVersion, OffsetMs: st.OffsetMs})
			}
			cands = append(cands, cand)
		}
		sel := SelectChapters(rec, files, cands)
		if sel.Source != c.Expected {
			t.Errorf("%s: selected %q, want %q (issues %+v)", c.Name, sel.Source, c.Expected, sel.Issues)
			continue
		}
		if c.PreserveRejected && len(sel.Issues) == 0 {
			t.Errorf("%s: a rejected protected source must emit an issue", c.Name)
		}
		if sel.Source == "generated" {
			for _, ch := range sel.Chapters {
				if !ch.Generated || ch.Source != "generated" {
					t.Errorf("%s: generated chapters must be identified: %+v", c.Name, ch)
				}
			}
		}
		if c.ExpectedRecordingStart != nil {
			if len(sel.Chapters) != len(c.ExpectedRecordingStart) {
				t.Errorf("%s: %d chapters, want %d", c.Name, len(sel.Chapters), len(c.ExpectedRecordingStart))
				continue
			}
			for i, ch := range sel.Chapters {
				if ch.RecordingStartMs == nil || *ch.RecordingStartMs != c.ExpectedRecordingStart[i] {
					t.Errorf("%s: chapter %d recording start %v, want %d", c.Name, i, ch.RecordingStartMs, c.ExpectedRecordingStart[i])
				}
			}
		}
	}
}

func TestUnknownDurationLeavesRecordingStartsNull(t *testing.T) {
	d := func(v int64) *int64 { return &v }
	a, b := uuid.New(), uuid.New()
	files := []FileInfo{{ID: a, Version: uuid.New(), Sequence: 0, DurationMs: nil}, {ID: b, Version: uuid.New(), Sequence: 1, DurationMs: d(1000)}}
	sel := SelectChapters(uuid.New(), files, nil)
	if sel.Chapters[0].RecordingStartMs == nil || *sel.Chapters[0].RecordingStartMs != 0 {
		t.Fatal("first marker starts at zero")
	}
	if sel.Chapters[1].RecordingStartMs != nil {
		t.Fatalf("a start after an unknown duration must be null, got %d", *sel.Chapters[1].RecordingStartMs)
	}
}
