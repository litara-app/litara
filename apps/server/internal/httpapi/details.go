package httpapi

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Descriptive book details and personal title state (ADR-0081).
func (a *API) registerDetails(api huma.API) {
	huma.Register(api, readOp(op("getEditionDetails", http.MethodGet, "/editions/{editionId}/details", "Effective publisher, published date, page count, ISBN, synopsis and added time", "editions")),
		func(ctx context.Context, in *EditionIn) (*bodyOut[wire.EditionDetails], error) {
			out, err := a.Reading.EditionDetails(ctx, principal(ctx).UserID, mustUUID(in.EditionID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.EditionDetails]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getRecordingDetails", http.MethodGet, "/recordings/{recordingId}/details", "Effective publisher, published date, ISBN, synopsis and added time of a recording", "recordings")),
		func(ctx context.Context, in *struct {
			RecordingID string `path:"recordingId" format:"uuid"`
		}) (*bodyOut[wire.RecordingDetails], error) {
			out, err := a.Reading.RecordingDetails(ctx, principal(ctx).UserID, mustUUID(in.RecordingID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.RecordingDetails]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getTitlePersonal", http.MethodGet, "/titles/{titleId}/personal", "The caller private rating, review and reading dates for a title", "titles")),
		func(ctx context.Context, in *TitleIn) (*bodyOut[wire.TitlePersonal], error) {
			out, err := a.Reading.TitlePersonal(ctx, principal(ctx).UserID, mustUUID(in.TitleID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.TitlePersonal]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("putTitlePersonal", http.MethodPut, "/titles/{titleId}/personal", "Set the caller private rating, review and reading-date overrides", "titles")),
		func(ctx context.Context, in *struct {
			TitleIn
			Body wire.TitlePersonalWrite
		}) (*bodyOut[wire.TitlePersonal], error) {
			out, err := a.Reading.PutTitlePersonal(ctx, a.readingActor(ctx), mustUUID(in.TitleID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.TitlePersonal]{Body: out}, nil
		})
}
