package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// storedImage serves a stored JPEG with its version as the ETag.
func storedImage(img []byte, version uuid.UUID, cacheControl string) *huma.StreamResponse {
	etag := `"` + version.String() + `"`
	return &huma.StreamResponse{Body: func(hc huma.Context) {
		if version != uuid.Nil {
			hc.SetHeader("ETag", etag)
		}
		hc.SetHeader("Cache-Control", cacheControl)
		if version != uuid.Nil && hc.Header("If-None-Match") == etag {
			hc.SetStatus(http.StatusNotModified)
			return
		}
		hc.SetHeader("Content-Type", "image/jpeg")
		hc.SetHeader("Content-Length", strconv.Itoa(len(img)))
		hc.SetStatus(http.StatusOK)
		_, _ = hc.BodyWriter().Write(img)
	}}
}

func jpegResponses(o *huma.Operation, description string) {
	o.Responses["200"] = &huma.Response{Description: description, Headers: map[string]*huma.Param{
		"ETag": {Schema: &huma.Schema{Type: "string"}}, "Cache-Control": {Schema: &huma.Schema{Type: "string"}}},
		Content: map[string]*huma.MediaType{"image/jpeg": {Schema: &huma.Schema{Type: "string", Format: "binary"}}}}
	o.Responses["304"] = &huma.Response{Description: "Not modified"}
}

// registerDirectoryOnline mounts author and series lookups and missing books (ADR-0102 to ADR-0106). Looking up and
// applying need an administrator who can see the author or series; missing books are for anyone who can.
func (a *API) registerDirectoryOnline(api huma.API) {
	type lookupIn struct {
		DirectoryNameQuery
		Body wire.DirectoryLookup
	}
	type applyIn struct {
		DirectoryNameQuery
		Body wire.DirectoryApply
	}

	authors := adminOp(writeOp(op("lookupAuthor", http.MethodPost, "/authors/lookup", "Search the enabled providers for an author, to review", "catalog")))
	huma.Register(api, authors, func(ctx context.Context, in *lookupIn) (*bodyOut[wire.AuthorLookupResults], error) {
		out, err := a.Reading.LookupAuthor(ctx, principal(ctx).UserID, in.Name, in.Body.Fresh)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.AuthorLookupResults]{Body: out}, nil
	})

	preview := adminOp(readOp(op("previewAuthorLookupPhoto", http.MethodGet, "/authors/lookup/photo", "A candidate's photo, fetched by the server for review only", "catalog")))
	preview.Security = secured
	jpegResponses(&preview, "The candidate photo, always a JPEG")
	huma.Register(api, preview, func(ctx context.Context, in *struct {
		DirectoryNameQuery
		Provider string `query:"provider" enum:"hardcover,open_library" required:"true"`
		ID       string `query:"id" minLength:"1" maxLength:"64" required:"true"`
	}) (*huma.StreamResponse, error) {
		img, err := a.Reading.AuthorCandidatePhoto(ctx, principal(ctx).UserID, in.Name, in.Provider, in.ID)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return storedImage(img, uuid.Nil, "private, max-age=300"), nil
	})

	applyAuthor := adminOp(writeOp(op("applyAuthorLookup", http.MethodPost, "/authors/lookup/apply", "Save chosen values from a provider's author record", "catalog")))
	huma.Register(api, applyAuthor, func(ctx context.Context, in *applyIn) (*bodyOut[wire.DirectoryDetails], error) {
		out, err := a.Reading.ApplyAuthor(ctx, a.readingActor(ctx), in.Name, in.Body)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.DirectoryDetails]{Body: out}, nil
	})

	series := adminOp(writeOp(op("lookupSeries", http.MethodPost, "/series/lookup", "Find a series through its books with the enabled providers, to review", "catalog")))
	huma.Register(api, series, func(ctx context.Context, in *lookupIn) (*bodyOut[wire.SeriesLookupResults], error) {
		out, err := a.Reading.LookupSeries(ctx, principal(ctx).UserID, in.Name, in.Body.Fresh)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.SeriesLookupResults]{Body: out}, nil
	})

	applySeries := adminOp(writeOp(op("applySeriesLookup", http.MethodPost, "/series/lookup/apply", "Match a series to a provider record and save chosen values", "catalog")))
	huma.Register(api, applySeries, func(ctx context.Context, in *applyIn) (*bodyOut[wire.DirectoryDetails], error) {
		out, err := a.Reading.ApplySeries(ctx, a.readingActor(ctx), in.Name, in.Body)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.DirectoryDetails]{Body: out}, nil
	})

	huma.Register(api, readOp(op("listMissingSeriesBooks", http.MethodGet, "/series/missing", "The books of a matched series that the caller's libraries lack", "catalog")),
		func(ctx context.Context, in *struct{ DirectoryNameQuery }) (*bodyOut[wire.MissingBooks], error) {
			out, err := a.Reading.MissingBooks(ctx, principal(ctx).UserID, in.Name)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.MissingBooks]{Body: out}, nil
		})

	cover := readOp(op("getMissingSeriesBookCover", http.MethodGet, "/series/missing/cover", "The stored cover of a book in a matched series", "catalog"))
	jpegResponses(&cover, "The cover, always a JPEG")
	huma.Register(api, cover, func(ctx context.Context, in *struct {
		DirectoryNameQuery
		Number string `query:"number" pattern:"^[1-9][0-9]{0,4}$" required:"true"`
	}) (*huma.StreamResponse, error) {
		img, version, err := a.Reading.MissingCover(ctx, principal(ctx).UserID, in.Name, in.Number)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return storedImage(img, version, "private, no-cache"), nil
	})
}
