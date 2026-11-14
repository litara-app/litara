package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// SupportedMIME is the audio set this slice can play and download (MP3, M4A/M4B).
var SupportedMIME = map[string]bool{"audio/mpeg": true, "audio/mp4": true, "audio/x-m4b": true, "audio/x-m4a": true}

type Service struct {
	pool    *pgxpool.Pool
	q       *sqlcgen.Queries
	apiBase string // public path prefix + /api/v1
}

func New(pool *pgxpool.Pool, apiBase string) *Service {
	return &Service{pool: pool, q: sqlcgen.New(pool), apiBase: strings.TrimRight(apiBase, "/")}
}

func unavailable(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := apperr.As(err); ok {
		return err
	}
	return fmt.Errorf("database: %w", err)
}

func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func rfcp(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := rfc(*t)
	return &s
}

// Authorize loads a recording the user may read: 404 if unknown, 403 if the
// user has no explicit grant on its library (administrators have no bypass).
func (s *Service) Authorize(ctx context.Context, userID, recordingID uuid.UUID) (sqlcgen.GetRecordingRow, error) {
	rec, err := s.q.GetRecording(ctx, recordingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return rec, apperr.ErrNotFound
	}
	if err != nil {
		return rec, unavailable(err)
	}
	ok, err := s.q.HasGrant(ctx, sqlcgen.HasGrantParams{UserID: userID, LibraryID: rec.LibraryID})
	if err != nil {
		return rec, unavailable(err)
	}
	if !ok {
		return rec, apperr.ErrAccessDenied
	}
	return rec, nil
}

// Readiness is the evaluated state of a recording's current files.
type Readiness struct {
	Ready      bool
	DurationMs *int64
	Issues     []wire.Issue
}

// Evaluate applies the ready/incomplete rule: every file present, supported,
// with known positive duration and size. Unknown numbers stay null.
func Evaluate(files []sqlcgen.ListRecordingFilesRow) Readiness {
	r := Readiness{Ready: len(files) > 0}
	var total int64
	known := len(files) > 0
	for _, f := range files {
		fid := f.FileID.String()
		if !f.Available {
			r.Ready = false
			r.Issues = append(r.Issues, wire.Issue{Code: "file_unavailable", Message: "A file of this recording is missing or unreadable.", FileID: &fid})
		}
		if f.DurationMs == nil || *f.DurationMs <= 0 {
			r.Ready, known = false, false
			r.Issues = append(r.Issues, wire.Issue{Code: "file_timing_unknown", Message: "The duration of a file is unknown.", FileID: &fid})
		} else {
			total += *f.DurationMs
		}
		if f.SizeBytes == nil {
			r.Ready = false
			r.Issues = append(r.Issues, wire.Issue{Code: "file_size_unknown", Message: "The size of a file is unknown.", FileID: &fid})
		}
		if !SupportedMIME[f.MimeType] {
			r.Ready = false
			r.Issues = append(r.Issues, wire.Issue{Code: "file_unsupported", Message: "A file format is not supported for playback in this slice.", FileID: &fid})
		}
	}
	if known {
		r.DurationMs = &total
	}
	return r
}

func (s *Service) filePath(fileID, version uuid.UUID) string {
	return fmt.Sprintf("%s/files/%s/versions/%s/content", s.apiBase, fileID, version)
}

func (s *Service) artwork(id uuid.UUID, thumb, cover *string) wire.Artwork {
	var a wire.Artwork
	if thumb != nil {
		p := fmt.Sprintf("%s/recordings/%s/artwork/thumbnail", s.apiBase, id)
		a.ThumbnailPath = &p
	}
	if cover != nil {
		p := fmt.Sprintf("%s/recordings/%s/artwork/cover", s.apiBase, id)
		a.CoverPath = &p
	}
	return a
}

func activity(a, b *time.Time) *time.Time {
	switch {
	case a == nil:
		return b
	case b == nil:
		return a
	case a.After(*b):
		return a
	}
	return b
}

