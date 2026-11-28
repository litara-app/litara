package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/covers"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type coverMedium struct {
	TitleID string `path:"titleId" format:"uuid"`
	Medium  string `query:"medium" enum:"ebook,audio" default:"ebook"`
}

// registerCovers mounts the cover routes (ADR-0086). Viewing needs access to the title through a granted library;
// changing a cover needs an administrator who also has that access.
func (a *API) registerCovers(api huma.API) {
	// visible resolves the title for the caller or fails 403/404 exactly as the title route does.
	visible := func(ctx context.Context, titleID string) (uuid.UUID, error) {
		id := mustUUID(titleID)
		if _, err := a.Catalog.Title(ctx, principal(ctx).UserID, id); err != nil {
			return uuid.Nil, a.fail(ctx, err)
		}
		return id, nil
	}

	get := readOp(op("getTitleCover", http.MethodGet, "/titles/{titleId}/cover", "The cover image of a title", "covers"))
	get.Responses["200"] = &huma.Response{Description: "The cover, always a JPEG", Headers: map[string]*huma.Param{
		"ETag": {Schema: &huma.Schema{Type: "string"}}, "Cache-Control": {Schema: &huma.Schema{Type: "string"}}},
		Content: map[string]*huma.MediaType{"image/jpeg": {Schema: &huma.Schema{Type: "string", Format: "binary"}}}}
	get.Responses["304"] = &huma.Response{Description: "Not modified"}
	huma.Register(api, get, func(ctx context.Context, in *coverMedium) (*huma.StreamResponse, error) {
		id, err := visible(ctx, in.TitleID)
		if err != nil {
			return nil, err
		}
		img, version, err := a.Covers.Image(ctx, id, in.Medium)
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

	list := adminOp(readOp(op("getTitleCovers", http.MethodGet, "/titles/{titleId}/covers", "Where each cover of a title came from", "covers")))
	list.Security = secured
	huma.Register(api, list, func(ctx context.Context, in *TitleIn) (*bodyOut[wire.TitleCovers], error) {
		id, err := visible(ctx, in.TitleID)
		if err != nil {
			return nil, err
		}
		slot := func(medium string) wire.CoverSlot {
			_, _, _ = a.Covers.Image(ctx, id, medium) // extract once if nothing is stored yet
			src, v := a.Covers.Source(ctx, id, medium)
			s := wire.CoverSlot{Source: src}
			if v != uuid.Nil && src != "none" {
				vs := v.String()
				s.Version = &vs
			}
			return s
		}
		return &bodyOut[wire.TitleCovers]{Body: wire.TitleCovers{Ebook: slot(covers.Ebook), Audio: slot(covers.Audio), SearchEnabled: a.Covers.SearchEnabled(ctx)}}, nil
	})

	put := adminOp(writeOp(op("putTitleCover", http.MethodPut, "/titles/{titleId}/cover", "Replace a title's cover with an uploaded image", "covers")))
	put.Security = secured
	put.MaxBodyBytes = covers.MaxBytes
	put.RequestBody = &huma.RequestBody{Required: true, Content: map[string]*huma.MediaType{
		"image/jpeg": {Schema: &huma.Schema{Type: "string", Format: "binary"}},
		"image/png":  {Schema: &huma.Schema{Type: "string", Format: "binary"}},
		"image/webp": {Schema: &huma.Schema{Type: "string", Format: "binary"}},
	}}
	huma.Register(api, put, func(ctx context.Context, in *struct {
		TitleID string `path:"titleId" format:"uuid"`
		Medium  string `query:"medium" enum:"ebook,audio" default:"ebook"`
		RawBody []byte
	}) (*bodyOut[wire.CoverSlot], error) {
		id, err := visible(ctx, in.TitleID)
		if err != nil {
			return nil, err
		}
		m, err := a.Covers.Upload(ctx, id, in.Medium, in.RawBody, principal(ctx).UserID)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return coverSlotOut(m), nil
	})

	fromURL := adminOp(writeOp(op("setTitleCoverFromUrl", http.MethodPost, "/titles/{titleId}/cover/from-url", "Replace a title's cover with an image the server fetches", "covers")))
	fromURL.Security = secured
	huma.Register(api, fromURL, func(ctx context.Context, in *struct {
		TitleIn
		Body wire.CoverFromURL
	}) (*bodyOut[wire.CoverSlot], error) {
		id, err := visible(ctx, in.TitleID)
		if err != nil {
			return nil, err
		}
		src := in.Body.Source
		if src == "" {
			src = "url"
		}
		m, err := a.Covers.FromURL(ctx, id, in.Body.Medium, in.Body.URL, src, principal(ctx).UserID)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return coverSlotOut(m), nil
	})

	regen := adminOp(writeOp(op("regenerateTitleCover", http.MethodPost, "/titles/{titleId}/cover/regenerate", "Replace a title's cover with the one extracted from its files again", "covers")))
	regen.Security = secured
	huma.Register(api, regen, func(ctx context.Context, in *struct {
		TitleIn
		Body wire.CoverRegenerate
	}) (*bodyOut[wire.CoverSlot], error) {
		id, err := visible(ctx, in.TitleID)
		if err != nil {
			return nil, err
		}
		m, err := a.Covers.Regenerate(ctx, id, in.Body.Medium, principal(ctx).UserID)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return coverSlotOut(m), nil
	})

	search := adminOp(readOp(op("searchTitleCovers", http.MethodGet, "/titles/{titleId}/cover-search", "Search Open Library, iTunes and the enabled metadata sources for covers of a title", "covers")))
	search.Security = secured
	huma.Register(api, search, func(ctx context.Context, in *coverMedium) (*bodyOut[wire.CoverSearchResults], error) {
		id, err := visible(ctx, in.TitleID)
		if err != nil {
			return nil, err
		}
		if !a.Covers.SearchEnabled(ctx) {
			return nil, a.fail(ctx, apperr.New(http.StatusConflict, "cover_search_disabled", "Online cover search is turned off. An administrator can turn it on in the cover settings."))
		}
		t, err := a.Catalog.Title(ctx, principal(ctx).UserID, id)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		author := ""
		if len(t.Title.Authors) > 0 {
			author = string(t.Title.Authors[0])
		}
		sources, err := a.providerCoverSources(ctx, id, t.Title.Title, author)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		res, err := a.Covers.Search(ctx, t.Title.Title, author, in.Medium, sources...)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		out := wire.CoverSearchResults{Items: []wire.CoverSearchResult{}}
		for _, r := range res {
			out.Items = append(out.Items, wire.CoverSearchResult{Provider: r.Provider, Title: r.Title, Author: r.Author, ImageURL: r.ImageURL, ThumbURL: r.ThumbURL})
		}
		return &bodyOut[wire.CoverSearchResults]{Body: out}, nil
	})

	prev := adminOp(readOp(op("previewTitleCover", http.MethodGet, "/titles/{titleId}/cover-preview", "A candidate cover, fetched by the server for display only", "covers")))
	prev.Security = secured
	prev.Responses["200"] = &huma.Response{Description: "The candidate, always a JPEG", Content: map[string]*huma.MediaType{"image/jpeg": {Schema: &huma.Schema{Type: "string", Format: "binary"}}}}
	huma.Register(api, prev, func(ctx context.Context, in *struct {
		TitleID string `path:"titleId" format:"uuid"`
		URL     string `query:"url" minLength:"8" maxLength:"2048"`
	}) (*huma.StreamResponse, error) {
		if _, err := visible(ctx, in.TitleID); err != nil {
			return nil, err
		}
		if !a.Covers.SearchEnabled(ctx) {
			return nil, a.fail(ctx, apperr.New(http.StatusConflict, "cover_search_disabled", "Online cover search is turned off. An administrator can turn it on in the cover settings."))
		}
		img, err := a.Covers.Preview(ctx, in.URL)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &huma.StreamResponse{Body: func(hc huma.Context) {
			hc.SetHeader("Content-Type", "image/jpeg")
			hc.SetHeader("Content-Length", strconv.Itoa(len(img)))
			hc.SetHeader("Cache-Control", "private, max-age=300")
			hc.SetStatus(http.StatusOK)
			_, _ = hc.BodyWriter().Write(img)
		}}, nil
	})

	gs := adminOp(readOp(op("getCoverSettings", http.MethodGet, "/admin/cover-settings", "Whether online cover search is on", "covers")))
	gs.Security = secured
	huma.Register(api, gs, func(ctx context.Context, _ *struct{}) (*bodyOut[wire.CoverSettings], error) {
		return &bodyOut[wire.CoverSettings]{Body: wire.CoverSettings{SearchEnabled: a.Covers.SearchEnabled(ctx)}}, nil
	})
	ps := adminOp(writeOp(op("setCoverSettings", http.MethodPut, "/admin/cover-settings", "Turn online cover search on or off", "covers")))
	ps.Security = secured
	huma.Register(api, ps, func(ctx context.Context, in *struct{ Body wire.CoverSettings }) (*bodyOut[wire.CoverSettings], error) {
		on, err := a.Covers.SetSearchEnabled(ctx, in.Body.SearchEnabled)
		if err != nil {
			return nil, a.fail(ctx, err)
		}
		return &bodyOut[wire.CoverSettings]{Body: wire.CoverSettings{SearchEnabled: on}}, nil
	})
}

// coverProviderNames are the names shown beside a provider's covers.
var coverProviderNames = map[string]string{metadata.ProviderGoodreads: "Goodreads"}

// providerCoverSources adds the metadata providers that offer covers and that a library holding the title has enabled
// (ADR-0115). Nothing is sent to a provider no such library lists.
func (a *API) providerCoverSources(ctx context.Context, titleID uuid.UUID, title, author string) ([]covers.Source, error) {
	providers, err := a.Enricher.TitleCoverProviders(ctx, principal(ctx).UserID, titleID)
	if err != nil {
		return nil, apperr.ErrUnavailable
	}
	var out []covers.Source
	for _, p := range providers {
		out = append(out, func(ctx context.Context) ([]covers.Result, error) {
			hits, err := p.Covers(ctx, title, author)
			if err != nil {
				return nil, err
			}
			var found []covers.Result
			for _, h := range hits {
				found = append(found, covers.Result{Provider: coverProviderNames[p.Name()], Title: h.Title, Author: h.Author, ImageURL: h.ImageURL, ThumbURL: h.ImageURL})
			}
			return found, nil
		})
	}
	return out, nil
}

func coverSlotOut(m covers.Meta) *bodyOut[wire.CoverSlot] {
	v := m.Version.String()
	return &bodyOut[wire.CoverSlot]{Body: wire.CoverSlot{Source: m.Source, Version: &v}}
}
