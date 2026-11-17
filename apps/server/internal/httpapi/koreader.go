package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/integrations"
	"github.com/deranjer/ebooker/apps/server/internal/koreader"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

const koMaxBody = 32 << 10 // contracts/t006/README.md: 32 KiB for KOReader requests

func writeKo(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeKoError(w http.ResponseWriter, e *koreader.WireError) {
	writeKo(w, e.HTTP, e)
}

// koFailure maps any failure to the stock envelope; unexpected errors are 503
// 2009 and are logged without request bodies or credentials.
func (a *API) koFailure(w http.ResponseWriter, r *http.Request, err error) {
	var we *koreader.WireError
	if errors.As(err, &we) {
		writeKoError(w, we)
		return
	}
	a.log.Error("koreader request failed", "path", r.URL.Path, "error", err.Error())
	w.Header().Set("Retry-After", "5")
	writeKoError(w, koreader.ErrUnavailable)
}

// koAuth runs the account/credential/service gates before any catalog lookup.
func (a *API) koAuth(h func(http.ResponseWriter, *http.Request, *integrations.Protocol)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, err := a.Integrations.Authenticate(r.Context(), integrations.KindKOReader, r.Header.Get("x-auth-user"), r.Header.Get("x-auth-key"))
		if err != nil {
			if ae, ok := apperr.As(err); ok && ae.Status == http.StatusTooManyRequests {
				w.Header().Set("Retry-After", "60")
				writeKoError(w, koreader.ErrRateLimited)
				return
			}
			if ae, ok := apperr.As(err); ok && ae.Status == http.StatusUnauthorized {
				writeKoError(w, koreader.ErrUnauthorized)
				return
			}
			a.koFailure(w, r, err)
			return
		}
		if err := a.Integrations.Enabled(r.Context(), "koreader"); err != nil {
			writeKoError(w, koreader.ErrUnavailable)
			return
		}
		h(w, r, p)
	}
}

