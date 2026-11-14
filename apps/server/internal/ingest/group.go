package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
)

// member is one audio file considered for a recording.
type member struct {
	FileID   uuid.UUID
	Version  uuid.UUID
	Rel      string
	Duration *int64
	Tags     map[string]string
	Chapters []inspect.Chapter
	Disc     int // from a disc folder (0 when none)
}

var discFolder = regexp.MustCompile(`(?i)^(cd|disc|disk)[ _-]*0*(\d+)$`)

// recordingDir returns the directory that identifies a recording and the disc
// number implied by a disc subfolder (ADR-0061). Files directly in the library
// root or in a folder shared by unrelated files have no folder identity.
func recordingDir(rel string) (dir string, disc int) {
	d := path.Dir(rel)
	if d == "." {
		return "", 0
	}
	if m := discFolder.FindStringSubmatch(path.Base(d)); m != nil {
		n, _ := strconv.Atoi(m[2])
		parent := path.Dir(d)
		if parent == "." {
			parent = ""
		}
		return parent, n
	}
	return d, 0
}

// groupKey names the recording a file belongs to. Root-level files stand alone.
func groupKey(rel string) (key, dir string, disc int) {
	dir, disc = recordingDir(rel)
	if dir == "" {
		return "file:" + rel, "", disc
	}
	return "dir:" + dir, dir, disc
}

func tagOf(tags map[string]string, names ...string) string {
	for _, want := range names {
		for k, v := range tags {
			if strings.EqualFold(k, want) && strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
		}
	}
	return ""
}

// parseNumber reads "3" or "3/12" and returns 3.
func parseNumber(s string) (int, bool) {
	if s == "" {
		return 0, false
	}
	head := strings.SplitN(s, "/", 2)[0]
	n, err := strconv.Atoi(strings.TrimSpace(head))
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}

// naturalKey splits a base name into text and number runs for natural ordering.
func naturalKey(name string) []any {
	name = strings.ToLower(strings.TrimSuffix(name, path.Ext(name)))
	var parts []any
	var cur []rune
	digits := false
	flush := func() {
		if len(cur) == 0 {
			return
		}
		if digits {
			n, _ := strconv.Atoi(string(cur))
			parts = append(parts, n)
		} else {
			parts = append(parts, string(cur))
		}
		cur = cur[:0]
	}
	for _, r := range name {
		d := unicode.IsDigit(r)
		if len(cur) > 0 && d != digits {
			flush()
		}
		digits = d
		cur = append(cur, r)
	}
	flush()
	return parts
}

func compareKeys(a, b []any) int {
	for i := 0; i < len(a) && i < len(b); i++ {
		switch x := a[i].(type) {
		case int:
			if y, ok := b[i].(int); ok {
				if x != y {
					return cmpInt(x, y)
				}
				continue
			}
			return -1
		case string:
			if y, ok := b[i].(string); ok {
				if x != y {
					return strings.Compare(x, y)
				}
				continue
			}
			return 1
		}
	}
	return cmpInt(len(a), len(b))
}

func cmpInt(a, b int) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// OrderResult explains how a recording's file order was derived.
type OrderResult struct {
	Order    []member
	Basis    string // "tags", "filename"
	Conflict string // non-empty when the order needs human review
}

// OrderMembers applies ADR-0061: complete, consistent disc/track tags first;
// otherwise an unambiguous natural filename / disc-folder order; anything
// conflicting or ambiguous is reported for review and not ordered.
func OrderMembers(ms []member) OrderResult {
	if len(ms) == 1 {
		return OrderResult{Order: ms, Basis: "single"}
	}
	// Natural order: disc folder number, then natural key of the file name.
	nat := append([]member(nil), ms...)
	sort.SliceStable(nat, func(i, j int) bool {
		if nat[i].Disc != nat[j].Disc {
			return nat[i].Disc < nat[j].Disc
		}
		return compareKeys(naturalKey(path.Base(nat[i].Rel)), naturalKey(path.Base(nat[j].Rel))) < 0
	})
	natOK := true
	seen := map[string]bool{}
	for _, m := range ms {
		k := fmt.Sprintf("%d|%v", m.Disc, naturalKey(path.Base(m.Rel)))
		if seen[k] || !hasDigit(strings.TrimSuffix(path.Base(m.Rel), path.Ext(m.Rel))) {
			natOK = false
		}
		seen[k] = true
	}

	// Tag order requires a track tag on every file and unique (disc, track) pairs.
	type dt struct{ disc, track int }
	tagged := make([]dt, len(ms))
	tagOK := true
	pairs := map[dt]bool{}
	for i, m := range ms {
		tr, ok := parseNumber(tagOf(m.Tags, "track", "tracknumber"))
		if !ok {
			tagOK = false
			break
		}
		disc, dok := parseNumber(tagOf(m.Tags, "disc", "discnumber"))
		if !dok {
			disc = m.Disc
			if disc == 0 {
				disc = 1
			}
		} else if m.Disc != 0 && disc != m.Disc {
			return OrderResult{Conflict: "disc tag disagrees with the disc folder"}
		}
		tagged[i] = dt{disc, tr}
		if pairs[tagged[i]] {
			tagOK = false
			break
		}
		pairs[tagged[i]] = true
	}
	if tagOK {
		idx := make([]int, len(ms))
		for i := range idx {
			idx[i] = i
		}
		sort.SliceStable(idx, func(a, b int) bool {
			x, y := tagged[idx[a]], tagged[idx[b]]
			if x.disc != y.disc {
				return x.disc < y.disc
			}
			return x.track < y.track
		})
		byTag := make([]member, len(ms))
		for i, k := range idx {
			byTag[i] = ms[k]
		}
		if natOK {
			for i := range byTag {
				if byTag[i].FileID != nat[i].FileID {
					return OrderResult{Conflict: "track tags and file names give different orders"}
				}
			}
		}
		return OrderResult{Order: byTag, Basis: "tags"}
	}
	if natOK {
		return OrderResult{Order: nat, Basis: "filename"}
	}
	return OrderResult{Conflict: "file order is ambiguous (no complete track tags and no unambiguous numbering)"}
}

