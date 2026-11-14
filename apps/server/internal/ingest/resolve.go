package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
)

// Resolution is a reviewer's decision for one open review item.
type Resolution struct {
	Action  string   `json:"action"`
	Missing string   `json:"missingFileId,omitempty"` // move
	NewPath string   `json:"newPath,omitempty"`       // move
	Files   []string `json:"files,omitempty"`         // ordering: the chosen order
	TitleID string   `json:"titleId,omitempty"`       // grouping/title link
	Path    string   `json:"path,omitempty"`          // association: chosen sidecar
}

func bad(msg string) error { return apperr.Validation(msg) }

// ResolveReview applies a reviewer's choice. Provider reviews are resolved by
// the metadata layer; everything here changes catalog structure only through
// the same paths the scanner uses, so identities and history are preserved.
func (s *Scanner) ResolveReview(ctx context.Context, lib, id, by uuid.UUID, in Resolution) error {
	q := sqlcgen.New(s.Pool)
	item, err := q.GetReviewItem(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && item.LibraryID != lib) {
		return apperr.ErrNotFound
	}
	if err != nil {
		return apperr.ErrUnavailable
	}
	if item.State != "open" {
		return apperr.New(http.StatusConflict, "review_closed", "This review item is already resolved.")
	}
	var applyErr error
	switch item.Kind {
	case "move":
		applyErr = s.resolveMove(ctx, lib, item, in)
	case "ordering":
		applyErr = s.resolveOrdering(ctx, lib, item, in)
	case "grouping":
		applyErr = s.resolveGrouping(ctx, lib, item, in)
	case "association":
		applyErr = s.resolveAssociation(ctx, lib, item, in)
	default:
		return bad("this kind of review item is resolved elsewhere")
	}
	if applyErr != nil {
		return applyErr
	}
	payload := map[string]any{"action": in.Action}
	if item.Kind == "move" && in.Action == "keep_separate" {
		payload["keepSeparate"] = true
	}
	if in.Path != "" {
		payload["path"] = in.Path
	}
	if in.TitleID != "" {
		payload["titleId"] = in.TitleID
	}
	if len(in.Files) > 0 {
		payload["files"] = in.Files
	}
	return s.CloseReview(ctx, id, by, payload)
}

// CloseReview records the reviewer's resolution. If applying the decision
// already closed the item as an automatic resolution (the same code path the
// scanner uses), the audit record is replaced by the reviewer's decision.
func (s *Scanner) CloseReview(ctx context.Context, id, by uuid.UUID, in any) error {
	raw, _ := json.Marshal(in)
	q := sqlcgen.New(s.Pool)
	byID := uuid.NullUUID{UUID: by, Valid: by != uuid.Nil}
	_, err := q.ResolveReviewItem(ctx, sqlcgen.ResolveReviewItemParams{ID: id, Resolution: raw, ResolvedBy: byID, Now: s.now()})
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = q.RecordResolution(ctx, sqlcgen.RecordResolutionParams{ID: id, Resolution: raw, ResolvedBy: byID, Now: s.now()})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.New(http.StatusConflict, "review_closed", "This review item is already resolved.")
	}
	if err != nil {
		return apperr.ErrUnavailable
	}
	return nil
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func (s *Scanner) resolveMove(ctx context.Context, lib uuid.UUID, item sqlcgen.ReviewItem, in Resolution) error {
	switch in.Action {
	case "keep_separate":
		// Recorded on the item; later scans treat these paths as new files.
		return nil
	case "move":
	default:
		return bad("action must be move or keep_separate")
	}
	var c moveCandidates
	if json.Unmarshal(item.Candidates, &c) != nil {
		return apperr.ErrUnavailable
	}
	if !contains(c.MissingFiles, in.Missing) || !contains(c.NewPaths, in.NewPath) {
		return bad("missingFileId and newPath must be among the candidates")
	}
	q := sqlcgen.New(s.Pool)
	known, err := q.ListObservations(ctx, lib)
	if err != nil {
		return apperr.ErrUnavailable
	}
	var old *obs
	for i := range known {
		if known[i].FileID.String() == in.Missing {
			old = &known[i]
		}
	}
	if old == nil || old.Sha256 == nil || *old.Sha256 != c.SHA256 {
		return apperr.New(http.StatusConflict, "review_stale", "The candidate file changed; wait for the next scan.")
	}
	cfg, err := q.GetLibraryConfig(ctx, lib)
	if err != nil {
		return apperr.ErrUnavailable
	}
	root, err := CanonicalRoot(cfg.RootPath)
	if err != nil {
		return apperr.New(http.StatusServiceUnavailable, "library_unavailable", "The library root is not accessible.")
	}
	abs := filepath.Join(root, filepath.FromSlash(in.NewPath))
	if !within(root, abs) {
		return bad("newPath escapes the library root")
	}
	info, err := os.Stat(abs)
	if err != nil {
		return apperr.New(http.StatusConflict, "review_stale", "The new path no longer exists.")
	}
	sum, _, err := HashFile(ctx, abs)
	if err != nil || sum != c.SHA256 {
		return apperr.New(http.StatusConflict, "review_stale", "The file at the new path changed.")
	}
	e := Entry{Rel: in.NewPath, Abs: abs, Size: info.Size(), Mtime: micro(info.ModTime()), Mime: mediaTypes[strings.ToLower(filepath.Ext(abs))]}
	return s.move(ctx, lib, *old, e, s.now())
}

