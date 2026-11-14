package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/accounts"
	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/catalog"
	"github.com/deranjer/ebooker/apps/server/internal/library"
	"github.com/deranjer/ebooker/apps/server/internal/progress"
)

// CookieName is the browser session cookie (ADR-0034).
const CookieName = "litara_session"

// APIConfig is the public-contract configuration.
type APIConfig struct {
	// PublicPrefix is the reverse-proxy mount prefix (for example "/litara"); empty when served at the root.
	PublicPrefix string
	// AllowedOrigins lists exact browser origins accepted for cookie sessions in
	// addition to the request's own origin.
	AllowedOrigins []string
	// DevInsecureHTTP is the explicit development-only plain-HTTP mode: the
	// session cookie is not Secure. Never enable it in production.
	DevInsecureHTTP bool
	// MediaRoot restricts which locators may be served.
	MediaRoot string
}

// APIDeps are the services behind the public contract.
type APIDeps struct {
	Accounts *accounts.Service
	Catalog  *catalog.Service
	Progress *progress.Service
	Library  *library.Service
	Config   APIConfig
	Log      *slog.Logger
}

// API holds handler state.
type API struct {
	APIDeps
	log  *slog.Logger
	base string // PublicPrefix + /api/v1
}

// APIBase returns the externally visible API base path.
func (c APIConfig) APIBase() string { return strings.TrimRight(c.PublicPrefix, "/") + "/api/v1" }

// RegisterAPI mounts the T003 contract under /api/v1 on mux and returns the Huma API.
func RegisterAPI(mux *http.ServeMux, d APIDeps) huma.API {
	log := d.Log
	if log == nil {
		log = slog.Default()
	}
	a := &API{APIDeps: d, log: log, base: d.Config.APIBase()}

	cfg := huma.DefaultConfig("Litara API", "0.1.0-development")
	cfg.Info.Description = "Litara T003 client contract (development stability)."
	cfg.OpenAPI.Servers = []*huma.Server{{URL: a.base}}
	cfg.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"bearer":         {Type: "http", Scheme: "bearer", BearerFormat: "opaque"},
		"browserSession": {Type: "apiKey", In: "cookie", Name: CookieName},
		"csrf":           {Type: "apiKey", In: "header", Name: "X-CSRF-Token"},
	}
	cfg.CreateHooks = nil // no $schema link headers: bodies match the shared contract exactly
	cfg.Transformers = append(cfg.Transformers, a.stampRequestID)
	api := humago.NewWithPrefix(mux, "/api/v1", cfg)
	api.UseMiddleware(a.middleware(api))

	a.registerDiscovery(api)
	a.registerAuth(api)
	a.registerAdmin(api)
	a.registerLibraries(api)
	a.registerRecordings(api)
	a.registerProgress(api)
	a.registerMedia(api)
	return api
}

// stampRequestID fills requestId on Huma-generated problems (validation etc.).
func (a *API) stampRequestID(ctx huma.Context, _ string, v any) (any, error) {
	if p, ok := v.(*Problem); ok && p.RequestID == "" {
		p.RequestID = requestID(ctx.Context())
	}
	return v, nil
}

// ---- middleware ---------------------------------------------------------

func isUnsafe(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	return true
}

