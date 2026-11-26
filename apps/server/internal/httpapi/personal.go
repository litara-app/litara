package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/reading"
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
		}) (*bodyOut[wire.Annotations], error) {
			page, size := in.normalized()
			out, err := a.Reading.ListAnnotations(ctx, principal(ctx).UserID, mustUUID(in.EditionID), in.IncludeDeleted, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Annotations]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getAnnotation", http.MethodGet, "/editions/{editionId}/annotations/{annotationId}", "One private annotation", "annotations")),
		func(ctx context.Context, in *AnnotationIn) (*bodyOut[wire.Annotation], error) {
			out, err := a.Reading.GetAnnotation(ctx, principal(ctx).UserID, mustUUID(in.EditionID), mustUUID(in.AnnotationID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Annotation]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("putAnnotation", http.MethodPut, "/editions/{editionId}/annotations/{annotationId}", "Create or update a private annotation", "annotations")),
		func(ctx context.Context, in *struct {
			AnnotationIn
			Body wire.AnnotationWrite
		}) (*bodyOut[wire.Annotation], error) {
			out, err := a.Reading.PutAnnotation(ctx, a.readingActor(ctx), mustUUID(in.EditionID), mustUUID(in.AnnotationID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Annotation]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("deleteAnnotation", http.MethodDelete, "/editions/{editionId}/annotations/{annotationId}", "Delete a private annotation (tombstone)", "annotations")),
		func(ctx context.Context, in *struct {
			AnnotationIn
			Body wire.RevisionedDelete
		}) (*bodyOut[wire.Annotation], error) {
			out, err := a.Reading.DeleteAnnotation(ctx, a.readingActor(ctx), mustUUID(in.EditionID), mustUUID(in.AnnotationID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Annotation]{Body: out}, nil
		})
}

// HubQuery narrows the annotations hub (ADR-0099).
type HubQuery struct {
	Q       string `query:"q" maxLength:"200" doc:"Case-insensitive text in the note, the quote, the book title or an author."`
	Kind    string `query:"kind" enum:"highlight,note,bookmark" doc:"Only this kind; omitted for every kind."`
	TitleID string `query:"titleId" format:"uuid" doc:"Only annotations on this title."`
}

func (q HubQuery) filter() reading.HubFilter {
	f := reading.HubFilter{Query: q.Q, Kind: q.Kind}
	if q.TitleID != "" {
		f.TitleID = mustUUID(q.TitleID)
	}
	return f
}

func (a *API) registerAnnotationHub(api huma.API) {
	huma.Register(api, readOp(op("listAllAnnotations", http.MethodGet, "/annotations",
		"The caller private live annotations across every edition they can see, newest change first", "annotations")),
		func(ctx context.Context, in *struct {
			HubQuery
			PageQuery
		}) (*bodyOut[wire.AnnotationHub], error) {
			page, size := in.normalized()
			out, err := a.Reading.Hub(ctx, principal(ctx).UserID, in.filter(), page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.AnnotationHub]{Body: out}, nil
		})

	huma.Register(api, readOp(op("listAnnotatedTitles", http.MethodGet, "/annotations/titles",
		"The titles the caller has live annotations on, with counts", "annotations")),
		func(ctx context.Context, _ *struct{}) (*bodyOut[wire.AnnotationHubTitles], error) {
			out, err := a.Reading.HubTitles(ctx, principal(ctx).UserID)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.AnnotationHubTitles]{Body: out}, nil
		})

	exp := readOp(op("exportAnnotations", http.MethodGet, "/annotations/export",
		"Download the caller annotations matching the filters as Markdown, CSV or JSON", "annotations"))
	exp.Responses["200"] = &huma.Response{Description: "The export file, as an attachment",
		Headers: map[string]*huma.Param{"Content-Disposition": {Schema: &huma.Schema{Type: "string"}}},
		Content: map[string]*huma.MediaType{
			"text/markdown":    {Schema: &huma.Schema{Type: "string"}},
			"text/csv":         {Schema: &huma.Schema{Type: "string"}},
			"application/json": {Schema: &huma.Schema{Type: "object"}},
		}}
	huma.Register(api, exp, func(ctx context.Context, in *struct {
		HubQuery
		Format string `query:"format" enum:"markdown,csv,json" required:"true"`
	}) (*huma.StreamResponse, error) {
		out, err := a.Reading.ExportHub(ctx, principal(ctx).UserID, in.filter(), in.Format)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &huma.StreamResponse{Body: func(hc huma.Context) {
			hc.SetHeader("Content-Type", out.ContentType)
			hc.SetHeader("Content-Disposition", contentDisposition(out.Filename))
			hc.SetHeader("Cache-Control", "private, no-store")
			hc.SetHeader("Content-Length", strconv.Itoa(len(out.Body)))
			hc.SetStatus(http.StatusOK)
			_, _ = hc.BodyWriter().Write(out.Body)
		}}, nil
	})
}

func (a *API) registerShelves(api huma.API) {
	huma.Register(api, readOp(op("listShelves", http.MethodGet, "/shelves", "The caller own shelves or shared shelves of others", "shelves")),
		func(ctx context.Context, in *struct {
			PageQuery
			Scope          string `query:"scope" enum:"mine,shared" default:"mine"`
			IncludeDeleted bool   `query:"includeDeleted" default:"false"`
		}) (*bodyOut[wire.Shelves], error) {
			page, size := in.normalized()
			out, err := a.Reading.ListShelves(ctx, principal(ctx).UserID, in.Scope, in.IncludeDeleted, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Shelves]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getShelf", http.MethodGet, "/shelves/{shelfId}", "One shelf", "shelves")),
		func(ctx context.Context, in *ShelfIn) (*bodyOut[wire.Shelf], error) {
			out, err := a.Reading.GetShelf(ctx, principal(ctx).UserID, mustUUID(in.ShelfID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Shelf]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("putShelf", http.MethodPut, "/shelves/{shelfId}", "Create or update an owned shelf", "shelves")),
		func(ctx context.Context, in *struct {
			ShelfIn
			Body wire.ShelfWrite
		}) (*bodyOut[wire.Shelf], error) {
			out, err := a.Reading.PutShelf(ctx, a.readingActor(ctx), mustUUID(in.ShelfID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Shelf]{Body: out}, nil
		})

	huma.Register(api, writeOp(op("deleteShelf", http.MethodDelete, "/shelves/{shelfId}", "Delete an owned shelf (tombstone)", "shelves")),
		func(ctx context.Context, in *struct {
			ShelfIn
			Body wire.RevisionedDelete
		}) (*bodyOut[wire.Shelf], error) {
			out, err := a.Reading.DeleteShelf(ctx, a.readingActor(ctx), mustUUID(in.ShelfID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Shelf]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getShelfTitles", http.MethodGet, "/shelves/{shelfId}/titles", "Titles of a shelf as the viewer sees them", "shelves")),
		func(ctx context.Context, in *struct {
			ShelfIn
			PageQuery
		}) (*bodyOut[wire.Titles], error) {
			page, size := in.normalized()
			out, err := a.Reading.ShelfTitles(ctx, principal(ctx).UserID, mustUUID(in.ShelfID), page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Titles]{Body: out}, nil
		})

	member := func(id, method, action, summary string) {
		huma.Register(api, writeOp(op(id, method, "/shelves/{shelfId}/titles/{titleId}", summary, "shelves")),
			func(ctx context.Context, in *struct {
				ShelfIn
				TitleID string `path:"titleId" format:"uuid"`
				Body    wire.MemberChange
			}) (*bodyOut[wire.Shelf], error) {
				out, err := a.Reading.ChangeMember(ctx, a.readingActor(ctx), mustUUID(in.ShelfID), mustUUID(in.TitleID), action, in.Body)
				if err != nil {
					return nil, a.fail(ctx, err)
				}
				return &bodyOut[wire.Shelf]{Body: out}, nil
			})
	}
	member("addShelfTitle", http.MethodPut, "add", "Append a title to a manual shelf")
	member("removeShelfTitle", http.MethodDelete, "remove", "Remove a title from a manual shelf")

	huma.Register(api, writeOp(op("orderShelfTitles", http.MethodPut, "/shelves/{shelfId}/order", "Reorder the owner visible members of a manual shelf", "shelves")),
		func(ctx context.Context, in *struct {
			ShelfIn
			Body wire.ShelfOrder
		}) (*bodyOut[wire.Shelf], error) {
			out, err := a.Reading.OrderShelfTitles(ctx, a.readingActor(ctx), mustUUID(in.ShelfID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.Shelf]{Body: out}, nil
		})
}
