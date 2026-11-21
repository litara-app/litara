package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/text/unicode/norm"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/integrations"
	"github.com/deranjer/ebooker/apps/server/internal/media"
	"github.com/deranjer/ebooker/apps/server/internal/opds"
)

const opdsRealm = `Basic realm="Litara OPDS", charset="UTF-8"`

type opdsFunc func(w http.ResponseWriter, r *http.Request, p *integrations.Protocol)

// opdsAuth authenticates a revocable app credential for every request: HTTPS
// (or the explicit development exception), HTTP Basic, an enabled service, and
// then the handler. Credentials are never accepted in URLs, and the account,
// revocation and library-grant state are re-read per request, including every
// Range retry.
func (a *API) opdsAuth(h opdsFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Vary", "Authorization")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if !secureRequest(r) && !a.Config.DevInsecureHTTP {
			writeProtoError(w, http.StatusForbidden, "https_required", "OPDS requires HTTPS.")
			return
		}
		user, pass, ok := r.BasicAuth()
		if !ok {
			w.Header().Set("WWW-Authenticate", opdsRealm)
			writeProtoError(w, http.StatusUnauthorized, "unauthenticated", "Authentication is required.")
			return
		}
		p, err := a.Integrations.Authenticate(r.Context(), integrations.KindOPDS, user, pass)
		if err != nil {
			if ae, isApp := apperr.As(err); isApp && ae.Status == http.StatusUnauthorized {
				w.Header().Set("WWW-Authenticate", opdsRealm)
				writeProtoError(w, http.StatusUnauthorized, "unauthenticated", "Authentication is required.")
				return
			}
			a.protoFailure(w, r, err)
			return
		}
		if err := a.Integrations.Enabled(r.Context(), "opds"); err != nil {
			a.protoFailure(w, r, err)
			return
		}
		if a.Config.PublicOrigin == "" {
			writeProtoError(w, http.StatusServiceUnavailable, "configuration_unavailable", "The public origin is not configured.")
			return
		}
		h(w, r, p)
	}
}

func (a *API) links() opds.Links {
	return opds.Links{Origin: strings.TrimRight(a.Config.PublicOrigin, "/")}
}

func (a *API) registerOPDS(mux *http.ServeMux) {
	mux.HandleFunc("GET /opds/v1", a.opdsAuth(a.opdsRoot(1)))
	mux.HandleFunc("GET /opds/v2", a.opdsAuth(a.opdsRoot(2)))
	mux.HandleFunc("GET /opds/v1/publications", a.opdsAuth(a.opdsList(1)))
	mux.HandleFunc("GET /opds/v2/publications", a.opdsAuth(a.opdsList(2)))
	mux.HandleFunc("GET /opds/v1/publications/{publicationId}", a.opdsAuth(a.opdsDetail(1)))
	mux.HandleFunc("GET /opds/v2/publications/{publicationId}", a.opdsAuth(a.opdsDetail(2)))
	mux.HandleFunc("GET /opds/v1/search.xml", a.opdsAuth(a.opdsSearchDescription))
	// GET patterns also serve HEAD; handlers branch on the method.
	mux.HandleFunc("GET /opds/files/{fileId}/versions/{contentVersion}/content", a.opdsAuth(a.opdsOriginal))
	mux.HandleFunc("GET /opds/publications/{publicationId}/artwork", a.opdsAuth(a.opdsArtwork))
}

func feedHeaders(w http.ResponseWriter, contentType string) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, no-store")
}

func (a *API) libraries(r *http.Request, p *integrations.Protocol) ([]opds.Library, error) {
	out, err := a.Accounts.Libraries(r.Context(), p.UserID, 0, 200)
	if err != nil {
		return nil, err
	}
	libs := make([]opds.Library, 0, len(out.Items))
	for _, l := range out.Items {
		id, err := uuid.Parse(l.ID)
		if err != nil {
			continue
		}
		libs = append(libs, opds.Library{ID: id, Name: l.Name})
	}
	return libs, nil
}

func (a *API) opdsRoot(version int) opdsFunc {
	return func(w http.ResponseWriter, r *http.Request, p *integrations.Protocol) {
		libs, err := a.libraries(r, p)
		if err != nil {
			a.protoFailure(w, r, err)
			return
		}
		if version == 1 {
			feedHeaders(w, opds.AtomNavigation)
			_, _ = w.Write(opds.AtomRoot(a.links(), libs, time.Now().UTC()))
			return
		}
		feedHeaders(w, opds.JSONFeed)
		_, _ = w.Write(opds.JSONRoot(a.links(), libs))
	}
}