func hasDigit(s string) bool {
	for _, r := range s {
		if unicode.IsDigit(r) {
			return true
		}
	}
	return false
}

func normText(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// GroupOutcome summarizes a grouping pass.
type GroupOutcome struct {
	Created, Extended, ReviewGrouping, ReviewOrdering int
}

func toMember(fileID, version uuid.UUID, rel string, dur *int64, raw []byte) member {
	m := member{FileID: fileID, Version: version, Rel: rel, Duration: dur, Tags: map[string]string{}}
	_, m.Disc = recordingDir(rel)
	if len(raw) > 0 {
		var r inspect.Result
		if json.Unmarshal(raw, &r) == nil {
			if r.Format.Tags != nil {
				m.Tags = r.Format.Tags
			}
			m.Chapters = r.Chapters
		}
	}
	return m
}

// Group assigns unassigned audio files to recordings. Files already in a
// recording are never moved (manual repairs and history are preserved); new
// files may extend the recording that owns their folder.
func (s *Scanner) Group(ctx context.Context, lib uuid.UUID) (GroupOutcome, error) {
	var out GroupOutcome
	q := sqlcgen.New(s.Pool)
	rows, err := q.ListUngroupedAudio(ctx, lib)
	if err != nil {
		return out, err
	}
	buckets := map[string][]member{}
	for _, r := range rows {
		key, _, _ := groupKey(r.RelPath)
		buckets[key] = append(buckets[key], toMember(r.FileID, r.ContentVersion, r.RelPath, r.DurationMs, r.Result))
	}
	keys := make([]string, 0, len(buckets))
	for k := range buckets {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, key := range keys {
		fresh := buckets[key]
		existing, err := q.GetRecordingByGroupKey(ctx, sqlcgen.GetRecordingByGroupKeyParams{LibraryID: lib, GroupKey: &key})
		var prior []member
		hasExisting := err == nil
		if hasExisting {
			ms, merr := q.ListRecordingMembers(ctx, []uuid.UUID{existing.ID})
			if merr != nil {
				return out, merr
			}
			for _, m := range ms {
				prior = append(prior, toMember(m.FileID, m.ContentVersion, m.RelPath, m.DurationMs, m.Result))
			}
		} else if err != pgx.ErrNoRows {
			return out, err
		}
		all := append(append([]member(nil), prior...), fresh...)

		// Conservative evidence check: a folder whose files name several different
		// albums is not assumed to be one recording.
		albums := map[string]bool{}
		for _, m := range all {
			if a := tagOf(m.Tags, "album"); a != "" {
				albums[normText(a)] = true
			}
		}
		if len(albums) > 1 {
			if err := s.review(ctx, lib, "grouping", key, map[string]any{"reason": "files in one folder name different albums", "files": relPaths(all)}); err != nil {
				return out, err
			}
			out.ReviewGrouping++
			continue
		}

		ord := OrderMembers(all)
		if ord.Conflict != "" {
			if err := s.review(ctx, lib, "ordering", key, map[string]any{"reason": ord.Conflict, "files": relPaths(all)}); err != nil {
				return out, err
			}
			out.ReviewOrdering++
			continue
		}
		if err := s.persistGroup(ctx, lib, key, existing, hasExisting, prior, ord.Order, &out); err != nil {
			return out, err
		}
	}
	return out, nil
}

func relPaths(ms []member) []string {
	r := make([]string, len(ms))
	for i, m := range ms {
		r[i] = m.Rel
	}
	sort.Strings(r)
	return r
}

func (s *Scanner) review(ctx context.Context, lib uuid.UUID, kind, key string, candidates map[string]any) error {
	raw, _ := json.Marshal(candidates)
	_, err := sqlcgen.New(s.Pool).UpsertOpenReview(ctx, sqlcgen.UpsertOpenReviewParams{LibraryID: lib, Kind: kind, SubjectKey: key, Candidates: raw})
	return err
}

func (s *Scanner) persistGroup(ctx context.Context, lib uuid.UUID, key string, existing sqlcgen.Recording, hasExisting bool,
	prior, ordered []member, out *GroupOutcome) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		recID := existing.ID
		if !hasExisting {
			recID = uuid.New()
			titleID, linkState, err := s.linkTitle(ctx, q, lib, key, ordered)
			if err != nil {
				return err
			}
			if err := q.InsertIngestRecording(ctx, sqlcgen.InsertIngestRecordingParams{ID: recID, TitleID: titleID, LibraryID: lib, GroupKey: &key, LinkState: linkState}); err != nil {
				return err
			}
			out.Created++
		} else {
			if sameOrder(prior, ordered) {
				return nil
			}
			if err := q.DeleteRecordingFiles(ctx, recID); err != nil {
				return err
			}
			if err := q.BumpRecordingLayout(ctx, recID); err != nil {
				return err
			}
			out.Extended++
		}
		for i, m := range ordered {
			if err := q.InsertRecordingFile(ctx, sqlcgen.InsertRecordingFileParams{RecordingID: recID, Sequence: int32(i), FileID: m.FileID}); err != nil {
				return err
			}
		}
		_ = q.CloseReviewByKey(ctx, sqlcgen.CloseReviewByKeyParams{LibraryID: lib, Kind: "ordering", SubjectKey: key, Now: s.now()})
		_ = q.CloseReviewByKey(ctx, sqlcgen.CloseReviewByKeyParams{LibraryID: lib, Kind: "grouping", SubjectKey: key, Now: s.now()})
		return s.embeddedChapters(ctx, q, recID, ordered)
	})
}

