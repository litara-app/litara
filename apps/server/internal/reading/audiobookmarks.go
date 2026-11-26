package reading

// Private audiobook bookmarks (ADR-0110). They follow the annotation rules: a client-generated id, a base revision,
// replay by operation id, tombstones, and a retained candidate whenever a write cannot be applied.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/catalog"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// bookmarkTarget is a recording as bookmarks see it: its layout and the current version and length of each file.
type bookmarkTarget struct {
	rec   sqlcgen.GetRecordingRow
	files map[uuid.UUID]sqlcgen.ListRecordingFilesRow
}

func (s *Service) bookmarkTarget(ctx context.Context, userID, recordingID uuid.UUID) (bookmarkTarget, error) {
	rec, err := s.cat.Authorize(ctx, userID, recordingID)
	if err != nil {
		return bookmarkTarget{}, err
	}
	rows, err := s.q.ListRecordingFiles(ctx, []uuid.UUID{recordingID})
	if err != nil {
		return bookmarkTarget{}, dbErr(err)
	}
	t := bookmarkTarget{rec: rec, files: map[uuid.UUID]sqlcgen.ListRecordingFilesRow{}}
	for _, f := range rows {
		t.files[f.FileID] = f
	}
	return t, nil
}

// writable refuses writes to a recording that repair has replaced; its bookmarks stay readable (ADR-0070).
func (t bookmarkTarget) writable() error {
	if t.rec.TombstonedAt != nil {
		return catalog.Repaired(http.StatusConflict, t.rec.SuccessorIds)
	}
	return nil
}

func (t bookmarkTarget) wire(row sqlcgen.AudioBookmark) wire.AudioBookmark {
	f, member := t.files[row.FileID]
	out := wire.AudioBookmark{ID: row.ID.String(), RecordingID: row.RecordingID.String(), Revision: strconv.FormatInt(row.Revision, 10),
		Deleted: row.Deleted, CreatedAt: rfc(row.CreatedAt), UpdatedAt: rfc(row.UpdatedAt),
		Available: !row.Deleted && t.rec.TombstonedAt == nil && row.LayoutRevision == t.rec.LayoutRevision && member && f.ContentVersion == row.ContentVersion}
	if !row.Deleted {
		d := bookmarkData(row)
		out.Data = wire.Nullable[wire.AudioBookmarkData]{Value: &d}
	}
	return out
}

func bookmarkData(row sqlcgen.AudioBookmark) wire.AudioBookmarkData {
	return wire.AudioBookmarkData{FileID: row.FileID.String(), ContentVersion: row.ContentVersion.String(), OffsetMs: row.OffsetMs,
		LayoutRevision: row.LayoutRevision.String(), Note: row.Note}
}

type bookmarkAnchor struct{ file, version, layout uuid.UUID }

func parseBookmarkAnchor(d wire.AudioBookmarkData) (bookmarkAnchor, error) {
	var a bookmarkAnchor
	var err error
	if a.file, err = parseUUID("data.fileId", d.FileID); err != nil {
		return a, err
	}
	if a.version, err = parseUUID("data.contentVersion", d.ContentVersion); err != nil {
		return a, err
	}
	a.layout, err = parseUUID("data.layoutRevision", d.LayoutRevision)
	return a, err
}

// checkAnchor says why a place cannot be bookmarked now: a conflict reason, or a plain validation error.
func (t bookmarkTarget) checkAnchor(a bookmarkAnchor, offset int64) (string, error) {
	if a.layout != t.rec.LayoutRevision {
		return "layout_changed", nil
	}
	f, ok := t.files[a.file]
	if !ok {
		return "", apperr.Validation("data.fileId is not a file of this recording.")
	}
	if f.ContentVersion != a.version {
		return "content_changed", nil
	}
	if f.DurationMs != nil && offset > *f.DurationMs {
		return "", apperr.Validation("data.offsetMs is past the end of the file.")
	}
	return "", nil
}

var bookmarkConflictSpecs = map[string]struct {
	status int
	detail string
}{
	"stale_revision":  {http.StatusConflict, "The base revision is not current; a candidate was kept for resolution."},
	"deleted":         {http.StatusConflict, "The bookmark was deleted; a stale write cannot recreate it. The attempt was kept as a candidate."},
	"content_changed": {http.StatusPreconditionFailed, "The file changed; the attempt was kept as a candidate."},
	"layout_changed":  {http.StatusPreconditionFailed, "The recording layout changed; the attempt was kept as a candidate."},
}