func series(name *string, index *float64) wire.Nullable[wire.Series] {
	if name == nil {
		return wire.Nullable[wire.Series]{}
	}
	return wire.Some(&wire.Series{Name: *name, Index: index})
}

func nz(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func i64str(n int64) string { return fmt.Sprintf("%d", n) }

// Snapshot returns the self-contained schemaVersion=1 offline snapshot.
func (s *Service) Snapshot(ctx context.Context, userID, recordingID uuid.UUID) (wire.Recording, error) {
	rec, err := s.Authorize(ctx, userID, recordingID)
	if err != nil {
		return wire.Recording{}, err
	}
	files, err := s.q.ListRecordingFiles(ctx, []uuid.UUID{recordingID})
	if err != nil {
		return wire.Recording{}, unavailable(err)
	}
	if len(files) == 0 {
		return wire.Recording{}, apperr.ErrNotFound
	}
	srcs, err := s.q.ListChapterSources(ctx, recordingID)
	if err != nil {
		return wire.Recording{}, unavailable(err)
	}
	sum, err := s.q.GetCompletionSummary(ctx, sqlcgen.GetCompletionSummaryParams{UserID: userID, RecordingID: recordingID})
	if err != nil {
		return wire.Recording{}, unavailable(err)
	}

	ev := Evaluate(files)
	infos := make([]FileInfo, 0, len(files))
	outFiles := make([]wire.File, 0, len(files))
	for _, f := range files {
		infos = append(infos, FileInfo{ID: f.FileID, Version: f.ContentVersion, Sequence: int(f.Sequence), Filename: f.Filename, DurationMs: f.DurationMs})
		outFiles = append(outFiles, wire.File{ID: f.FileID.String(), ContentVersion: f.ContentVersion.String(), Sequence: int64(f.Sequence),
			Filename: f.Filename, MimeType: f.MimeType, SizeBytes: f.SizeBytes, DurationMs: f.DurationMs, Available: f.Available,
			ContentPath: s.filePath(f.FileID, f.ContentVersion)})
	}
	cands := make([]Candidate, 0, len(srcs))
	for _, c := range srcs {
		var starts []Start
		if err := json.Unmarshal(c.Starts, &starts); err != nil {
			// Unparseable raw evidence is preserved but cannot be selected.
			cands = append(cands, Candidate{Source: c.Source})
			continue
		}
		cands = append(cands, Candidate{Source: c.Source, Starts: starts})
	}
	sel := SelectChapters(recordingID, infos, cands)
	issues := append(ev.Issues, sel.Issues...)
	if issues == nil {
		issues = []wire.Issue{}
	}
	out := wire.Recording{
		RecordingSummary: wire.RecordingSummary{ID: recordingID.String(), TitleID: rec.TitleID.String(), LibraryID: rec.LibraryID.String(),
			Title: rec.Title, Authors: nz(rec.Authors), Narrators: nz(rec.Narrators), Series: series(rec.SeriesName, rec.SeriesIndex),
			Readiness: map[bool]string{true: "ready", false: "incomplete"}[ev.Ready], DurationMs: ev.DurationMs,
			Artwork:        s.artwork(recordingID, rec.ThumbnailLocator, rec.CoverLocator),
			Completion:     wire.CompletionState{Revision: i64str(sum.Revision), Finished: sum.Finished, ChangedAt: rfcp(sum.ChangedAt)},
			LastActivityAt: rfcp(activity(sum.PositionReceivedAt, sum.ChangedAt))},
		SchemaVersion: 1, LayoutRevision: rec.LayoutRevision.String(), Files: outFiles, Chapters: sel.Chapters,
		Capabilities: wire.Capabilities{Play: ev.Ready, Download: ev.Ready, WholeRecordingSeek: ev.Ready}, Issues: issues,
	}
	return out, nil
}

// ListParams are validated list/search parameters.
type ListParams struct {
	Page       int
	Size       int
	Q          string
	LibraryID  *uuid.UUID
	Completion string
	Sort       string
}

// List returns permitted recordings; totals are computed after authorization.
func (s *Service) List(ctx context.Context, userID uuid.UUID, p ListParams) (wire.Recordings, error) {
	var q *string
	if t := strings.TrimSpace(p.Q); t != "" {
		q = &t
	}
	lib := uuid.NullUUID{}
	if p.LibraryID != nil {
		lib = uuid.NullUUID{UUID: *p.LibraryID, Valid: true}
	}
	completion, sort := p.Completion, p.Sort
	if completion == "" {
		completion = "any"
	}
	if sort == "" {
		sort = "title"
	}
	total, err := s.q.CountRecordingsPage(ctx, sqlcgen.CountRecordingsPageParams{UserID: userID, LibraryID: lib, Q: q, Completion: completion})
	if err != nil {
		return wire.Recordings{}, unavailable(err)
	}
	rows, err := s.q.ListRecordingsPage(ctx, sqlcgen.ListRecordingsPageParams{UserID: userID, LibraryID: lib, Q: q, Completion: completion,
		Sort: sort, PageSize: int32(p.Size), PageOffset: int32(p.Page * p.Size)})
	if err != nil {
		return wire.Recordings{}, unavailable(err)
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	files, err := s.q.ListRecordingFiles(ctx, ids)
	if err != nil {
		return wire.Recordings{}, unavailable(err)
	}
	byRec := map[uuid.UUID][]sqlcgen.ListRecordingFilesRow{}
	for _, f := range files {
		byRec[f.RecordingID] = append(byRec[f.RecordingID], f)
	}
	out := wire.Recordings{Items: make([]wire.RecordingSummary, 0, len(rows)), Total: total, Page: int64(p.Page), Size: int64(p.Size)}
	for _, r := range rows {
		ev := Evaluate(byRec[r.ID])
		out.Items = append(out.Items, wire.RecordingSummary{ID: r.ID.String(), TitleID: r.TitleID.String(), LibraryID: r.LibraryID.String(),
			Title: r.Title, Authors: nz(r.Authors), Narrators: nz(r.Narrators), Series: series(r.SeriesName, r.SeriesIndex),
			Readiness: map[bool]string{true: "ready", false: "incomplete"}[ev.Ready], DurationMs: ev.DurationMs,
			Artwork:        s.artwork(r.ID, r.ThumbnailLocator, r.CoverLocator),
			Completion:     wire.CompletionState{Revision: i64str(r.CompletionRevision), Finished: r.CompletionFinished, ChangedAt: rfcp(r.CompletionChangedAt)},
			LastActivityAt: rfcp(activity(r.PositionReceivedAt, r.CompletionChangedAt))})
	}
	return out, nil
}

// ArtworkTarget is an internal artwork locator and its fixed MIME type.
type ArtworkTarget struct {
	Locator string
	MIME    string
}

// Artwork resolves thumbnail/cover for an authorized caller; absence is 404.
func (s *Service) Artwork(ctx context.Context, userID, recordingID uuid.UUID, kind string) (ArtworkTarget, error) {
	rec, err := s.Authorize(ctx, userID, recordingID)
	if err != nil {
		return ArtworkTarget{}, err
	}
	loc, mime := rec.ThumbnailLocator, rec.ThumbnailMime
	if kind == "cover" {
		loc, mime = rec.CoverLocator, rec.CoverMime
	}
	if loc == nil || mime == nil {
		return ArtworkTarget{}, apperr.ErrNotFound
	}
	return ArtworkTarget{Locator: *loc, MIME: *mime}, nil
}

// History lists the caller's title completion history.
func (s *Service) History(ctx context.Context, userID, titleID uuid.UUID, page, size int) (wire.History, error) {
	libs, err := s.q.TitleLibraryIDs(ctx, titleID)
	if err != nil {
		return wire.History{}, unavailable(err)
	}
	if len(libs) == 0 {
		return wire.History{}, apperr.ErrNotFound
	}
	granted := false
	for _, l := range libs {
		ok, err := s.q.HasGrant(ctx, sqlcgen.HasGrantParams{UserID: userID, LibraryID: l})
		if err != nil {
			return wire.History{}, unavailable(err)
		}
		granted = granted || ok
	}
	if !granted {
		return wire.History{}, apperr.ErrAccessDenied
	}
	total, err := s.q.CountHistory(ctx, sqlcgen.CountHistoryParams{UserID: userID, TitleID: titleID})
	if err != nil {
		return wire.History{}, unavailable(err)
	}
	rows, err := s.q.ListHistory(ctx, sqlcgen.ListHistoryParams{UserID: userID, TitleID: titleID, Limit: int32(size), Offset: int32(page * size)})
	if err != nil {
		return wire.History{}, unavailable(err)
	}
	out := wire.History{Items: make([]wire.HistoryEntry, 0, len(rows)), Total: total, Page: int64(page), Size: int64(size)}
	for _, h := range rows {
		out.Items = append(out.Items, wire.HistoryEntry{ID: h.ID.String(), RecordingID: h.RecordingID.String(), TitleID: h.TitleID.String(),
			Event: h.Event, CapturedAt: rfc(h.CapturedAt), ReceivedAt: rfc(h.ReceivedAt)})
	}
	return out, nil
}

// FileTarget is a resolved, authorized media file.
type FileTarget struct {
	Locator string
	MIME    string
	Size    int64
	ETag    string
}

// ResolveFile authorizes access to one file version. Order: unknown file 404;
// no granted recording 403; unknown version 404; superseded version 412
// content_changed; incomplete current recording 409.
func (s *Service) ResolveFile(ctx context.Context, userID, fileID, version uuid.UUID) (FileTarget, error) {
	exists, err := s.q.FileExists(ctx, fileID)
	if err != nil {
		return FileTarget{}, unavailable(err)
	}
	if !exists {
		return FileTarget{}, apperr.ErrNotFound
	}
	recs, err := s.q.ListFileRecordings(ctx, sqlcgen.ListFileRecordingsParams{FileID: fileID, UserID: userID})
	if err != nil {
		return FileTarget{}, unavailable(err)
	}
	if len(recs) == 0 {
		return FileTarget{}, apperr.ErrNotFound
	}
	var granted []uuid.UUID
	for _, r := range recs {
		if r.Granted {
			granted = append(granted, r.RecordingID)
		}
	}
	if len(granted) == 0 {
		return FileTarget{}, apperr.ErrAccessDenied
	}
	fv, err := s.q.GetFileVersion(ctx, sqlcgen.GetFileVersionParams{ContentVersion: version, FileID: fileID})
	if errors.Is(err, pgx.ErrNoRows) {
		return FileTarget{}, apperr.ErrNotFound
	}
	if err != nil {
		return FileTarget{}, unavailable(err)
	}
	if !fv.Current {
		return FileTarget{}, apperr.New(412, "content_changed", "That content version is no longer served; refetch the recording snapshot.")
	}
	all, err := s.q.ListRecordingFiles(ctx, granted)
	if err != nil {
		return FileTarget{}, unavailable(err)
	}
	byRec := map[uuid.UUID][]sqlcgen.ListRecordingFilesRow{}
	for _, f := range all {
		byRec[f.RecordingID] = append(byRec[f.RecordingID], f)
	}
	for _, rid := range granted {
		if !Evaluate(byRec[rid]).Ready {
			return FileTarget{}, apperr.ErrIncomplete
		}
	}
	if fv.SizeBytes == nil {
		return FileTarget{}, apperr.ErrIncomplete
	}
	return FileTarget{Locator: fv.Locator, MIME: fv.MimeType, Size: *fv.SizeBytes, ETag: fmt.Sprintf("%q", fv.ContentVersion.String())}, nil
}
