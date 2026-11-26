package httpapi

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// DirectoryQuery searches a directory by name.
type DirectoryQuery struct {
	Q string `query:"q" maxLength:"200" doc:"Case-insensitive text in the name."`
}

// The author and series directories (ADR-0100). The author and series pages themselves use the title search with an
// "author is" or "series is" filter.
func (a *API) registerDirectories(api huma.API) {
	huma.Register(api, readOp(op("listAuthors", http.MethodGet, "/authors",
		"Authors of the titles visible through granted libraries, by name ignoring case", "catalog")),
		func(ctx context.Context, in *struct {
			DirectoryQuery
			PageQuery
		}) (*bodyOut[wire.DirectoryAuthors], error) {
			page, size := in.normalized()
			out, err := a.Catalog.Authors(ctx, principal(ctx).UserID, in.Q, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.DirectoryAuthors]{Body: out}, nil
		})

	huma.Register(api, readOp(op("listSeries", http.MethodGet, "/series",
		"Series of the titles visible through granted libraries, by name ignoring case", "catalog")),
		func(ctx context.Context, in *struct {
			DirectoryQuery
			PageQuery
		}) (*bodyOut[wire.DirectorySeriesPage], error) {
			page, size := in.normalized()
			out, err := a.Catalog.Series(ctx, principal(ctx).UserID, in.Q, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.DirectorySeriesPage]{Body: out}, nil
		})
}