func keepBookmarkCandidate(ctx context.Context, q *sqlcgen.Queries, a Actor, recording, id, op uuid.UUID, reason string, candidate *wire.AudioBookmarkData, base, current int64) (*apperr.Error, error) {
	var raw []byte
	if candidate != nil {
		raw = wire.Raw(*candidate)
	}
	c, err := q.InsertAudioBookmarkConflict(ctx, sqlcgen.InsertAudioBookmarkConflictParams{UserID: a.UserID, RecordingID: recording,
		BookmarkID: id, Reason: reason, OperationID: op, Candidate: raw, BaseRevision: base, CurrentRevision: current})
	if err != nil {
		return nil, err
	}
	spec := bookmarkConflictSpecs[reason]
	return apperr.New(spec.status, reason, spec.detail).With("conflictId", c.ID.String()).With("currentRevision", strconv.FormatInt(current, 10)), nil
}

// currentBookmark reads a bookmark that, if it exists, must belong to this recording.
func currentBookmark(ctx context.Context, q *sqlcgen.Queries, userID, recording, id uuid.UUID) (sqlcgen.AudioBookmark, bool, error) {
	cur, err := q.GetAudioBookmark(ctx, sqlcgen.GetAudioBookmarkParams{UserID: userID, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return cur, false, nil
	}
	if err != nil {
		return cur, false, err
	}
	if cur.RecordingID != recording {
		return cur, false, apperr.Validation("That bookmark belongs to another recording.")
	}
	return cur, true, nil
}

func bookmarkKey(user, id uuid.UUID) string {
	return "audio-bookmark:" + user.String() + ":" + id.String()
}

// Bookmarks lists the caller's own bookmarks on one recording.
func (s *Service) Bookmarks(ctx context.Context, userID, recordingID uuid.UUID, includeDeleted bool, page, size int) (wire.AudioBookmarks, error) {
	t, err := s.bookmarkTarget(ctx, userID, recordingID)
	if err != nil {
		return wire.AudioBookmarks{}, err
	}
	rows, err := s.q.ListAudioBookmarks(ctx, sqlcgen.ListAudioBookmarksParams{UserID: userID, RecordingID: recordingID, IncludeDeleted: includeDeleted,
		PageSize: int32(size), PageOffset: int32(page * size)})
	if err != nil {
		return wire.AudioBookmarks{}, dbErr(err)
	}
	total, err := s.q.CountAudioBookmarks(ctx, sqlcgen.CountAudioBookmarksParams{UserID: userID, RecordingID: recordingID, IncludeDeleted: includeDeleted})
	if err != nil {
		return wire.AudioBookmarks{}, dbErr(err)
	}
	out := wire.AudioBookmarks{Items: []wire.AudioBookmark{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, r := range rows {
		out.Items = append(out.Items, t.wire(r))
	}
	return out, nil
}

// Bookmark reads one bookmark, including a deleted one.
func (s *Service) Bookmark(ctx context.Context, userID, recordingID, id uuid.UUID) (wire.AudioBookmark, error) {
	t, err := s.bookmarkTarget(ctx, userID, recordingID)
	if err != nil {
		return wire.AudioBookmark{}, err
	}
	row, err := s.q.GetAudioBookmark(ctx, sqlcgen.GetAudioBookmarkParams{UserID: userID, ID: id})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && row.RecordingID != recordingID) {
		return wire.AudioBookmark{}, apperr.ErrNotFound
	}
	if err != nil {
		return wire.AudioBookmark{}, dbErr(err)
	}
	return t.wire(row), nil
}

// PutBookmark creates or changes a bookmark.
func (s *Service) PutBookmark(ctx context.Context, a Actor, recordingID, id uuid.UUID, w wire.AudioBookmarkWrite) (wire.AudioBookmark, error) {
	op, base, err := bookmarkWriteHead(w.OperationID, w.BaseRevision, w.CapturedAt)
	if err != nil {
		return wire.AudioBookmark{}, err
	}
	if id == uuid.Nil {
		return wire.AudioBookmark{}, apperr.Validation("bookmarkId must be a UUID.")
	}
	anchor, err := parseBookmarkAnchor(w.Data)
	if err != nil {
		return wire.AudioBookmark{}, err
	}
	t, err := s.bookmarkTarget(ctx, a.UserID, recordingID)
	if err != nil {
		return wire.AudioBookmark{}, err
	}
	if err := t.writable(); err != nil {
		return wire.AudioBookmark{}, err
	}
	fp := fingerprint(http.MethodPut, "/recordings/"+recordingID.String()+"/bookmarks/"+id.String(), w)
	return s.runBookmark(ctx, a, op, fp, id, func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		cur, exists, err := currentBookmark(ctx, q, a.UserID, recordingID, id)
		if err != nil {
			return nil, nil, err
		}
		var revision int64
		if exists {
			revision = cur.Revision
		}
		reason := ""
		switch {
		case base != revision && exists && cur.Deleted:
			reason = "deleted"
		case base != revision:
			reason = "stale_revision"
		// Renaming a bookmark keeps its place, even one that is no longer available.
		case exists && !cur.Deleted && cur.FileID == anchor.file && cur.ContentVersion == anchor.version && cur.LayoutRevision == anchor.layout && cur.OffsetMs == w.Data.OffsetMs:
		default:
			if reason, err = t.checkAnchor(anchor, w.Data.OffsetMs); err != nil {
				return nil, nil, err
			}
		}
		if reason != "" {
			d, err := keepBookmarkCandidate(ctx, q, a, recordingID, id, op, reason, &w.Data, base, revision)
			return nil, d, err
		}
		if err := storeBookmark(ctx, q, a.UserID, recordingID, id, exists, anchor, w.Data); err != nil {
			return nil, nil, err
		}
		return s.bookmarkBody(ctx, q, t, a.UserID, id)
	})
}

// DeleteBookmark leaves a tombstone.
func (s *Service) DeleteBookmark(ctx context.Context, a Actor, recordingID, id uuid.UUID, w wire.RevisionedDelete) (wire.AudioBookmark, error) {
	op, base, err := bookmarkWriteHead(w.OperationID, w.BaseRevision, w.CapturedAt)
	if err != nil {
		return wire.AudioBookmark{}, err
	}
	t, err := s.bookmarkTarget(ctx, a.UserID, recordingID)
	if err != nil {
		return wire.AudioBookmark{}, err
	}
	if err := t.writable(); err != nil {
		return wire.AudioBookmark{}, err
	}
	fp := fingerprint(http.MethodDelete, "/recordings/"+recordingID.String()+"/bookmarks/"+id.String(), w)
	return s.runBookmark(ctx, a, op, fp, id, func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		cur, exists, err := currentBookmark(ctx, q, a.UserID, recordingID, id)
		if err != nil {
			return nil, nil, err
		}
		if !exists {
			return nil, nil, apperr.ErrNotFound
		}
		if base != cur.Revision {
			reason := "stale_revision"
			if cur.Deleted {
				reason = "deleted"
			}
			d, err := keepBookmarkCandidate(ctx, q, a, recordingID, id, op, reason, nil, base, cur.Revision)
			return nil, d, err
		}
		if !cur.Deleted {
			if err := q.DeleteAudioBookmark(ctx, sqlcgen.DeleteAudioBookmarkParams{UserID: a.UserID, ID: id}); err != nil {
				return nil, nil, err
			}
		}
		return s.bookmarkBody(ctx, q, t, a.UserID, id)
	})
}