func (s *Scanner) resolveOrdering(ctx context.Context, lib uuid.UUID, item sqlcgen.ReviewItem, in Resolution) error {
	if in.Action != "order" {
		return bad("action must be order")
	}
	var c struct {
		Files []string `json:"files"`
	}
	if json.Unmarshal(item.Candidates, &c) != nil {
		return apperr.ErrUnavailable
	}
	want := append([]string(nil), c.Files...)
	got := append([]string(nil), in.Files...)
	sort.Strings(want)
	sort.Strings(got)
	if len(want) != len(got) {
		return bad("files must list every file of the recording exactly once")
	}
	for i := range want {
		if want[i] != got[i] {
			return bad("files must list every file of the recording exactly once")
		}
	}
	q := sqlcgen.New(s.Pool)
	rows, err := q.ListUngroupedAudio(ctx, lib)
	if err != nil {
		return apperr.ErrUnavailable
	}
	by := map[string]member{}
	for _, r := range rows {
		by[r.RelPath] = toMember(r.FileID, r.ContentVersion, r.RelPath, r.DurationMs, r.Result)
	}
	var ordered []member
	for _, rel := range in.Files {
		m, ok := by[rel]
		if !ok {
			return apperr.New(http.StatusConflict, "review_stale", "A file is no longer unassigned.")
		}
		ordered = append(ordered, m)
	}
	var out GroupOutcome
	existing, gerr := q.GetRecordingByGroupKey(ctx, sqlcgen.GetRecordingByGroupKeyParams{LibraryID: lib, GroupKey: &item.SubjectKey})
	if gerr != nil && !errors.Is(gerr, pgx.ErrNoRows) {
		return apperr.ErrUnavailable
	}
	if gerr == nil {
		return bad("a recording already exists for this folder")
	}
	return s.persistGroup(ctx, lib, item.SubjectKey, existing, false, nil, ordered, &out)
}

