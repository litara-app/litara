// Package apperr defines the typed, safe error vocabulary shared by services
// and the HTTP layer. Details never contain credentials, raw paths or bodies.
package apperr

import (
	"errors"
	"fmt"
	"net/http"
)

// Error carries an HTTP status and a stable machine-readable code.
type Error struct {
	Status int
	Code   string
	Detail string
	// RetryAfterSeconds is set for 429.
	RetryAfterSeconds int
	// Extra is merged into the problem body (conflictId, current, ...).
	Extra map[string]any
}

func (e *Error) Error() string { return fmt.Sprintf("%d %s: %s", e.Status, e.Code, e.Detail) }

// With returns a copy with an additional problem-body member.
func (e *Error) With(key string, value any) *Error {
	c := *e
	c.Extra = map[string]any{}
	for k, v := range e.Extra {
		c.Extra[k] = v
	}
	c.Extra[key] = value
	return &c
}

func New(status int, code, detail string) *Error {
	return &Error{Status: status, Code: code, Detail: detail}
}

// As extracts an *Error from err.
func As(err error) (*Error, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e, true
	}
	return nil, false
}

var (
	ErrInvalidCredentials = New(http.StatusUnauthorized, "invalid_credentials", "The username or password is not correct.")
	ErrTokenExpired       = New(http.StatusUnauthorized, "token_expired", "The access credential has expired; refresh it.")
	ErrUnauthenticated    = New(http.StatusUnauthorized, "unauthenticated", "Authentication is required.")
	ErrSessionRevoked     = New(http.StatusUnauthorized, "session_revoked", "This session is no longer valid.")
	ErrRefreshReuse       = New(http.StatusUnauthorized, "refresh_reuse", "The refresh credential was already used; the device session was revoked.")
	ErrRefreshRetryExpiry = New(http.StatusUnauthorized, "refresh_retry_expired", "The refresh retry window has ended; sign in again.")
	ErrAccessDenied       = New(http.StatusForbidden, "library_access_denied", "You do not have access to this library.")
	ErrAdminRequired      = New(http.StatusForbidden, "admin_required", "Administrator authority is required.")
	ErrCSRF               = New(http.StatusForbidden, "csrf_failed", "The browser request failed the origin or CSRF check.")
	ErrNotFound           = New(http.StatusNotFound, "not_found", "The resource was not found.")
	ErrAmbiguous          = New(http.StatusBadRequest, "ambiguous_credentials", "Send either a bearer token or a session cookie, not both.")
	ErrMalformed          = New(http.StatusBadRequest, "malformed_request", "The request is malformed.")
	ErrUnavailable        = New(http.StatusServiceUnavailable, "temporarily_unavailable", "The resource is temporarily unavailable.")
	ErrIncomplete         = New(http.StatusConflict, "recording_incomplete", "The recording is incomplete.")
)

func Validation(detail string) *Error {
	return New(http.StatusUnprocessableEntity, "validation_failed", detail)
}
func InvalidPosition(detail string) *Error {
	return New(http.StatusUnprocessableEntity, "invalid_position", detail)
}