// BookmarkConflicts lists the caller's unresolved bookmark writes on one recording.
func (s *Service) BookmarkConflicts(ctx context.Context, userID, recordingID uuid.UUID) (wire.AudioBookmarkConflicts, error) {
	if _, err := s.cat.Authorize(ctx, userID, recordingID); err != nil {
		return wire.AudioBookmarkConflicts{}, err
	}
	rows, err := s.q.ListAudioBookmarkConflicts(ctx, sqlcgen.ListAudioBookmarkConflictsParams{UserID: userID, RecordingID: recordingID})
	if err != nil {
		return wire.AudioBookmarkConflicts{}, dbErr(err)
	}
	out := wire.AudioBookmarkConflicts{Items: []wire.AudioBookmarkConflict{}}
	for _, c := range rows {
		item := wire.AudioBookmarkConflict{ID: c.ID.String(), BookmarkID: c.BookmarkID.String(), Reason: c.Reason,
			BaseRevision: strconv.FormatInt(c.BaseRevision, 10), CurrentRevision: strconv.FormatInt(c.CurrentRevision, 10), CreatedAt: rfc(c.CreatedAt)}
		if len(c.Candidate) > 0 {
			var d wire.AudioBookmarkData
			if err := json.Unmarshal(c.Candidate, &d); err != nil {
				return out, dbErr(err)
			}
			item.Candidate = wire.Nullable[wire.AudioBookmarkData]{Value: &d}
		}
		out.Items = append(out.Items, item)
	}
	return out, nil
}