func (a *API) registerKOReaderWire(mux *http.ServeMux) {
	mux.HandleFunc("GET /1/healthcheck", func(w http.ResponseWriter, r *http.Request) {
		if err := a.Integrations.Enabled(r.Context(), "koreader"); err != nil {
			writeKoError(w, koreader.ErrUnavailable)
			return
		}
		writeKo(w, http.StatusOK, map[string]string{"state": "OK"})
	})
	// Account registration is never available through this adapter (ADR-0075); the body is not read or logged.
	mux.HandleFunc("POST /1/users/create", func(w http.ResponseWriter, _ *http.Request) {
		writeKoError(w, koreader.ErrRegistration)
	})
	mux.HandleFunc("GET /1/users/auth", a.koAuth(func(w http.ResponseWriter, _ *http.Request, _ *integrations.Protocol) {
		writeKo(w, http.StatusOK, map[string]string{"authorized": "OK"})
	}))
	mux.HandleFunc("GET /1/syncs/progress/{document}", a.koAuth(func(w http.ResponseWriter, r *http.Request, p *integrations.Protocol) {
		body, err := a.KOReader.GetProgress(r.Context(), p, r.PathValue("document"))
		if err != nil {
			a.koFailure(w, r, err)
			return
		}
		if body == nil {
			writeKo(w, http.StatusOK, map[string]any{}) // a valid file with no source position
			return
		}
		writeKo(w, http.StatusOK, body)
	}))
	mux.HandleFunc("PUT /1/syncs/progress", a.koAuth(func(w http.ResponseWriter, r *http.Request, p *integrations.Protocol) {
		r.Body = http.MaxBytesReader(w, r.Body, koMaxBody)
		var in struct {
			koreader.PutIn
			Metadata *struct {
				Filename string `json:"filename"`
				Title    string `json:"title"`
				Authors  string `json:"authors"`
			} `json:"metadata"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeKoError(w, koreader.ErrInvalidFields)
			return
		}
		// Newer clients may send descriptive metadata: bounded, untrusted, never used to select a file.
		if m := in.Metadata; m != nil && (len(m.Filename) > 1024 || len(m.Title) > 1024 || len(m.Authors) > 2048) {
			writeKoError(w, koreader.ErrInvalidFields)
			return
		}
		ok, err := a.KOReader.PutProgress(r.Context(), p, in.PutIn)
		if err != nil {
			a.koFailure(w, r, err)
			return
		}
		writeKo(w, http.StatusOK, ok)
	}))
}

// ---- management (Huma) ------------------------------------------------------

func (a *API) registerKOReaderManagement(api huma.API) {
	huma.Register(api, t006Read(op("getKoReaderPosition", http.MethodGet, "/editions/{editionId}/koreader-position", "The separate KOReader position source for an edition", "koreader")),
		func(ctx context.Context, in *EditionIn) (*bodyOut[wire.T006KoPosition], error) {
			out, err := a.KOReader.Position(ctx, principal(ctx).UserID, mustUUID(in.EditionID))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T006KoPosition]{Body: out}, nil
		})

	huma.Register(api, t006Read(op("listKoReaderBindings", http.MethodGet, "/koreader/bindings", "The caller's per-credential digest bindings", "koreader")),
		func(ctx context.Context, in *PageQuery) (*bodyOut[wire.T006DigestBindingList], error) {
			page, size := in.normalized()
			out, err := a.KOReader.ListBindings(ctx, principal(ctx).UserID, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T006DigestBindingList]{Body: out}, nil
		})

	huma.Register(api, t006Write(op("putKoReaderBinding", http.MethodPut, "/koreader/bindings/{bindingId}", "Create or retarget a digest binding", "koreader")),
		func(ctx context.Context, in *struct {
			BindingID string `path:"bindingId" format:"uuid"`
			Body      wire.T006DigestBindingWrite
		}) (*bodyOut[wire.T006DigestBinding], error) {
			out, err := a.KOReader.PutBinding(ctx, principal(ctx).UserID, mustUUID(in.BindingID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T006DigestBinding]{Body: out}, nil
		})

	huma.Register(api, t006Write(op("deleteKoReaderBinding", http.MethodDelete, "/koreader/bindings/{bindingId}", "Delete a digest binding (tombstone)", "koreader")),
		func(ctx context.Context, in *struct {
			BindingID string `path:"bindingId" format:"uuid"`
			Body      wire.T006Mutation
		}) (*bodyOut[wire.T006DigestBinding], error) {
			out, err := a.KOReader.DeleteBinding(ctx, principal(ctx).UserID, mustUUID(in.BindingID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T006DigestBinding]{Body: out}, nil
		})

	huma.Register(api, t006Read(op("listKoReaderConflicts", http.MethodGet, "/koreader/conflicts", "The caller's retained KOReader candidates", "koreader")),
		func(ctx context.Context, in *PageQuery) (*bodyOut[wire.T006KoConflictList], error) {
			page, size := in.normalized()
			out, err := a.KOReader.ListConflicts(ctx, principal(ctx).UserID, page, size)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T006KoConflictList]{Body: out}, nil
		})

	huma.Register(api, t006Write(op("resolveKoReaderConflict", http.MethodPost, "/koreader/conflicts/{conflictId}/resolve", "Keep the server position or use the retained candidate", "koreader")),
		func(ctx context.Context, in *struct {
			ConflictID string `path:"conflictId" format:"uuid"`
			Body       wire.T006KoResolve
		}) (*bodyOut[wire.T006KoPosition], error) {
			out, err := a.KOReader.Resolve(ctx, principal(ctx).UserID, mustUUID(in.ConflictID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T006KoPosition]{Body: out}, nil
		})

	huma.Register(api, t006Write(op("reapplyKoReaderConflict", http.MethodPost, "/koreader/conflicts/{conflictId}/reapply", "Deliberately reapply a resolved retained place", "koreader")),
		func(ctx context.Context, in *struct {
			ConflictID string `path:"conflictId" format:"uuid"`
			Body       wire.T006Mutation
		}) (*bodyOut[wire.T006KoPosition], error) {
			out, err := a.KOReader.Reapply(ctx, principal(ctx).UserID, mustUUID(in.ConflictID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T006KoPosition]{Body: out}, nil
		})
}
