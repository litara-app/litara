package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/media"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// ProblemError is one safe validation detail. It never echoes submitted values.
type ProblemError struct {
	Location string `json:"location"`
	Message  string `json:"message"`
}

// Problem is the RFC 9457 application/problem+json body shared by every error.
type Problem struct {
	Type                  string                `json:"type" format:"uri-reference"`
	Title                 string                `json:"title"`
	Status                int                   `json:"status" minimum:"400" maximum:"599"`
	Detail                string                `json:"detail"`
	Code                  string                `json:"code"`
	RequestID             string                `json:"requestId" format:"uuid"`
	Errors                []ProblemError        `json:"errors,omitempty"`
	ConflictID            string                `json:"conflictId,omitempty" format:"uuid"`
	Current               *wire.PositionState   `json:"current,omitempty"`
	CurrentCompletion     *wire.CompletionState `json:"currentCompletion,omitempty"`
	CurrentLayoutRevision string                `json:"currentLayoutRevision,omitempty" format:"uuid"`

	headers http.Header
}

func (p *Problem) Error() string             { return fmt.Sprintf("%d %s", p.Status, p.Code) }
func (p *Problem) GetStatus() int            { return p.Status }
func (p *Problem) ContentType(string) string { return "application/problem+json" }
func (p *Problem) GetHeaders() http.Header   { return p.headers }
func (p *Problem) withHeader(k, v string) *Problem {
	if p.headers == nil {
		p.headers = http.Header{}
	}
	p.headers.Set(k, v)
	return p
}

func codeForStatus(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "malformed_request"
	case http.StatusUnauthorized:
		return "unauthenticated"
	case http.StatusForbidden:
		return "forbidden"
	case http.StatusNotFound:
		return "not_found"
	case http.StatusMethodNotAllowed:
		return "method_not_allowed"
	case http.StatusNotAcceptable:
		return "not_acceptable"
	case http.StatusUnsupportedMediaType:
		return "unsupported_media_type"
	case http.StatusRequestEntityTooLarge:
		return "request_too_large"
	case http.StatusUnprocessableEntity:
		return "validation_failed"
	case http.StatusTooManyRequests:
		return "rate_limited"
	case http.StatusServiceUnavailable:
		return "temporarily_unavailable"
	}
	if status >= 500 {
		return "internal_error"
	}
	return "request_failed"
}

func newProblem(status int, code, detail string) *Problem {
	return &Problem{Type: "urn:litara:problem:" + code, Title: code, Status: status, Detail: detail, Code: code}
}

func init() {
	// Huma's own failures (parameter/body validation, unsupported media type)
	// use the same safe problem shape; submitted values are never echoed.
	huma.NewError = func(status int, msg string, errs ...error) huma.StatusError {
		p := newProblem(status, codeForStatus(status), safeDetail(status, msg))
		for _, e := range errs {
			var d huma.ErrorDetailer
			if e == nil {
				continue
			}
			if errors.As(e, &d) {
				det := d.ErrorDetail()
				p.Errors = append(p.Errors, ProblemError{Location: det.Location, Message: det.Message})
			} else {
				p.Errors = append(p.Errors, ProblemError{Location: "", Message: "invalid request"})
			}
		}
		return p
	}
}

func safeDetail(status int, msg string) string {
	if status == http.StatusUnprocessableEntity {
		return "The request failed validation."
	}
	if status == http.StatusBadRequest {
		return "The request is malformed."
	}
	if status >= 500 {
		return "The server could not complete the request."
	}
	return msg
}

type ctxKey int

const (
	keyRequestID ctxKey = iota
	keyPrincipal
)

func requestID(ctx context.Context) string {
	if v, ok := ctx.Value(keyRequestID).(string); ok {
		return v
	}
	return uuid.NewString()
}

// toProblem converts any error into a safe problem. Unknown errors become 503
// temporarily_unavailable (storage/database) and are logged without detail
// leakage by the caller.
func (a *API) toProblem(ctx context.Context, err error) *Problem {
	var p *Problem
	if errors.As(err, &p) {
		if p.RequestID == "" {
			p.RequestID = requestID(ctx)
		}
		return p
	}
	if ae, ok := apperr.As(err); ok {
		p = newProblem(ae.Status, ae.Code, ae.Detail)
		for k, v := range ae.Extra {
			raw, _ := json.Marshal(v)
			switch k {
			case "conflictId":
				_ = json.Unmarshal(raw, &p.ConflictID)
			case "current":
				_ = json.Unmarshal(raw, &p.Current)
			case "currentCompletion":
				_ = json.Unmarshal(raw, &p.CurrentCompletion)
			case "currentLayoutRevision":
				_ = json.Unmarshal(raw, &p.CurrentLayoutRevision)
			}
		}
		if ae.RetryAfterSeconds > 0 {
			p.withHeader("Retry-After", strconv.Itoa(ae.RetryAfterSeconds))
		}
		p.RequestID = requestID(ctx)
		return p
	}
	if errors.Is(err, media.ErrUnavailable) {
		p = newProblem(http.StatusServiceUnavailable, "temporarily_unavailable", "The media storage is temporarily unavailable.")
	} else {
		a.log.Error("request failed", "request_id", requestID(ctx), "error", err.Error())
		p = newProblem(http.StatusServiceUnavailable, "temporarily_unavailable", "The server could not complete the request; try again.")
	}
	p.RequestID = requestID(ctx)
	return p.withHeader("Retry-After", "5")
}

// fail is the single handler exit for errors.
func (a *API) fail(ctx context.Context, err error) error { return a.toProblem(ctx, err) }
