package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/catalog"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
	"golang.org/x/text/unicode/norm"
)

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func uuidPtr(s string) *uuid.UUID {
	if s == "" {
		return nil
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return nil
	}
	return &id
}

// literalQuery normalizes a text-search query: NFC, trimmed, bounded. Matching
// is a case-insensitive literal substring in SQL (never a pattern or regexp).
func literalQuery(q string) (*string, error) {
	q = strings.TrimSpace(norm.NFC.String(q))
	if q == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(q) > 256 {
		return nil, apperr.New(http.StatusUnprocessableEntity, "validation_failed", "q must be at most 256 characters.")
	}
	return &q, nil
}

type TitleIn struct {
	TitleID string `path:"titleId" format:"uuid"`
}

type EditionIn struct {
	EditionID string `path:"editionId" format:"uuid"`
}

func (a *API) registerEditions(api huma.API) {
	huma.Register(api, readOp(op("listTitles", http.MethodGet, "/titles", "Titles visible through granted libraries", "catalog")),
		func(ctx context.Context, in *struct {
			PageQuery
			LibraryID string `query:"libraryId" format:"uuid"`
			Q         string `query:"q" maxLength:"512"`
			MediaKind string `query:"mediaKind" enum:"ebook,audio"`
		}) (*bodyOut[wire.T005Titles], error) {
			q, err := literalQuery(in.Q)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			page, size := in.normalized()
			out, err := a.Catalog.Titles(ctx, principal(ctx).UserID, catalog.TitleListParams{Q: q, LibraryID: uuidPtr(in.LibraryID), MediaKind: strPtr(in.MediaKind), Page: page, Size: size})
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Titles]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getTitle", http.MethodGet, "/titles/{titleId}", "One title", "catalog")),
		func(ctx context.Context, in *TitleIn) (*bodyOut[wire.T005TitleDetail], error) {
			out, err := a.Catalog.Title(ctx, principal(ctx).UserID, mustUUID(in.TitleID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005TitleDetail]{Body: out}, nil
		})

	huma.Register(api, readOp(op("listTitleRecordings", http.MethodGet, "/titles/{titleId}/recordings", "Recordings of a title in granted libraries", "catalog")),
		func(ctx context.Context, in *struct {
			TitleIn
			PageQuery
		}) (*bodyOut[wire.T005RecordingLinks], error) {
			page, size := in.normalized()
			out, err := a.Catalog.TitleRecordings(ctx, principal(ctx).UserID, mustUUID(in.TitleID), page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005RecordingLinks]{Body: out}, nil
		})

	huma.Register(api, readOp(op("listEditions", http.MethodGet, "/editions", "Ebook and comic editions in granted libraries", "catalog")),
		func(ctx context.Context, in *struct {
			PageQuery
			LibraryID string `query:"libraryId" format:"uuid"`
			TitleID   string `query:"titleId" format:"uuid"`
		}) (*bodyOut[wire.T005Editions], error) {
			page, size := in.normalized()
			out, err := a.Catalog.Editions(ctx, principal(ctx).UserID, catalog.EditionListParams{
				LibraryID: uuidPtr(in.LibraryID), TitleID: uuidPtr(in.TitleID), Page: page, Size: size})
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Editions]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getEdition", http.MethodGet, "/editions/{editionId}", "One edition", "catalog")),
		func(ctx context.Context, in *EditionIn) (*bodyOut[wire.T005Edition], error) {
			out, err := a.Catalog.Edition(ctx, principal(ctx).UserID, mustUUID(in.EditionID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Edition]{Body: out}, nil
		})

	huma.Register(api, readOp(op("getReaderSnapshot", http.MethodGet, "/editions/{editionId}/reader", "Self-contained reader snapshot", "catalog")),
		func(ctx context.Context, in *EditionIn) (*bodyOut[wire.T005Reader], error) {
			out, err := a.Catalog.Reader(ctx, principal(ctx).UserID, mustUUID(in.EditionID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T005Reader]{Body: out}, nil
		})
}

// readOp declares the T005 read-route security: bearer, or the browser session cookie.
func readOp(o huma.Operation) huma.Operation {
	o.Security = []map[string][]string{{"browserSession": {}}, {"bearer": {}}}
	// T005 routes document the T005Problem error body (a superset of Problem).
	o.Errors = nil
	o.Responses = map[string]*huma.Response{}
	for _, code := range stdErrors {
		o.Responses[strconv.Itoa(code)] = &huma.Response{Description: "Typed error",
			Content: map[string]*huma.MediaType{"application/problem+json": {Schema: &huma.Schema{Ref: "#/components/schemas/T005Problem"}}}}
	}
	return o
}
