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
		"Authors of the titles visible through granted libraries, by last name unless sorted by first name", "catalog")),
		func(ctx context.Context, in *struct {
			DirectoryQuery
			PageQuery
			Sort   string `query:"sort" enum:"last,first" doc:"last (default) sorts by last name; first sorts by the name as written."`
			Letter string `query:"letter" pattern:"^[A-Z]$" doc:"Only authors filed under this letter of the sorted name."`
		}) (*bodyOut[wire.DirectoryAuthors], error) {
			page, size := in.normalized()
			out, err := a.Catalog.Authors(ctx, principal(ctx).UserID, in.Q, in.Sort, in.Letter, page, size)
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
			Sort string `query:"sort" enum:"name,titles" doc:"name (default), or titles for the most titles first."`
		}) (*bodyOut[wire.DirectorySeriesPage], error) {
			page, size := in.normalized()
			out, err := a.Catalog.Series(ctx, principal(ctx).UserID, in.Q, in.Sort, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.DirectorySeriesPage]{Body: out}, nil
		})

	a.registerDirectoryDetails(api)
	a.registerDirectoryOnline(api)

	huma.Register(api, readOp(op("getContinueReading", http.MethodGet, "/continue-reading",
		"The title to continue for an author or a series: the unfinished one used most recently, else the first unread", "catalog")),
		func(ctx context.Context, in *struct {
			By   string `query:"by" enum:"author,series" required:"true"`
			Name string `query:"name" minLength:"1" maxLength:"512" required:"true"`
		}) (*bodyOut[wire.ContinueReading], error) {
			out, err := a.Catalog.ContinueReading(ctx, principal(ctx).UserID, in.By, in.Name)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.ContinueReading]{Body: out}, nil
		})
}