func (s *Scanner) resolveGrouping(ctx context.Context, lib uuid.UUID, item sqlcgen.ReviewItem, in Resolution) error {
	q := sqlcgen.New(s.Pool)
	if key, isTitle := strings.CutPrefix(item.SubjectKey, "title:"); isTitle {
		rec, err := q.GetRecordingByGroupKey(ctx, sqlcgen.GetRecordingByGroupKeyParams{LibraryID: lib, GroupKey: &key})
		if err != nil {
			return apperr.New(http.StatusConflict, "review_stale", "The recording no longer exists.")
		}
		switch in.Action {
		case "keep_separate":
			return q.ConfirmRecordingLink(ctx, rec.ID)
		case "link":
			var c struct {
				Existing []string `json:"existingTitles"`
			}
			_ = json.Unmarshal(item.Candidates, &c)
			target, perr := uuid.Parse(in.TitleID)
			if perr != nil || !contains(c.Existing, in.TitleID) {
				return bad("titleId must be one of the candidate titles")
			}
			old := rec.TitleID
			if err := q.SetRecordingTitle(ctx, sqlcgen.SetRecordingTitleParams{ID: rec.ID, TitleID: target}); err != nil {
				return apperr.ErrUnavailable
			}
			return q.DeleteTitleIfUnused(ctx, old)
		}
		return bad("action must be link or keep_separate")
	}
	// Mixed albums in one folder: the reviewer confirms they are one recording.
	if in.Action != "group_as_one" {
		return bad("action must be group_as_one")
	}
	rows, err := q.ListUngroupedAudio(ctx, lib)
	if err != nil {
		return apperr.ErrUnavailable
	}
	var all []member
	for _, r := range rows {
		if k, _, _ := groupKey(r.RelPath); k == item.SubjectKey {
			all = append(all, toMember(r.FileID, r.ContentVersion, r.RelPath, r.DurationMs, r.Result))
		}
	}
	if len(all) == 0 {
		return apperr.New(http.StatusConflict, "review_stale", "No unassigned files remain.")
	}
	ord := OrderMembers(all)
	if ord.Conflict != "" {
		return apperr.New(http.StatusConflict, "ordering_unresolved", "Order the files first: "+ord.Conflict)
	}
	var out GroupOutcome
	return s.persistGroup(ctx, lib, item.SubjectKey, sqlcgen.Recording{}, false, nil, ord.Order, &out)
}

func (s *Scanner) resolveAssociation(ctx context.Context, lib uuid.UUID, item sqlcgen.ReviewItem, in Resolution) error {
	if in.Action != "choose" {
		return bad("action must be choose")
	}
	var c struct {
		Kind       string   `json:"kind"`
		Recording  string   `json:"recording"`
		Candidates []string `json:"candidates"`
	}
	if json.Unmarshal(item.Candidates, &c) != nil || c.Kind != "cue" || !contains(c.Candidates, in.Path) {
		return bad("path must be one of the candidate CUE files")
	}
	recID, err := uuid.Parse(c.Recording)
	if err != nil {
		return apperr.ErrUnavailable
	}
	q := sqlcgen.New(s.Pool)
	cfg, err := q.GetLibraryConfig(ctx, lib)
	if err != nil {
		return apperr.ErrUnavailable
	}
	root, err := CanonicalRoot(cfg.RootPath)
	if err != nil {
		return apperr.New(http.StatusServiceUnavailable, "library_unavailable", "The library root is not accessible.")
	}
	abs := filepath.Join(root, filepath.FromSlash(in.Path))
	data, err := os.ReadFile(abs)
	if err != nil || !within(root, abs) {
		return apperr.New(http.StatusConflict, "review_stale", "The CUE file is not readable.")
	}
	tracks, err := ParseCue(data)
	if err != nil {
		return bad("the chosen CUE is invalid: " + err.Error())
	}
	members, err := q.ListRecordingMembers(ctx, []uuid.UUID{recID})
	if err != nil {
		return apperr.ErrUnavailable
	}
	rec := &recInfo{ID: recID}
	for _, m := range members {
		rec.Members = append(rec.Members, toMember(m.FileID, m.ContentVersion, m.RelPath, m.DurationMs, m.Result))
	}
	dir := path.Dir(in.Path)
	if dir == "." {
		dir = ""
	}
	if err := s.writeCue(ctx, q, rec, dir, tracks); err != nil {
		return apperr.ErrUnavailable
	}
	for _, p := range c.Candidates {
		if p == in.Path {
			if err := q.SetAssociationState(ctx, sqlcgen.SetAssociationStateParams{LibraryID: lib, RelPath: p, State: "associated", RecordingID: uuid.NullUUID{UUID: recID, Valid: true}}); err != nil {
				return apperr.ErrUnavailable
			}
			continue
		}
		d := "another CUE was chosen"
		if err := q.SetAssociationState(ctx, sqlcgen.SetAssociationStateParams{LibraryID: lib, RelPath: p, State: "invalid", Detail: &d}); err != nil {
			return apperr.ErrUnavailable
		}
	}
	return nil
}
