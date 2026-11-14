package ingest

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
)

// CueTrack is one INDEX 01 position inside a referenced file.
type CueTrack struct {
	File     string // as written in the CUE FILE directive
	Title    string
	OffsetMs int64
}

// ParseCue extracts FILE/TRACK/INDEX 01 entries. Anything it cannot read as a
// whole is an error: a malformed CUE is rejected, not salvaged (ADR-0042).
func ParseCue(data []byte) ([]CueTrack, error) {
	var tracks []CueTrack
	var file, title string
	inTrack := false
	sc := bufio.NewScanner(strings.NewReader(strings.TrimPrefix(string(data), "\ufeff")))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(strings.ToUpper(line), "REM ") {
			continue
		}
		verb, rest, _ := strings.Cut(line, " ")
		rest = strings.TrimSpace(rest)
		switch strings.ToUpper(verb) {
		case "FILE":
			f, err := quoted(rest)
			if err != nil {
				return nil, fmt.Errorf("FILE: %w", err)
			}
			file, inTrack = f, false
		case "TRACK":
			if file == "" {
				return nil, fmt.Errorf("TRACK before FILE")
			}
			inTrack, title = true, ""
		case "TITLE":
			if inTrack {
				t, err := quoted(rest)
				if err != nil {
					return nil, fmt.Errorf("TITLE: %w", err)
				}
				title = t
			}
		case "INDEX":
			parts := strings.Fields(rest)
			if len(parts) != 2 || !inTrack {
				return nil, fmt.Errorf("INDEX outside a track or malformed")
			}
			if parts[0] != "01" {
				continue
			}
			ms, err := cueTime(parts[1])
			if err != nil {
				return nil, err
			}
			tracks = append(tracks, CueTrack{File: file, Title: title, OffsetMs: ms})
		}
	}
	if len(tracks) == 0 {
		return nil, fmt.Errorf("no tracks with INDEX 01")
	}
	return tracks, nil
}

func quoted(s string) (string, error) {
	if strings.HasPrefix(s, `"`) {
		end := strings.LastIndex(s, `"`)
		if end <= 0 {
			return "", fmt.Errorf("unterminated quote")
		}
		return s[1:end], nil
	}
	f := strings.Fields(s)
	if len(f) == 0 {
		return "", fmt.Errorf("missing value")
	}
	return f[0], nil
}

// cueTime parses mm:ss:ff (75 frames per second) to milliseconds.
func cueTime(s string) (int64, error) {
	p := strings.Split(s, ":")
	if len(p) != 3 {
		return 0, fmt.Errorf("bad time %q", s)
	}
	var v [3]int64
	for i := range p {
		n, err := strconv.ParseInt(p[i], 10, 64)
		if err != nil || n < 0 {
			return 0, fmt.Errorf("bad time %q", s)
		}
		v[i] = n
	}
	if v[1] > 59 || v[2] > 74 {
		return 0, fmt.Errorf("bad time %q", s)
	}
	return (v[0]*60+v[1])*1000 + v[2]*1000/75, nil
}

type recInfo struct {
	ID      uuid.UUID
	Key     string
	Dir     string // recording folder; empty for root-level single files
	Members []member
}

func isLitaraJSON(rel string) bool {
	b := strings.ToLower(path.Base(rel))
	return b == "litara.json" || strings.HasSuffix(b, ".litara.json")
}

// Associate links CUE, Litara JSON and OPF sidecars to recordings only when the
// match is unambiguous (ADR-0055). Anything else is stored as needs_review and
// raised as a review item; nothing is guessed.
func (s *Scanner) Associate(ctx context.Context, lib uuid.UUID, l *Listing) error {
	q := sqlcgen.New(s.Pool)
	recs, err := q.ListLibraryRecordings(ctx, lib)
	if err != nil {
		return err
	}
	var ids []uuid.UUID
	for _, r := range recs {
		ids = append(ids, r.ID)
	}
	members, err := q.ListRecordingMembers(ctx, ids)
	if err != nil {
		return err
	}
	byRec := map[uuid.UUID]*recInfo{}
	for _, r := range recs {
		ri := &recInfo{ID: r.ID}
		if r.GroupKey != nil {
			ri.Key = *r.GroupKey
			ri.Dir = strings.TrimPrefix(*r.GroupKey, "dir:")
			if strings.HasPrefix(*r.GroupKey, "file:") {
				ri.Dir = ""
			}
		}
		byRec[r.ID] = ri
	}
	for _, m := range members {
		byRec[m.RecordingID].Members = append(byRec[m.RecordingID].Members, toMember(m.FileID, m.ContentVersion, m.RelPath, m.DurationMs, m.Result))
	}
	sort.Slice(l.Sidecar, func(i, j int) bool { return l.Sidecar[i].Rel < l.Sidecar[j].Rel })

	var cues []Entry
	for _, sc := range l.Sidecar {
		switch sc.Side {
		case "cue":
			cues = append(cues, sc)
		case "opf":
			err = s.associateMetadata(ctx, q, lib, sc, byRec)
		case "json":
			if isLitaraJSON(sc.Rel) {
				err = s.associateMetadata(ctx, q, lib, sc, byRec)
			}
		}
		if err != nil {
			return err
		}
	}
	return s.associateCues(ctx, q, lib, cues, byRec)
}

