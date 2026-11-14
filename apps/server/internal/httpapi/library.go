package httpapi

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type libraryPath struct {
	LibraryID string `path:"libraryId" format:"uuid"`
}

// registerLibraries mounts the T004 library-management routes (contracts/t004).
// Every route needs an administrator AND an explicit grant on the library
// (ADR-0056); creating a library grants nobody access.
func (a *API) registerLibraries(api huma.API) {
	cl := adminOp(op("createLibrary", http.MethodPost, "/admin/libraries", "Create a library with its ingestion configuration", "libraries"))
	cl.Security, cl.DefaultStatus = secured, http.StatusCreated
	huma.Register(api, cl, func(ctx context.Context, in *struct{ Body wire.CreateLibrary }) (*bodyOut[wire.LibraryDetail], error) {
		d, err := a.Library.Create(ctx, in.Body)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.LibraryDetail]{Body: d}, nil
	})

	gl := adminOp(op("getLibraryAdmin", http.MethodGet, "/admin/libraries/{libraryId}", "Read library configuration and root health", "libraries"))
	huma.Register(api, gl, func(ctx context.Context, in *libraryPath) (*bodyOut[wire.LibraryDetail], error) {
		id := mustUUID(in.LibraryID)
		p := principal(ctx)
		if err := a.Library.Authorize(ctx, p.UserID, p.IsAdmin, id); err != nil {
			return nil, a.fail(ctx, err)
		}
		d, err := a.Library.Get(ctx, id)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.LibraryDetail]{Body: d}, nil
	})

	pl := adminOp(op("putLibraryConfig", http.MethodPut, "/admin/libraries/{libraryId}/config", "Replace library configuration", "libraries"))
	pl.Security = secured
	huma.Register(api, pl, func(ctx context.Context, in *struct {
		LibraryID string `path:"libraryId" format:"uuid"`
		Body      wire.LibraryConfig
	}) (*bodyOut[wire.LibraryDetail], error) {
		id := mustUUID(in.LibraryID)
		p := principal(ctx)
		if err := a.Library.Authorize(ctx, p.UserID, p.IsAdmin, id); err != nil {
			return nil, a.fail(ctx, err)
		}
		d, err := a.Library.Put(ctx, id, in.Body)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.LibraryDetail]{Body: d}, nil
	})
}