// parseListQuery validates the shared list parameters. Invalid input is a
// 422-class refusal before any lookup.
func parseListQuery(r *http.Request) (opds.Query, *string, error) {
	v := r.URL.Query()
	q := opds.Query{Size: 50}
	var needle *string
	raw := v.Get("q")
	if raw == "" {
		// Compatibility alias: OPDS 2.0 clients (KOReader among them) build "?query=" for a search template that does not
		// name it. "q" stays the advertised and documented parameter and wins when both are present.
		raw = v.Get("query")
	}
	if raw != "" {
		if len(raw) > 512*4 || len([]rune(raw)) > 512 {
			return q, nil, apperr.Validation("q is too long")
		}
		q.Q = raw
		n := strings.ToLower(norm.NFC.String(raw))
		needle = &n
	}
	if raw := v.Get("libraryId"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			return q, nil, apperr.Validation("libraryId must be a UUID")
		}
		q.LibraryID = &id
	}
	if k := v.Get("mediaKind"); k != "" {
		if k != "ebook" && k != "comic" && k != "audio" {
			return q, nil, apperr.Validation("mediaKind must be ebook, comic or audio")
		}
		q.MediaKind = k
	}
	if raw := v.Get("page"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 || n > 1<<31-1 {
			return q, nil, apperr.Validation("page must be a nonnegative integer")
		}
		q.Page = n
	}
	if raw := v.Get("size"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return q, nil, apperr.Validation("size must be a positive integer")
		}
		if n > 200 {
			n = 200
		}
		q.Size = n
	}
	return q, needle, nil
}

func pubOf(id, fileID, version uuid.UUID, kind, title string, authors, narrators []string, series *string, idx *float64, lang *string,
	label, mime, filename string, size *int64, updated time.Time, order, count int32, coverMIME *string,
	publisher, published, isbn, synopsis *string, pages *int32) opds.Pub {
	p := opds.Pub{ID: id, Kind: kind, Title: title, Authors: authors, Narrators: narrators, SeriesName: series, SeriesIndex: idx, Language: lang,
		Label: label, FileID: fileID, ContentVersion: version, MIME: mime, Filename: filename, Updated: updated, FileOrder: int(order), FileCount: int(count),
		CoverMIME: coverMIME, Publisher: publisher, Published: published, ISBN: isbn, Synopsis: synopsis}
	if pages != nil {
		n := int(*pages)
		p.Pages = &n
	}
	if size != nil {
		p.Size = *size
	}
	return p
}

func (a *API) opdsList(version int) opdsFunc {
	return func(w http.ResponseWriter, r *http.Request, p *integrations.Protocol) {
		q, needle, err := parseListQuery(r)
		if err != nil {
			a.protoFailure(w, r, err)
			return
		}
		qs := sqlcgen.New(a.Integrations.Pool())
		var lib uuid.NullUUID
		if q.LibraryID != nil {
			lib = uuid.NullUUID{UUID: *q.LibraryID, Valid: true}
		}
		var kind *string
		if q.MediaKind != "" {
			k := q.MediaKind
			kind = &k
		}
		total, err := qs.CountPublications(r.Context(), sqlcgen.CountPublicationsParams{UserID: p.UserID, LibraryID: lib, MediaKind: kind, Q: needle})
		if err != nil {
			a.protoFailure(w, r, err)
			return
		}
		rows, err := qs.ListPublications(r.Context(), sqlcgen.ListPublicationsParams{UserID: p.UserID, LibraryID: lib, MediaKind: kind, Q: needle,
			Lim: int32(q.Size), Off: int32(q.Page) * int32(q.Size)})
		if err != nil {
			a.protoFailure(w, r, err)
			return
		}
		pubs := make([]opds.Pub, 0, len(rows))
		for _, x := range rows {
			var cover *string
			if x.CoverLocator != nil && x.CoverMime != nil {
				cover = x.CoverMime
			}
			pubs = append(pubs, pubOf(x.PublicationID, x.FileID, x.ContentVersion, x.MediaKind, x.Title, x.Authors, x.Narrators, x.SeriesName, x.SeriesIndex,
				x.Language, x.Label, x.MimeType, x.Filename, x.SizeBytes, x.UpdatedAt, x.FileOrder, x.FileCount, cover,
				x.Publisher, x.Published, x.Isbn, x.Synopsis, x.PageCount))
		}
		if version == 1 {
			feedHeaders(w, opds.AtomAcquisition)
			_, _ = w.Write(opds.AtomFeed(a.links(), q, pubs, total, time.Now().UTC()))
			return
		}
		feedHeaders(w, opds.JSONFeed)
		_, _ = w.Write(opds.JSONFeedDoc(a.links(), q, pubs, total))
	}
}

