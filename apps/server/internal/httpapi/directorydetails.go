package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/covers"
	"github.com/deranjer/ebooker/apps/server/internal/reading"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// DirectoryNameQuery names one author or series, ignoring case. It is a query value because names may hold slashes.
type DirectoryNameQuery struct {
	Name string `query:"name" minLength:"1" maxLength:"512" required:"true"`
}

// registerDirectoryDetails mounts author and series details (ADR-0102 to ADR-0105). Reading them needs a visible title
// of that author or series; changing them needs an administrator who also has that.
func (a *API) registerDirectoryDetails(api huma.API) {
	for _, d := range []struct{ kind, path, get, save, label string }{
		{reading.KindAuthor, "/authors/details", "getAuthorDetails", "saveAuthorDetails", "an author"},
		{reading.KindSeries, "/series/details", "getSeriesDetails", "saveSeriesDetails", "a series"},
	} {
		huma.Register(api, readOp(op(d.get, http.MethodGet, d.path, "The saved and derived details of "+d.label, "catalog")),
			func(ctx context.Context, in *struct{ DirectoryNameQuery }) (*bodyOut[wire.DirectoryDetails], error) {
				out, err := a.Reading.DirectoryDetails(ctx, principal(ctx).UserID, d.kind, in.Name)
				if err != nil {
					return nil, a.fail(ctx, err)
				}
				return &bodyOut[wire.DirectoryDetails]{Body: out}, nil
			})
		save := adminOp(writeOp(op(d.save, http.MethodPatch, d.path, "Change the details of "+d.label+" under one revision", "catalog")))
		huma.Register(api, save, func(ctx context.Context, in *struct {
			DirectoryNameQuery
			Body wire.MetadataSave
		}) (*bodyOut[wire.DirectoryDetails], error) {
			out, err := a.Reading.SaveDirectoryDetails(ctx, a.readingActor(ctx), d.kind, in.Name, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.DirectoryDetails]{Body: out}, nil
		})
	}

	get := readOp(op("getAuthorPhoto", http.MethodGet, "/authors/photo", "The stored photo of an author", "catalog"))
	get.Responses["200"] = &huma.Response{Description: "The photo, always a JPEG", Headers: map[string]*huma.Param{
		"ETag": {Schema: &huma.Schema{Type: "string"}}, "Cache-Control": {Schema: &huma.Schema{Type: "string"}}},
		Content: map[string]*huma.MediaType{"image/jpeg": {Schema: &huma.Schema{Type: "string", Format: "binary"}}}}
	get.Responses["304"] = &huma.Response{Description: "Not modified"}
	huma.Register(api, get, func(ctx context.Context, in *struct{ DirectoryNameQuery }) (*huma.StreamResponse, error) {
		img, version, err := a.Reading.AuthorPhoto(ctx, principal(ctx).UserID, in.Name)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		etag := `"` + version.String() + `"`
		return &huma.StreamResponse{Body: func(hc huma.Context) {
			hc.SetHeader("ETag", etag)
			hc.SetHeader("Cache-Control", "private, no-cache")
			if hc.Header("If-None-Match") == etag {
				hc.SetStatus(http.StatusNotModified)
				return
			}
			hc.SetHeader("Content-Type", "image/jpeg")
			hc.SetHeader("Content-Length", strconv.Itoa(len(img)))
			hc.SetStatus(http.StatusOK)
			_, _ = hc.BodyWriter().Write(img)
		}}, nil
	})

	put := adminOp(writeOp(op("putAuthorPhoto", http.MethodPut, "/authors/photo", "Replace an author's photo with an uploaded image", "catalog")))
	put.MaxBodyBytes = covers.MaxBytes
	put.RequestBody = &huma.RequestBody{Required: true, Content: map[string]*huma.MediaType{
		"image/jpeg": {Schema: &huma.Schema{Type: "string", Format: "binary"}},
		"image/png":  {Schema: &huma.Schema{Type: "string", Format: "binary"}},
		"image/webp": {Schema: &huma.Schema{Type: "string", Format: "binary"}},
	}}
	huma.Register(api, put, func(ctx context.Context, in *struct {
		DirectoryNameQuery
		OperationID  string `query:"operationId" format:"uuid" required:"true"`
		BaseRevision string `query:"baseRevision" pattern:"^(0|[1-9][0-9]*)$" required:"true"`
		RawBody      []byte
	}) (*bodyOut[wire.DirectoryDetails], error) {
		img, err := a.Covers.Prepare(in.RawBody)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		out, err := a.Reading.SetAuthorPhoto(ctx, a.readingActor(ctx), in.Name, "upload", img, in.RawBody, in.OperationID, in.BaseRevision)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.DirectoryDetails]{Body: out}, nil
	})

	fromURL := adminOp(writeOp(op("setAuthorPhotoFromUrl", http.MethodPost, "/authors/photo/from-url", "Replace an author's photo with an image the server fetches", "catalog")))
	huma.Register(api, fromURL, func(ctx context.Context, in *struct {
		DirectoryNameQuery
		Body wire.AuthorPhotoFromURL
	}) (*bodyOut[wire.DirectoryDetails], error) {
		// The author is checked first, so the server fetches nothing for someone who cannot edit them.
		if _, err := a.Reading.DirectoryDetails(ctx, principal(ctx).UserID, reading.KindAuthor, in.Name); err != nil {
			return nil, a.fail(ctx, err)
		}
		img, err := a.Covers.Preview(ctx, in.Body.URL)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		out, err := a.Reading.SetAuthorPhoto(ctx, a.readingActor(ctx), in.Name, "url", img, []byte(in.Body.URL), in.Body.OperationID, in.Body.BaseRevision)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.DirectoryDetails]{Body: out}, nil
	})
}
