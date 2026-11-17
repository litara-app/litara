package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/media"
)

// RegisterProtocols mounts the root-level wire protocols (OPDS and the KOReader
// compatibility adapter). They are deliberately outside /api/v1: they use their
// own credentials (ADR-0073/0076), never the bearer/cookie transports, and give
// those credentials no management authority. Nothing here is reachable from the
// reader origin.
func RegisterProtocols(mux *http.ServeMux, d APIDeps) {
	if d.Integrations == nil {
		return
	}
	log := d.Log
	if log == nil {
		log = slog.Default()
	}
	a := &API{APIDeps: d, log: log, base: d.Config.APIBase()}
	a.registerOPDS(mux)
}

// protoError is the contract's protocol refusal body ({code, detail}). It never
// carries user, path, book or secret data.
type protoError struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
}

func writeProtoError(w http.ResponseWriter, status int, code, detail string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(protoError{Code: code, Detail: detail})
}

// protoFailure maps a service error onto a protocol status without
// distinguishing "does not exist" from "not yours": both are 404.
func (a *API) protoFailure(w http.ResponseWriter, r *http.Request, err error) {
	var ae *apperr.Error
	if errors.As(err, &ae) {
		switch ae.Status {
		case http.StatusForbidden, http.StatusConflict:
			// Ungranted, tombstoned or incomplete: no metadata about it.
			writeProtoError(w, http.StatusNotFound, "not_found", "The resource was not found.")
		case http.StatusServiceUnavailable:
			if ae.Code == "integration_disabled" {
				writeProtoError(w, http.StatusServiceUnavailable, "integration_disabled", ae.Detail)
				return
			}
			w.Header().Set("Retry-After", "5")
			writeProtoError(w, http.StatusServiceUnavailable, "temporarily_unavailable", "The resource is temporarily unavailable.")
		case http.StatusTooManyRequests:
			if ae.RetryAfterSeconds > 0 {
				w.Header().Set("Retry-After", strconv.Itoa(ae.RetryAfterSeconds))
			} else {
				w.Header().Set("Retry-After", "60")
			}
			writeProtoError(w, http.StatusTooManyRequests, "rate_limited", ae.Detail)
		default:
			writeProtoError(w, ae.Status, ae.Code, ae.Detail)
		}
		return
	}
	if errors.Is(err, media.ErrUnavailable) {
		w.Header().Set("Retry-After", "5")
		writeProtoError(w, http.StatusServiceUnavailable, "temporarily_unavailable", "The resource is temporarily unavailable.")
		return
	}
	a.log.Error("protocol request failed", "path", r.URL.Path, "error", err.Error())
	w.Header().Set("Retry-After", "5")
	writeProtoError(w, http.StatusServiceUnavailable, "temporarily_unavailable", "The resource is temporarily unavailable.")
}

// secureRequest mirrors requestOrigin's transport rule for plain net/http.
func secureRequest(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}