func sameOrder(a, b []member) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].FileID != b[i].FileID {
			return false
		}
	}
	return true
}

type chapterStart struct {
	FileID         uuid.UUID `json:"fileId"`
	ContentVersion uuid.UUID `json:"contentVersion"`
	OffsetMs       int64     `json:"offsetMs"`
	Label          string    `json:"label"`
}

// embeddedChapters records the embedded chapters of every file, file-relative
// and in recording order. Validation and precedence happen at read time
// (ADR-0029/0042); a user source is never touched.
func (s *Scanner) embeddedChapters(ctx context.Context, q *sqlcgen.Queries, rec uuid.UUID, ordered []member) error {
	var starts []chapterStart
	for _, m := range ordered {
		for _, c := range m.Chapters {
			starts = append(starts, chapterStart{FileID: m.FileID, ContentVersion: m.Version, OffsetMs: c.StartMs, Label: c.Title})
		}
	}
	if len(starts) == 0 {
		return nil
	}
	raw, _ := json.Marshal(starts)
	return q.UpsertIngestChapterSource(ctx, sqlcgen.UpsertIngestChapterSourceParams{RecordingID: rec, Source: "embedded", Starts: raw})
}

// linkTitle finds or creates the title for a new recording. Only a shared
// strong identifier plus the same normalized title and authors links it to an
// existing title; a weaker match stays provisional for review (ADR-0045/0061).
func (s *Scanner) linkTitle(ctx context.Context, q *sqlcgen.Queries, lib uuid.UUID, key string, ordered []member) (uuid.UUID, string, error) {
	var name, author, ident string
	for _, m := range ordered {
		if name == "" {
			name = tagOf(m.Tags, "album")
		}
		if author == "" {
			author = tagOf(m.Tags, "album_artist", "artist")
		}
		if ident == "" {
			ident = tagOf(m.Tags, "isbn", "asin")
		}
	}
	if name == "" {
		name = strings.TrimSuffix(path.Base(strings.TrimPrefix(strings.TrimPrefix(key, "dir:"), "file:")), path.Ext(key))
	}
	authors := []string{}
	if author != "" {
		authors = []string{author}
	}
	gk := normText(name) + "|" + normText(author)
	matches, err := q.ListLibraryTitlesByKey(ctx, sqlcgen.ListLibraryTitlesByKeyParams{LibraryID: lib, GroupKey: &gk})
	if err != nil {
		return uuid.Nil, "", err
	}
	if ident != "" {
		for _, m := range matches {
			if m.Identifier != nil && strings.EqualFold(*m.Identifier, ident) {
				return m.ID, "confirmed", nil // strong identifier and metadata agree
			}
		}
	}
	id := uuid.New()
	var idp *string
	if ident != "" {
		idp = &ident
	}
	if err := q.InsertIngestTitle(ctx, sqlcgen.InsertIngestTitleParams{ID: id, Title: name, Authors: authors, GroupKey: &gk, Identifier: idp}); err != nil {
		return uuid.Nil, "", err
	}
	if len(matches) > 0 {
		var ids []string
		for _, m := range matches {
			ids = append(ids, m.ID.String())
		}
		sort.Strings(ids)
		if err := s.review(ctx, lib, "grouping", "title:"+key, map[string]any{
			"reason": "same title and authors as an existing title without a shared identifier", "newTitle": id.String(), "existingTitles": ids}); err != nil {
			return uuid.Nil, "", err
		}
		return id, "provisional", nil
	}
	return id, "confirmed", nil
}
