// Package catalog builds the self-contained recording snapshot, lists and
// searches permitted recordings, and resolves media/artwork targets.
package catalog

import (
	"fmt"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// chapterNamespace makes derived chapter IDs stable per anchor.
var chapterNamespace = uuid.MustParse("6f1a8e0e-0f3c-4d5b-9a55-2f8f4a0c1b77")

// FileInfo is the current member of a recording in order.
type FileInfo struct {
	ID         uuid.UUID
	Version    uuid.UUID
	Sequence   int
	Filename   string
	DurationMs *int64
}

// Start is one normalized chapter start (file/version-relative).
type Start struct {
	FileID         uuid.UUID `json:"fileId"`
	ContentVersion uuid.UUID `json:"contentVersion"`
	OffsetMs       int64     `json:"offsetMs"`
	Label          string    `json:"label"`
}

// Candidate is a normalized chapter source offered for selection.
type Candidate struct {
	Source string // user | cue | embedded
	Starts []Start
}

// Selection is the effective chapters plus any issues produced while
// rejecting broken sources. Rejected raw sources are never deleted.
type Selection struct {
	Source   string
	Chapters []wire.Chapter
	Issues   []wire.Issue
}

var sourcePriority = map[string]int{"user": 0, "cue": 1, "embedded": 2}

// ValidateSource checks a candidate as a whole in recording order. Any
// negative, duplicate, descending, out-of-file or mismatched start rejects
// the entire source (no salvage, no sorting).
func ValidateSource(files []FileInfo, c Candidate) error {
	if len(c.Starts) == 0 {
		return fmt.Errorf("source has no chapter starts")
	}
	bySeq := map[uuid.UUID]FileInfo{}
	for _, f := range files {
		bySeq[f.ID] = f
	}
	prevSeq, prevOff := -1, int64(-1)
	for i, s := range c.Starts {
		f, ok := bySeq[s.FileID]
		if !ok {
			return fmt.Errorf("start %d references a file outside the recording", i)
		}
		if f.Version != s.ContentVersion {
			return fmt.Errorf("start %d references a different content version", i)
		}
		if s.OffsetMs < 0 {
			return fmt.Errorf("start %d has a negative offset", i)
		}
		if f.DurationMs != nil && s.OffsetMs >= *f.DurationMs {
			return fmt.Errorf("start %d is not inside its file", i)
		}
		if f.Sequence < prevSeq || (f.Sequence == prevSeq && s.OffsetMs <= prevOff) {
			return fmt.Errorf("start %d is duplicate or descending", i)
		}
		prevSeq, prevOff = f.Sequence, s.OffsetMs
	}
	return nil
}

// recordingStarts returns the whole-recording start of each file, nil when
// any preceding duration is unknown.
func recordingStarts(files []FileInfo) map[uuid.UUID]*int64 {
	out := map[uuid.UUID]*int64{}
	var cursor *int64 = new(int64)
	for _, f := range files {
		if cursor == nil {
			out[f.ID] = nil
		} else {
			v := *cursor
			out[f.ID] = &v
		}
		if cursor != nil && f.DurationMs != nil {
			n := *cursor + *f.DurationMs
			cursor = &n
		} else {
			cursor = nil
		}
	}
	return out
}

func chapterID(recording uuid.UUID, source string, s Start) string {
	return uuid.NewSHA1(chapterNamespace, []byte(fmt.Sprintf("%s|%s|%s|%s|%d", recording, source, s.FileID, s.ContentVersion, s.OffsetMs))).String()
}

func buildChapters(recording uuid.UUID, files []FileInfo, source string, starts []Start, generated bool) []wire.Chapter {
	rs := recordingStarts(files)
	out := make([]wire.Chapter, 0, len(starts))
	for i, s := range starts {
		label := s.Label
		if label == "" {
			label = fmt.Sprintf("Chapter %d", i+1)
		}
		var rec *int64
		if base := rs[s.FileID]; base != nil {
			v := *base + s.OffsetMs
			rec = &v
		}
		out = append(out, wire.Chapter{ID: chapterID(recording, source, s), Label: label,
			Start:            wire.Anchor{FileID: s.FileID.String(), ContentVersion: s.ContentVersion.String(), OffsetMs: s.OffsetMs},
			RecordingStartMs: rec, Source: source, Generated: generated})
	}
	return out
}

// SelectChapters implements the ADR-0029 selection: protected user edits,
// valid associated CUE, embedded, then generated file-boundary markers.
// It never merges sources or repairs a broken one.
func SelectChapters(recording uuid.UUID, files []FileInfo, cands []Candidate) Selection {
	ordered := make([]Candidate, 0, len(cands))
	for p := 0; p <= 2; p++ {
		for _, c := range cands {
			if sourcePriority[c.Source] == p {
				ordered = append(ordered, c)
			}
		}
	}
	var sel Selection
	for _, c := range ordered {
		if err := ValidateSource(files, c); err != nil {
			src := c.Source
			sel.Issues = append(sel.Issues, wire.Issue{Code: "chapter_source_rejected", Message: c.Source + " chapter source rejected: " + err.Error(), Source: &src})
			continue
		}
		sel.Source = c.Source
		sel.Chapters = buildChapters(recording, files, c.Source, c.Starts, false)
		return sel
	}
	gen := make([]Start, 0, len(files))
	for _, f := range files {
		label := f.Filename
		if label == "" {
			label = fmt.Sprintf("File %d", f.Sequence+1)
		}
		gen = append(gen, Start{FileID: f.ID, ContentVersion: f.Version, OffsetMs: 0, Label: label})
	}
	sel.Source = "generated"
	sel.Chapters = buildChapters(recording, files, "generated", gen, true)
	return sel
}
