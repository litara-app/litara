package httpapi

import (
	"context"
	"io"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type ComicFileIn struct {
	FileID         string `path:"fileId" format:"uuid"`
	ContentVersion string `path:"contentVersion" format:"uuid"`
}

type ComicPageIn struct {
	ComicFileIn
	PageIndex int `path:"pageIndex" minimum:"0" maximum:"9999"`
}

func (a *API) registerComics(api huma.API) {
	huma.Register(api, readOp(op("getComicPages", http.MethodGet, "/files/{fileId}/versions/{contentVersion}/pages", "Page manifest for one comic file version", "comics")),
		func(ctx context.Context, in *ComicFileIn) (*bodyOut[wire.ComicPageManifest], error) {
			m, err := a.Reading.ComicManifest(ctx, principal(ctx).UserID, mustUUID(in.FileID), mustUUID(in.ContentVersion))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.ComicPageManifest]{Body: m}, nil
		})

	prep := writeOp(op("prepareComicPages", http.MethodPost, "/files/{fileId}/versions/{contentVersion}/pages", "Request page extraction for one comic file version", "comics"))
	prep.DefaultStatus = http.StatusAccepted
	huma.Register(api, prep, func(ctx context.Context, in *struct {
		ComicFileIn
		Body wire.ComicExtractionRequest
	}) (*bodyOut[wire.ComicPageManifest], error) {
		m, err := a.Reading.PrepareComicPages(ctx, a.readingActor(ctx), mustUUID(in.FileID), mustUUID(in.ContentVersion), in.Body)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.ComicPageManifest]{Body: m}, nil
	})

	for _, method := range []string{http.MethodGet, http.MethodHead} {
		method := method
		id, sum := "getComicPage", "One validated page image"
		if method == http.MethodHead {
			id, sum = "headComicPage", "Headers for one validated page image"
		}
		o := readOp(op(id, method, "/files/{fileId}/versions/{contentVersion}/pages/{pageIndex}", sum, "comics"))
		o.Responses["200"] = mediaOp(id, method, o.Path, sum, "image/*").Responses["200"]
		huma.Register(api, o, func(ctx context.Context, in *ComicPageIn) (*huma.StreamResponse, error) {
			pg, err := a.Reading.ComicPage(ctx, principal(ctx).UserID, mustUUID(in.FileID), mustUUID(in.ContentVersion), in.PageIndex)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &huma.StreamResponse{Body: func(hc huma.Context) {
				defer pg.File.Close()
				hc.SetHeader("Content-Type", pg.Mime)
				hc.SetHeader("Content-Length", strconv.FormatInt(pg.Size, 10))
				hc.SetHeader("ETag", pg.ETag)
				hc.SetHeader("Cache-Control", "private, no-store")
				hc.SetHeader("X-Content-Type-Options", "nosniff")
				hc.SetStatus(http.StatusOK)
				if method == http.MethodGet {
					_, _ = io.Copy(hc.BodyWriter(), pg.File)
				}
			}}, nil
		})
	}
}
