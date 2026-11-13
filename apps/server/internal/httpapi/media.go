package httpapi

import (
	"context"
	"net/http"
	"os"
	"strconv"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/media"
)

type fileIn struct {
	FileID         string `path:"fileId" format:"uuid"`
	ContentVersion string `path:"contentVersion" format:"uuid"`
	Range          string `header:"Range"`
	IfRange        string `header:"If-Range"`
	IfMatch        string `header:"If-Match"`
	IfNoneMatch    string `header:"If-None-Match"`
}

type artworkIn struct {
	RecordingPath
}

const maxThumbnailBytes = 5 << 20 // Android Auto thumbnails must not exceed 5 MiB

func mediaOp(id, method, path, summary string, contentType string) huma.Operation {
	o := op(id, method, path, summary, "media")
	o.Errors = append([]int{}, 400, 401, 403, 404, 409, 412, 416, 503)
	hdrs := map[string]*huma.Param{
		"Content-Type":   {Schema: &huma.Schema{Type: "string"}},
		"Content-Length": {Schema: &huma.Schema{Type: "integer"}},
		"ETag":           {Schema: &huma.Schema{Type: "string"}},
		"Accept-Ranges":  {Schema: &huma.Schema{Type: "string"}},
		"Cache-Control":  {Schema: &huma.Schema{Type: "string"}},
		"Content-Range":  {Schema: &huma.Schema{Type: "string"}},
	}
	resp := func(desc string) *huma.Response {
		r := &huma.Response{Description: desc, Headers: hdrs}
		if method == http.MethodGet {
			r.Content = map[string]*huma.MediaType{contentType: {Schema: &huma.Schema{Type: "string", Format: "binary"}}}
		}
		return r
	}
	o.Responses = map[string]*huma.Response{"200": resp("Success")}
	if contentType == "application/octet-stream" {
		o.Responses["206"] = resp("Exact single byte range (HEAD returns no body)")
		o.Responses["304"] = &huma.Response{Description: "Not modified"}
	}
	return o
}

func (a *API) registerMedia(api huma.API) {
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		id, sum := "getFileContent", "Original file bytes for one content version"
		if method == http.MethodHead {
			id, sum = "headFileContent", "Headers for one content version"
		}
		method := method
		huma.Register(api, mediaOp(id, method, "/files/{fileId}/versions/{contentVersion}/content", sum, "application/octet-stream"),
			func(ctx context.Context, in *fileIn) (*huma.StreamResponse, error) {
				return a.serveFile(ctx, method, in)
			})
	}
	for _, kind := range []string{"thumbnail", "cover"} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			kind, method := kind, method
			pre := map[string]string{http.MethodGet: "get", http.MethodHead: "head"}[method]
			id := pre + map[string]string{"thumbnail": "Thumbnail", "cover": "Cover"}[kind]
			huma.Register(api, mediaOp(id, method, "/recordings/{recordingId}/artwork/"+kind, "Recording "+kind+" artwork", "image/*"),
				func(ctx context.Context, in *artworkIn) (*huma.StreamResponse, error) {
					return a.serveArtwork(ctx, method, kind, in)
				})
		}
	}
}

func (a *API) serveFile(ctx context.Context, method string, in *fileIn) (*huma.StreamResponse, error) {
	p := principal(ctx)
	target, err := a.Catalog.ResolveFile(ctx, p.UserID, mustUUID(in.FileID), mustUUID(in.ContentVersion))
	if err != nil {
		return nil, a.fail(ctx, err)
	}
	f, err := media.Open(a.Config.MediaRoot, target.Locator, target.Size)
	if err != nil {
		return nil, a.fail(ctx, err)
	}
	plan := media.Decide(media.Request{Method: method, Range: in.Range, IfRange: in.IfRange, IfMatch: in.IfMatch, IfNoneMatch: in.IfNoneMatch},
		target.Size, target.ETag)
	switch plan.Status {
	case http.StatusBadRequest, http.StatusPreconditionFailed, http.StatusRequestedRangeNotSatisfiable:
		f.Close()
		pr := newProblem(plan.Status, plan.Code, plan.Detail)
		if plan.ContentRange != "" {
			pr.withHeader("Content-Range", plan.ContentRange)
		}
		return nil, a.toProblem(ctx, pr)
	}
	return &huma.StreamResponse{Body: func(hc huma.Context) {
		defer f.Close()
		h := hc.SetHeader
		h("ETag", target.ETag)
		h("Cache-Control", "private, no-store")
		h("Accept-Ranges", "bytes")
		if plan.Status == http.StatusNotModified {
			hc.SetStatus(http.StatusNotModified)
			return
		}
		h("Content-Type", target.MIME)
		h("Content-Length", strconv.FormatInt(plan.Length, 10))
		if plan.ContentRange != "" {
			h("Content-Range", plan.ContentRange)
		}
		hc.SetStatus(plan.Status)
		if plan.Body(method) {
			_ = media.Copy(hc.BodyWriter(), f, plan)
		}
	}}, nil
}

func (a *API) serveArtwork(ctx context.Context, method, kind string, in *artworkIn) (*huma.StreamResponse, error) {
	p := principal(ctx)
	t, err := a.Catalog.Artwork(ctx, p.UserID, mustUUID(in.RecordingID), kind)
	if err != nil {
		return nil, a.fail(ctx, err)
	}
	f, err := os.Open(t.Locator)
	if err != nil {
		return nil, a.fail(ctx, media.ErrUnavailable)
	}
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		f.Close()
		return nil, a.fail(ctx, media.ErrUnavailable)
	}
	if kind == "thumbnail" && st.Size() > maxThumbnailBytes {
		f.Close()
		return nil, a.fail(ctx, apperr.ErrNotFound)
	}
	return &huma.StreamResponse{Body: func(hc huma.Context) {
		defer f.Close()
		hc.SetHeader("Content-Type", t.MIME)
		hc.SetHeader("Content-Length", strconv.FormatInt(st.Size(), 10))
		hc.SetHeader("Cache-Control", "private, no-store")
		hc.SetStatus(http.StatusOK)
		if method == http.MethodGet {
			_, _ = f.WriteTo(hc.BodyWriter())
		}
	}}, nil
}