func bearerOf(h string) string {
	if len(h) > 7 && strings.EqualFold(h[:7], "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

// requestOrigin derives the origin this request was addressed to.
func requestOrigin(ctx huma.Context) string {
	scheme := "http"
	if ctx.TLS() != nil || strings.EqualFold(ctx.Header("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + ctx.Host()
}

func (a *API) originAllowed(ctx huma.Context) bool {
	origin := ctx.Header("Origin")
	if origin == "" {
		return false
	}
	if u, err := url.Parse(origin); err != nil || u.Scheme == "" || u.Host == "" {
		return false
	}
	if strings.EqualFold(origin, requestOrigin(ctx)) {
		return true
	}
	for _, o := range a.Config.AllowedOrigins {
		if strings.EqualFold(strings.TrimRight(o, "/"), origin) {
			return true
		}
	}
	return false
}

func (a *API) writeProblem(ctx huma.Context, p *Problem) {
	if p.RequestID == "" {
		p.RequestID = requestID(ctx.Context())
	}
	for k, vs := range p.headers {
		for _, v := range vs {
			ctx.SetHeader(k, v)
		}
	}
	ctx.SetHeader("Content-Type", "application/problem+json")
	ctx.SetStatus(p.Status)
	_ = json.NewEncoder(ctx.BodyWriter()).Encode(p)
}

func isPublic(op *huma.Operation) bool {
	if op == nil {
		return true
	}
	v, _ := op.Metadata["public"].(bool)
	return v
}

func (a *API) middleware(_ huma.API) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		id := uuid.NewString()
		ctx.SetHeader("X-Request-Id", id)
		ctx.SetHeader("Cache-Control", "no-store")
		ctx.SetHeader("X-Content-Type-Options", "nosniff")
		ctx = huma.WithValue(ctx, keyRequestID, id)
		op := ctx.Operation()

		if isPublic(op) {
			// Browser login is a cross-site request target: require an allowed Origin.
			if op != nil && op.OperationID == "webLogin" && !a.originAllowed(ctx) {
				a.writeProblem(ctx, a.toProblem(ctx.Context(), apperr.ErrCSRF))
				return
			}
			next(ctx)
			return
		}

		cred := accounts.Credential{Bearer: bearerOf(ctx.Header("Authorization"))}
		if c, err := huma.ReadCookie(ctx, CookieName); err == nil && c != nil {
			cred.Cookie = c.Value
		}
		p, err := a.Accounts.Authenticate(ctx.Context(), cred)
		if err != nil {
			a.writeProblem(ctx, a.toProblem(ctx.Context(), err))
			return
		}
		if p.Kind == "web" && isUnsafe(ctx.Method()) {
			if !a.originAllowed(ctx) || !accounts.ValidCSRF(p.CookieToken, ctx.Header("X-CSRF-Token")) {
				a.writeProblem(ctx, a.toProblem(ctx.Context(), apperr.ErrCSRF))
				return
			}
		}
		if op != nil {
			if admin, _ := op.Metadata["admin"].(bool); admin && !p.IsAdmin {
				a.writeProblem(ctx, a.toProblem(ctx.Context(), apperr.ErrAdminRequired))
				return
			}
		}
		next(huma.WithValue(ctx, keyPrincipal, p))
	}
}

func principal(ctx context.Context) *accounts.Principal {
	p, _ := ctx.Value(keyPrincipal).(*accounts.Principal)
	return p
}

func (a *API) actor(ctx context.Context) progress.Actor {
	p := principal(ctx)
	return progress.Actor{UserID: p.UserID, SessionID: p.SessionID, DeviceName: p.DeviceName}
}

// ---- shared helpers -----------------------------------------------------

var stdErrors = []int{400, 401, 403, 404, 409, 412, 422, 429, 503}

var secured = []map[string][]string{{"bearer": {}}, {"browserSession": {}, "csrf": {}}}

func op(id, method, path, summary string, tags ...string) huma.Operation {
	return huma.Operation{OperationID: id, Method: method, Path: path, Summary: summary, Tags: tags, Errors: stdErrors,
		DefaultStatus: 0}
}

func publicOp(o huma.Operation) huma.Operation {
	o.Metadata = map[string]any{"public": true}
	o.Security = []map[string][]string{}
	return o
}

func adminOp(o huma.Operation) huma.Operation {
	o.Metadata = map[string]any{"admin": true}
	return o
}

type pageQuery struct {
	Page int `query:"page" default:"0" minimum:"0" maximum:"9007199254740991"`
	Size int `query:"size" default:"50" minimum:"1" doc:"Cap at 200"`
}

func (p pageQuery) normalized() (page, size int) {
	size = p.Size
	if size > 200 {
		size = 200
	}
	return p.Page, size
}

func now() time.Time { return time.Now().UTC() }