func (a *API) opdsDetail(version int) opdsFunc {
	return func(w http.ResponseWriter, r *http.Request, p *integrations.Protocol) {
		id, err := uuid.Parse(r.PathValue("publicationId"))
		if err != nil {
			writeProtoError(w, http.StatusNotFound, "not_found", "The resource was not found.")
			return
		}
		x, err := sqlcgen.New(a.Integrations.Pool()).GetPublication(r.Context(), sqlcgen.GetPublicationParams{UserID: p.UserID, PublicationID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			writeProtoError(w, http.StatusNotFound, "not_found", "The resource was not found.")
			return
		}
		if err != nil {
			a.protoFailure(w, r, err)
			return
		}
		var cover *string
		if x.CoverLocator != nil && x.CoverMime != nil {
			cover = x.CoverMime
		}
		pub := pubOf(x.PublicationID, x.FileID, x.ContentVersion, x.MediaKind, x.Title, x.Authors, x.Narrators, x.SeriesName, x.SeriesIndex,
			x.Language, x.Label, x.MimeType, x.Filename, x.SizeBytes, x.UpdatedAt, x.FileOrder, x.FileCount, cover,
			x.Publisher, x.Published, x.Isbn, x.Synopsis, x.PageCount)
		if version == 1 {
			feedHeaders(w, opds.AtomEntry)
			_, _ = w.Write(opds.AtomPublication(a.links(), pub))
			return
		}
		feedHeaders(w, opds.JSONPublication)
		_, _ = w.Write(opds.JSONPublicationDoc(a.links(), pub))
	}
}

func (a *API) opdsSearchDescription(w http.ResponseWriter, _ *http.Request, _ *integrations.Protocol) {
	feedHeaders(w, opds.OpenSearchDesc)
	_, _ = w.Write(opds.OpenSearch(a.links()))
}

// contentDisposition renders an attachment header that survives non-ASCII
// names and never lets a stored file name inject header syntax.
func contentDisposition(name string) string {
	clean := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || r == '"' || r == '\\' || r == '/' {
			return '_'
		}
		return r
	}, name)
	if clean == "" {
		clean = "download"
	}
	ascii := strings.Map(func(r rune) rune {
		if r > 0x7e {
			return '_'
		}
		return r
	}, clean)
	return fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, ascii, url.PathEscape(clean))
}

func (a *API) opdsOriginal(w http.ResponseWriter, r *http.Request, p *integrations.Protocol) {
	fileID, e1 := uuid.Parse(r.PathValue("fileId"))
	version, e2 := uuid.Parse(r.PathValue("contentVersion"))
	if e1 != nil || e2 != nil {
		writeProtoError(w, http.StatusNotFound, "not_found", "The resource was not found.")
		return
	}
	target, err := a.Catalog.ResolveOriginal(r.Context(), p.UserID, fileID, version)
	if err != nil {
		a.protoFailure(w, r, err)
		return
	}
	f, err := media.Open(a.Config.MediaRoot, target.Locator, target.Size)
	if err != nil {
		a.protoFailure(w, r, err)
		return
	}
	defer f.Close()
	plan := media.Decide(media.Request{Method: r.Method, Range: r.Header.Get("Range"), IfRange: r.Header.Get("If-Range"),
		IfMatch: r.Header.Get("If-Match"), IfNoneMatch: r.Header.Get("If-None-Match")}, target.Size, target.ETag)
	switch plan.Status {
	case http.StatusBadRequest, http.StatusPreconditionFailed, http.StatusRequestedRangeNotSatisfiable:
		if plan.ContentRange != "" {
			w.Header().Set("Content-Range", plan.ContentRange)
		}
		writeProtoError(w, plan.Status, plan.Code, plan.Detail)
		return
	}
	h := w.Header()
	h.Set("ETag", target.ETag)
	h.Set("Cache-Control", "private, no-store")
	h.Set("Accept-Ranges", "bytes")
	if plan.Status == http.StatusNotModified {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set("Content-Type", target.MIME)
	h.Set("Content-Disposition", contentDisposition(target.Filename))
	h.Set("Content-Length", strconv.FormatInt(plan.Length, 10))
	if plan.ContentRange != "" {
		h.Set("Content-Range", plan.ContentRange)
	}
	w.WriteHeader(plan.Status)
	if plan.Body(r.Method) {
		_ = media.Copy(w, f, plan)
	}
}

func (a *API) opdsArtwork(w http.ResponseWriter, r *http.Request, p *integrations.Protocol) {
	id, err := uuid.Parse(r.PathValue("publicationId"))
	if err != nil {
		writeProtoError(w, http.StatusNotFound, "not_found", "The resource was not found.")
		return
	}
	row, err := sqlcgen.New(a.Integrations.Pool()).GetPublicationCover(r.Context(), sqlcgen.GetPublicationCoverParams{UserID: p.UserID, PublicationID: id})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (row.CoverLocator == nil || row.CoverMime == nil)) {
		writeProtoError(w, http.StatusNotFound, "not_found", "The resource was not found.")
		return
	}
	if err != nil {
		a.protoFailure(w, r, err)
		return
	}
	f, err := os.Open(*row.CoverLocator)
	if err != nil {
		a.protoFailure(w, r, media.ErrUnavailable)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		a.protoFailure(w, r, media.ErrUnavailable)
		return
	}
	h := w.Header()
	h.Set("Content-Type", *row.CoverMime)
	h.Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	h.Set("Cache-Control", "private, no-store")
	h.Set("ETag", fmt.Sprintf(`"%x-%x"`, st.Size(), st.ModTime().UnixNano()))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = f.WriteTo(w)
	}
}
