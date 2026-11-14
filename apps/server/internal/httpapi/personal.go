package httpapi

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// AnnotationIn addresses one private annotation under its edition.
type AnnotationIn struct {
	EditionID    string `path:"editionId" format:"uuid"`
	AnnotationID string `path:"annotationId" format:"uuid"`
}

// ShelfIn addresses one shelf.
type ShelfIn struct {
	ShelfID string `path:"shelfId" format:"uuid"`
}

func (a *API) registerAnnotations(api huma.API) {
	huma.Register(api, readOp(op("listAnnotations", http.MethodGet, "/editions/{editionId}/annotations", "The caller private annotations for an edition", "annotations")),
		func(ctx context.Context, in *struct {
			EditionIn
			PageQuery
			IncludeDeleted bool `query:"includeDeleted" default:"true"`
		}) (*bodyOut[wire.T005Annotations], error) {
			page, size := in.normalized()
			out, err := a.Reading.ListAnnotations(ctx, principal(ctx).UserID, mustUUID(in.EditionID), in.IncludeDeleted, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Annotations]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getAnnotation", http.MethodGet, "/editions/{editionId}/annotations/{annotationId}", "One private annotation", "annotations")),
		func(ctx context.Context, in *AnnotationIn) (*bodyOut[wire.T005Annotation], error) {
			out, err := a.Reading.GetAnnotation(ctx, principal(ctx).UserID, mustUUID(in.EditionID), mustUUID(in.AnnotationID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Annotation]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("putAnnotation", http.MethodPut, "/editions/{editionId}/annotations/{annotationId}", "Create or update a private annotation", "annotations")),
		func(ctx context.Context, in *struct {
			AnnotationIn
			Body wire.T005AnnotationWrite
		}) (*bodyOut[wire.T005Annotation], error) {
			out, err := a.Reading.PutAnnotation(ctx, a.readingActor(ctx), mustUUID(in.EditionID), mustUUID(in.AnnotationID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Annotation]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("deleteAnnotation", http.MethodDelete, "/editions/{editionId}/annotations/{annotationId}", "Delete a private annotation (tombstone)", "annotations")),
		func(ctx context.Context, in *struct {
			AnnotationIn
			Body wire.T005Delete
		}) (*bodyOut[wire.T005Annotation], error) {
			out, err := a.Reading.DeleteAnnotation(ctx, a.readingActor(ctx), mustUUID(in.EditionID), mustUUID(in.AnnotationID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Annotation]{Body: out}, nil
		})
}

func (a *API) registerShelves(api huma.API) {
	huma.Register(api, readOp(op("listShelves", http.MethodGet, "/shelves", "The caller own shelves or shared shelves of others", "shelves")),
		func(ctx context.Context, in *struct {
			PageQuery
			Scope          string `query:"scope" enum:"mine,shared" default:"mine"`
			IncludeDeleted bool   `query:"includeDeleted" default:"false"`
		}) (*bodyOut[wire.T005Shelves], error) {
			page, size := in.normalized()
			out, err := a.Reading.ListShelves(ctx, principal(ctx).UserID, in.Scope, in.IncludeDeleted, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Shelves]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getShelf", http.MethodGet, "/shelves/{shelfId}", "One shelf", "shelves")),
		func(ctx context.Context, in *ShelfIn) (*bodyOut[wire.T005Shelf], error) {
			out, err := a.Reading.GetShelf(ctx, principal(ctx).UserID, mustUUID(in.ShelfID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Shelf]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("putShelf", http.MethodPut, "/shelves/{shelfId}", "Create or update an owned shelf", "shelves")),
		func(ctx context.Context, in *struct {
			ShelfIn
			Body wire.T005ShelfWrite
		}) (*bodyOut[wire.T005Shelf], error) {
			out, err := a.Reading.PutShelf(ctx, a.readingActor(ctx), mustUUID(in.ShelfID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Shelf]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("deleteShelf", http.MethodDelete, "/shelves/{shelfId}", "Delete an owned shelf (tombstone)", "shelves")),
		func(ctx context.Context, in *struct {
			ShelfIn
			Body wire.T005Delete
		}) (*bodyOut[wire.T005Shelf], error) {
			out, err := a.Reading.DeleteShelf(ctx, a.readingActor(ctx), mustUUID(in.ShelfID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Shelf]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getShelfTitles", http.MethodGet, "/shelves/{shelfId}/titles", "Titles of a shelf as the viewer sees them", "shelves")),
		func(ctx context.Context, in *struct {
			ShelfIn
			PageQuery
		}) (*bodyOut[wire.T005Titles], error) {
			page, size := in.normalized()
			out, err := a.Reading.ShelfTitles(ctx, principal(ctx).UserID, mustUUID(in.ShelfID), page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Titles]{Body: out}, nil
		})

	member := func(id, method, action, summary string) {
		huma.Register(api, writeOp(op(id, method, "/shelves/{shelfId}/titles/{titleId}", summary, "shelves")),
			func(ctx context.Context, in *struct {
				ShelfIn
				TitleID string `path:"titleId" format:"uuid"`
				Body    wire.T005MemberChange
			}) (*bodyOut[wire.T005Shelf], error) {
				out, err := a.Reading.ChangeMember(ctx, a.readingActor(ctx), mustUUID(in.ShelfID), mustUUID(in.TitleID), action, in.Body)
				if err != nil {
					return nil, a.fail(ctx, err)
				}
				return &bodyOut[wire.T005Shelf]{Body: out}, nil
			})
	}
	member("addShelfTitle", http.MethodPut, "add", "Append a title to a manual shelf")
	member("removeShelfTitle", http.MethodDelete, "remove", "Remove a title from a manual shelf")

	huma.Register(api, writeOp(op("orderShelfTitles", http.MethodPut, "/shelves/{shelfId}/order", "Reorder the owner visible members of a manual shelf", "shelves")),
		func(ctx context.Context, in *struct {
			ShelfIn
			Body wire.T005ShelfOrder
		}) (*bodyOut[wire.T005Shelf], error) {
			out, err := a.Reading.OrderShelfTitles(ctx, a.readingActor(ctx), mustUUID(in.ShelfID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Shelf]{Body: out}, nil
		})
}
