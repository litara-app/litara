package httpapi

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type RecordingBookmarkIn struct {
	RecordingID string `path:"recordingId" format:"uuid"`
	BookmarkID  string `path:"bookmarkId" format:"uuid"`
}

// registerListening adds audiobook listening sessions (ADR-0109) and bookmarks (ADR-0110).
func (a *API) registerListening(api huma.API) {
	huma.Register(api, writeOp(op("putListeningSession", http.MethodPut, "/recordings/{recordingId}/listening-sessions/{sessionId}", "Record or extend one listening session", "reading")),
		func(ctx context.Context, in *struct {
			RecordingID string `path:"recordingId" format:"uuid"`
			SessionID   string `path:"sessionId" format:"uuid"`
			Body        wire.ListeningSessionWrite
		}) (*struct{}, error) {
			if err := a.Reading.PutListeningSession(ctx, principal(ctx).UserID, mustUUID(in.RecordingID), mustUUID(in.SessionID), in.Body); err != nil {
				return nil, a.fail(ctx, err)
			}
			return &struct{}{}, nil
		})

	huma.Register(api, readOp(op("listListeningSessions", http.MethodGet, "/titles/{titleId}/listening-sessions", "The caller's own listening sessions for a title", "reading")),
		func(ctx context.Context, in *struct {
			TitleIn
			PageQuery
		}) (*bodyOut[wire.ListeningSessions], error) {
			page, size := in.normalized()
			s, err := a.Reading.ListeningSessions(ctx, principal(ctx).UserID, mustUUID(in.TitleID), page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.ListeningSessions]{Body: s}, nil
		})

	huma.Register(api, readOp(op("listAudioBookmarks", http.MethodGet, "/recordings/{recordingId}/bookmarks", "The caller's own bookmarks on a recording", "reading")),
		func(ctx context.Context, in *struct {
			RecordingID string `path:"recordingId" format:"uuid"`
			PageQuery
			IncludeDeleted bool `query:"includeDeleted" default:"false"`
		}) (*bodyOut[wire.AudioBookmarks], error) {
			page, size := in.normalized()
			list, err := a.Reading.Bookmarks(ctx, principal(ctx).UserID, mustUUID(in.RecordingID), in.IncludeDeleted, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.AudioBookmarks]{Body: list}, nil
		})

	huma.Register(api, readOp(op("getAudioBookmark", http.MethodGet, "/recordings/{recordingId}/bookmarks/{bookmarkId}", "One audiobook bookmark", "reading")),
		func(ctx context.Context, in *RecordingBookmarkIn) (*bodyOut[wire.AudioBookmark], error) {
			b, err := a.Reading.Bookmark(ctx, principal(ctx).UserID, mustUUID(in.RecordingID), mustUUID(in.BookmarkID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.AudioBookmark]{Body: b}, nil
		})

	huma.Register(api, writeOp(op("putAudioBookmark", http.MethodPut, "/recordings/{recordingId}/bookmarks/{bookmarkId}", "Create or change an audiobook bookmark", "reading")),
		func(ctx context.Context, in *struct {
			RecordingBookmarkIn
			Body wire.AudioBookmarkWrite
		}) (*bodyOut[wire.AudioBookmark], error) {
			b, err := a.Reading.PutBookmark(ctx, a.readingActor(ctx), mustUUID(in.RecordingID), mustUUID(in.BookmarkID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.AudioBookmark]{Body: b}, nil
		})

	huma.Register(api, writeOp(op("deleteAudioBookmark", http.MethodDelete, "/recordings/{recordingId}/bookmarks/{bookmarkId}", "Delete an audiobook bookmark", "reading")),
		func(ctx context.Context, in *struct {
			RecordingBookmarkIn
			Body wire.RevisionedDelete
		}) (*bodyOut[wire.AudioBookmark], error) {
			b, err := a.Reading.DeleteBookmark(ctx, a.readingActor(ctx), mustUUID(in.RecordingID), mustUUID(in.BookmarkID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.AudioBookmark]{Body: b}, nil
		})

	huma.Register(api, readOp(op("listAudioBookmarkConflicts", http.MethodGet, "/recordings/{recordingId}/bookmark-conflicts", "Bookmark changes that wait for the caller's choice", "reading")),
		func(ctx context.Context, in *struct {
			RecordingID string `path:"recordingId" format:"uuid"`
		}) (*bodyOut[wire.AudioBookmarkConflicts], error) {
			list, err := a.Reading.BookmarkConflicts(ctx, principal(ctx).UserID, mustUUID(in.RecordingID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.AudioBookmarkConflicts]{Body: list}, nil
		})

	huma.Register(api, writeOp(op("resolveAudioBookmarkConflict", http.MethodPost, "/recordings/{recordingId}/bookmark-conflicts/{conflictId}/resolve", "Keep the current bookmark or apply the saved change", "reading")),
		func(ctx context.Context, in *struct {
			RecordingID string `path:"recordingId" format:"uuid"`
			ConflictID  string `path:"conflictId" format:"uuid"`
			Body        wire.AudioBookmarkResolve
		}) (*struct{}, error) {
			if err := a.Reading.ResolveBookmarkConflict(ctx, a.readingActor(ctx), mustUUID(in.RecordingID), mustUUID(in.ConflictID), in.Body); err != nil {
				return nil, a.fail(ctx, err)
			}
			return &struct{}{}, nil
		})
}
