package httpapi

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// manageEdition requires administrator status AND a grant on the edition library.
func (a *API) manageEdition(ctx context.Context, id string) error {
	lib, err := a.Reading.EditionLibrary(ctx, mustUUID(id))
	if err != nil {
		return a.fail(ctx, err)
	}
	return a.manage(ctx, lib)
}

type MetadataFieldIn struct {
	EditionID string `path:"editionId" format:"uuid"`
	Field     string `path:"field" enum:"title,authors,series_name,series_index,language,tags,publisher,published,page_count,isbn,description"`
}

func (a *API) registerEditionAdmin(api huma.API) {
	huma.Register(api, writeOp(op("linkEditionTitle", http.MethodPut, "/admin/editions/{editionId}/title", "Link an edition to a title or separate it", "editions")),
		func(ctx context.Context, in *struct {
			EditionIn
			Body wire.T005EditionLink
		}) (*bodyOut[wire.T005Edition], error) {
			if err := a.manageEdition(ctx, in.EditionID); err != nil {
				return nil, err
			}
			out, err := a.Reading.LinkEditionTitle(ctx, a.readingActor(ctx), mustUUID(in.EditionID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Edition]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getEditionMetadata", http.MethodGet, "/admin/editions/{editionId}/metadata", "Effective edition metadata with provenance", "editions")),
		func(ctx context.Context, in *EditionIn) (*bodyOut[wire.T005MetadataReport], error) {
			if err := a.manageEdition(ctx, in.EditionID); err != nil {
				return nil, err
			}
			out, err := a.Reading.MetadataReport(ctx, mustUUID(in.EditionID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005MetadataReport]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("setEditionMetadata", http.MethodPut, "/admin/editions/{editionId}/metadata/{field}", "Set a protected edit or protected clear", "editions")),
		func(ctx context.Context, in *struct {
			MetadataFieldIn
			Body wire.T005MetadataWrite
		}) (*bodyOut[wire.T005MetadataReport], error) {
			if err := a.manageEdition(ctx, in.EditionID); err != nil {
				return nil, err
			}
			out, err := a.Reading.SetEditionMetadata(ctx, a.readingActor(ctx), mustUUID(in.EditionID), in.Field, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005MetadataReport]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("removeEditionMetadata", http.MethodDelete, "/admin/editions/{editionId}/metadata/{field}", "Remove a protected override", "editions")),
		func(ctx context.Context, in *struct {
			MetadataFieldIn
			Body wire.T005MetadataRemove
		}) (*bodyOut[wire.T005MetadataReport], error) {
			if err := a.manageEdition(ctx, in.EditionID); err != nil {
				return nil, err
			}
			out, err := a.Reading.RemoveEditionMetadata(ctx, a.readingActor(ctx), mustUUID(in.EditionID), in.Field, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005MetadataReport]{Body: out}, nil
		})
}
