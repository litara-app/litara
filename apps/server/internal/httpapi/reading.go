package httpapi

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/reading"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// writeOp is readOp plus the browser CSRF requirement for unsafe methods.
func writeOp(o huma.Operation) huma.Operation {
	o = readOp(o)
	o.Security = []map[string][]string{{"browserSession": {}, "csrf": {}}, {"bearer": {}}}
	return o
}

func (a *API) readingActor(ctx context.Context) reading.Actor {
	p := principal(ctx)
	return reading.Actor{UserID: p.UserID, SessionID: p.SessionID, DeviceName: p.DeviceName}
}

func (a *API) registerReading(api huma.API) {
	huma.Register(api, readOp(op("getReadingPosition", http.MethodGet, "/editions/{editionId}/position", "Current reading position state", "reading")),
		func(ctx context.Context, in *EditionIn) (*bodyOut[wire.T005PositionState], error) {
			st, err := a.Reading.GetPosition(ctx, principal(ctx).UserID, mustUUID(in.EditionID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005PositionState]{Body: st}, nil
		})

	huma.Register(api, writeOp(op("writeReadingPosition", http.MethodPut, "/editions/{editionId}/position", "Write the reading position", "reading")),
		func(ctx context.Context, in *struct {
			EditionIn
			Body wire.T005PositionWrite
		}) (*bodyOut[wire.T005PositionState], error) {
			st, err := a.Reading.WritePosition(ctx, a.readingActor(ctx), mustUUID(in.EditionID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005PositionState]{Body: st}, nil
		})

	huma.Register(api, readOp(op("getReadingCompletion", http.MethodGet, "/editions/{editionId}/completion", "Current completion state", "reading")),
		func(ctx context.Context, in *EditionIn) (*bodyOut[wire.T005Completion], error) {
			st, err := a.Reading.GetCompletion(ctx, principal(ctx).UserID, mustUUID(in.EditionID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Completion]{Body: st}, nil
		})

	huma.Register(api, writeOp(op("writeReadingCompletion", http.MethodPut, "/editions/{editionId}/completion", "Manually finish or unfinish an edition", "reading")),
		func(ctx context.Context, in *struct {
			EditionIn
			Body wire.T005CompletionWrite
		}) (*bodyOut[wire.T005Completion], error) {
			st, err := a.Reading.WriteCompletion(ctx, a.readingActor(ctx), mustUUID(in.EditionID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Completion]{Body: st}, nil
		})

	huma.Register(api, readOp(op("getReadingHistory", http.MethodGet, "/titles/{titleId}/reading-history", "Ebook completion history for a title", "reading")),
		func(ctx context.Context, in *struct {
			TitleIn
			PageQuery
		}) (*bodyOut[wire.T005History], error) {
			page, size := in.normalized()
			h, err := a.Reading.History(ctx, principal(ctx).UserID, mustUUID(in.TitleID), page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005History]{Body: h}, nil
		})

	huma.Register(api, readOp(op("listPersonalConflicts", http.MethodGet, "/personal-conflicts", "The caller own unresolved personal-state conflicts", "reading")),
		func(ctx context.Context, in *struct {
			PageQuery
			ResourceID      string `query:"resourceId" format:"uuid"`
			IncludeResolved bool   `query:"includeResolved" default:"false"`
		}) (*bodyOut[wire.T005Conflicts], error) {
			page, size := in.normalized()
			var rid *uuid.UUID
			if in.ResourceID != "" {
				id := mustUUID(in.ResourceID)
				rid = &id
			}
			c, err := a.Reading.Conflicts(ctx, principal(ctx).UserID, rid, in.IncludeResolved, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Conflicts]{Body: c}, nil
		})

	huma.Register(api, writeOp(op("resolvePersonalConflict", http.MethodPost, "/personal-conflicts/{conflictId}/resolve", "Resolve a personal-state conflict", "reading")),
		func(ctx context.Context, in *struct {
			ConflictID string `path:"conflictId" format:"uuid"`
			Body       wire.T005Resolve
		}) (*bodyOut[wire.T005Resolved], error) {
			r, err := a.Reading.Resolve(ctx, a.readingActor(ctx), mustUUID(in.ConflictID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Resolved]{Body: r}, nil
		})
}