func (s *Scanner) setAssoc(ctx context.Context, q *sqlcgen.Queries, lib uuid.UUID, kind, rel string, rec *uuid.UUID, state, detail string) error {
	var d *string
	if detail != "" {
		d = &detail
	}
	var rid uuid.NullUUID
	if rec != nil {
		rid = uuid.NullUUID{UUID: *rec, Valid: true}
	}
	return q.UpsertAssociation(ctx, sqlcgen.UpsertAssociationParams{LibraryID: lib, Kind: kind, RelPath: rel, RecordingID: rid, State: state, Detail: d})
}

type cueMatch struct {
	entry  Entry
	dir    string
	tracks []CueTrack
	rec    *recInfo
}

// associateCues validates every CUE, then associates per recording: a recording
// with exactly one valid CUE gets it; with several, none is chosen (ADR-0055).
func (s *Scanner) associateCues(ctx context.Context, q *sqlcgen.Queries, lib uuid.UUID, cues []Entry, byRec map[uuid.UUID]*recInfo) error {
	perRec := map[uuid.UUID][]cueMatch{}
	for _, sc := range cues {
		data, err := os.ReadFile(sc.Abs)
		if err != nil {
			if err := s.setAssoc(ctx, q, lib, "cue", sc.Rel, nil, "invalid", "CUE could not be read"); err != nil {
				return err
			}
			continue
		}
		tracks, perr := ParseCue(data)
		if perr != nil {
			if err := s.setAssoc(ctx, q, lib, "cue", sc.Rel, nil, "invalid", perr.Error()); err != nil {
				return err
			}
			continue
		}
		dir := path.Dir(sc.Rel)
		if dir == "." {
			dir = ""
		}
		refs := map[string]bool{}
		for _, t := range tracks {
			refs[path.Clean(path.Join(dir, strings.ReplaceAll(t.File, `\`, "/")))] = true
		}
		var found *recInfo
		for _, r := range byRec {
			rel := map[string]bool{}
			for _, m := range r.Members {
				rel[m.Rel] = true
			}
			ok := len(refs) > 0
			for ref := range refs {
				if !rel[ref] {
					ok = false
				}
			}
			// The CUE must live inside the recording's folder tree.
			if ok && r.Dir != "" && dir != r.Dir && !strings.HasPrefix(dir+"/", r.Dir+"/") {
				ok = false
			}
			if ok {
				found = r
				break
			}
		}
		if found == nil {
			if err := s.setAssoc(ctx, q, lib, "cue", sc.Rel, nil, "invalid", "references files that are not all in one recording"); err != nil {
				return err
			}
			continue
		}
		perRec[found.ID] = append(perRec[found.ID], cueMatch{entry: sc, dir: dir, tracks: tracks, rec: found})
	}
	for recID, ms := range perRec {
		// A reviewer's earlier choice settles which CUE applies to this recording.
		if len(ms) > 1 {
			if chosen, err := q.GetResolvedChoice(ctx, sqlcgen.GetResolvedChoiceParams{LibraryID: lib, SubjectKey: "cue:" + recID.String()}); err == nil && chosen != "" {
				var keep []cueMatch
				for _, m := range ms {
					if m.entry.Rel == chosen {
						keep = append(keep, m)
					} else if err := s.setAssoc(ctx, q, lib, "cue", m.entry.Rel, nil, "invalid", "another CUE was chosen"); err != nil {
						return err
					}
				}
				if len(keep) == 1 {
					ms = keep
				}
			}
		}
		if len(ms) == 1 {
			m := ms[0]
			if err := s.writeCue(ctx, q, m.rec, m.dir, m.tracks); err != nil {
				return err
			}
			_ = q.CloseReviewByKey(ctx, sqlcgen.CloseReviewByKeyParams{LibraryID: lib, Kind: "association", SubjectKey: "cue:" + recID.String(), Now: s.now()})
			if err := s.setAssoc(ctx, q, lib, "cue", m.entry.Rel, &recID, "associated", ""); err != nil {
				return err
			}
			continue
		}
		var rels []string
		for _, m := range ms {
			rels = append(rels, m.entry.Rel)
		}
		sort.Strings(rels)
		raw, _ := json.Marshal(map[string]any{"kind": "cue", "recording": recID.String(), "candidates": rels})
		if _, err := q.UpsertOpenReview(ctx, sqlcgen.UpsertOpenReviewParams{LibraryID: lib, Kind: "association", SubjectKey: "cue:" + recID.String(), Candidates: raw}); err != nil {
			return err
		}
		for _, m := range ms {
			if err := s.setAssoc(ctx, q, lib, "cue", m.entry.Rel, nil, "needs_review", "more than one CUE matches this recording"); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Scanner) ambiguous(ctx context.Context, q *sqlcgen.Queries, lib uuid.UUID, kind, rel string, cands []*recInfo) error {
	var ids []string
	for _, c := range cands {
		ids = append(ids, c.ID.String())
	}
	sort.Strings(ids)
	raw, _ := json.Marshal(map[string]any{"sidecar": rel, "kind": kind, "recordings": ids})
	if _, err := q.UpsertOpenReview(ctx, sqlcgen.UpsertOpenReviewParams{LibraryID: lib, Kind: "association", SubjectKey: rel, Candidates: raw}); err != nil {
		return err
	}
	return s.setAssoc(ctx, q, lib, kind, rel, nil, "needs_review", "more than one recording matches")
}

// writeCue stores CUE starts file-relative in recording order. Offsets that do
// not fit are rejected as a whole when the catalog validates the source.
func (s *Scanner) writeCue(ctx context.Context, q *sqlcgen.Queries, rec *recInfo, cueDir string, tracks []CueTrack) error {
	byRel := map[string]member{}
	for _, m := range rec.Members {
		byRel[m.Rel] = m
	}
	var starts []chapterStart
	for _, t := range tracks {
		rel := path.Clean(path.Join(cueDir, strings.ReplaceAll(t.File, `\`, "/")))
		m := byRel[rel]
		label := t.Title
		if label == "" {
			label = fmt.Sprintf("Track %d", len(starts)+1)
		}
		starts = append(starts, chapterStart{FileID: m.FileID, ContentVersion: m.Version, OffsetMs: t.OffsetMs, Label: label})
	}
	raw, _ := json.Marshal(starts)
	return q.UpsertIngestChapterSource(ctx, sqlcgen.UpsertIngestChapterSourceParams{RecordingID: rec.ID, Source: "cue", Starts: raw})
}

// associateMetadata ties a Litara JSON or OPF sidecar to the one recording whose
// folder it sits in, or (for loose root-level files) whose file name it shares.
func (s *Scanner) associateMetadata(ctx context.Context, q *sqlcgen.Queries, lib uuid.UUID, sc Entry, byRec map[uuid.UUID]*recInfo) error {
	dir := path.Dir(sc.Rel)
	if dir == "." {
		dir = ""
	}
	base := strings.TrimSuffix(path.Base(sc.Rel), path.Ext(sc.Rel))
	base = strings.TrimSuffix(base, ".litara")
	var cands []*recInfo
	for _, r := range byRec {
		switch {
		case r.Dir != "" && r.Dir == dir:
			cands = append(cands, r)
		case r.Dir == "" && len(r.Members) == 1 && path.Dir(r.Members[0].Rel) == pathDirOrDot(dir) &&
			strings.EqualFold(strings.TrimSuffix(path.Base(r.Members[0].Rel), path.Ext(r.Members[0].Rel)), base):
			cands = append(cands, r)
		}
	}
	kind := sc.Side
	switch len(cands) {
	case 0:
		return s.setAssoc(ctx, q, lib, kind, sc.Rel, nil, "needs_review", "no recording matches this sidecar")
	case 1:
		_ = q.CloseReviewByKey(ctx, sqlcgen.CloseReviewByKeyParams{LibraryID: lib, Kind: "association", SubjectKey: sc.Rel, Now: s.now()})
		return s.setAssoc(ctx, q, lib, kind, sc.Rel, &cands[0].ID, "associated", "")
	}
	return s.ambiguous(ctx, q, lib, kind, sc.Rel, cands)
}

func pathDirOrDot(d string) string {
	if d == "" {
		return "."
	}
	return d
}