// ResolveBookmarkConflict applies the owner's choice. A choice made against an outdated revision, or a candidate whose
// place no longer exists, is refused and the conflict stays.
func (s *Service) ResolveBookmarkConflict(ctx context.Context, a Actor, recordingID, conflictID uuid.UUID, w wire.AudioBookmarkResolve) error {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return err
	}
	t, err := s.bookmarkTarget(ctx, a.UserID, recordingID)
	if err != nil {
		return err
	}
	if w.Choice == "use_candidate" {
		if err := t.writable(); err != nil {
			return err
		}
	}
	c, err := s.q.GetAudioBookmarkConflict(ctx, sqlcgen.GetAudioBookmarkConflictParams{ID: conflictID, UserID: a.UserID, RecordingID: recordingID})
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.ErrNotFound
	}
	if err != nil {
		return dbErr(err)
	}
	fp := fingerprint(http.MethodPost, "/recordings/"+recordingID.String()+"/bookmark-conflicts/"+conflictID.String()+"/resolve", w)
	_, err = s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error {
		return q.LockPersonalKey(ctx, bookmarkKey(a.UserID, c.BookmarkID))
	}, func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		fresh, err := q.GetAudioBookmarkConflict(ctx, sqlcgen.GetAudioBookmarkConflictParams{ID: conflictID, UserID: a.UserID, RecordingID: recordingID})
		if err != nil {
			return nil, nil, err
		}
		if fresh.ResolvedAt != nil {
			return nil, nil, apperr.New(http.StatusConflict, "already_resolved", "This conflict was already resolved.")
		}
		cur, exists, err := currentBookmark(ctx, q, a.UserID, recordingID, fresh.BookmarkID)
		if err != nil {
			return nil, nil, err
		}
		var revision int64
		if exists {
			revision = cur.Revision
		}
		if base != revision {
			return nil, nil, apperr.New(http.StatusConflict, "stale_revision", "The bookmark changed again; look at it and choose again.").
				With("currentRevision", strconv.FormatInt(revision, 10))
		}
		if w.Choice == "use_candidate" {
			if len(fresh.Candidate) == 0 {
				if exists && !cur.Deleted {
					if err := q.DeleteAudioBookmark(ctx, sqlcgen.DeleteAudioBookmarkParams{UserID: a.UserID, ID: fresh.BookmarkID}); err != nil {
						return nil, nil, err
					}
				}
			} else {
				var d wire.AudioBookmarkData
				if err := json.Unmarshal(fresh.Candidate, &d); err != nil {
					return nil, nil, err
				}
				anchor, err := parseBookmarkAnchor(d)
				if err != nil {
					return nil, nil, err
				}
				reason, err := t.checkAnchor(anchor, d.OffsetMs)
				if err != nil {
					return nil, nil, err
				}
				if reason != "" {
					return nil, nil, apperr.New(http.StatusPreconditionFailed, reason, "The saved place no longer exists in this recording; keep the current bookmark instead.")
				}
				if err := storeBookmark(ctx, q, a.UserID, recordingID, fresh.BookmarkID, exists, anchor, d); err != nil {
					return nil, nil, err
				}
			}
		}
		if err := q.ResolveAudioBookmarkConflict(ctx, sqlcgen.ResolveAudioBookmarkConflictParams{ID: conflictID, ResolvedOperationID: uuid.NullUUID{UUID: op, Valid: true}}); err != nil {
			return nil, nil, err
		}
		return []byte("{}"), nil, nil
	})
	return err
}

func bookmarkWriteHead(operation, revision, captured string) (uuid.UUID, int64, error) {
	op, err := parseUUID("operationId", operation)
	if err != nil {
		return op, 0, err
	}
	base, err := parseRev(revision)
	if err != nil {
		return op, 0, err
	}
	_, err = parseTime("capturedAt", captured)
	return op, base, err
}

func (s *Service) runBookmark(ctx context.Context, a Actor, op uuid.UUID, fp []byte, id uuid.UUID, w work) (wire.AudioBookmark, error) {
	body, err := s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error { return q.LockPersonalKey(ctx, bookmarkKey(a.UserID, id)) }, w)
	if err != nil {
		return wire.AudioBookmark{}, err
	}
	var out wire.AudioBookmark
	return out, json.Unmarshal(body, &out)
}

func (s *Service) bookmarkBody(ctx context.Context, q *sqlcgen.Queries, t bookmarkTarget, userID, id uuid.UUID) ([]byte, *apperr.Error, error) {
	row, err := q.GetAudioBookmark(ctx, sqlcgen.GetAudioBookmarkParams{UserID: userID, ID: id})
	if err != nil {
		return nil, nil, err
	}
	return wire.Raw(t.wire(row)), nil, nil
}

func storeBookmark(ctx context.Context, q *sqlcgen.Queries, userID, recording, id uuid.UUID, exists bool, a bookmarkAnchor, d wire.AudioBookmarkData) error {
	if exists {
		return q.UpdateAudioBookmark(ctx, sqlcgen.UpdateAudioBookmarkParams{UserID: userID, ID: id, FileID: a.file, ContentVersion: a.version,
			OffsetMs: d.OffsetMs, LayoutRevision: a.layout, Note: d.Note})
	}
	return q.InsertAudioBookmark(ctx, sqlcgen.InsertAudioBookmarkParams{UserID: userID, ID: id, RecordingID: recording, FileID: a.file,
		ContentVersion: a.version, OffsetMs: d.OffsetMs, LayoutRevision: a.layout, Note: d.Note})
}
