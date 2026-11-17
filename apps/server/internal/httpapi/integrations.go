package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// T006Problem documents the T006 error body in the generated OpenAPI. At
// runtime every error is a Problem; currentRevision/conflictId are emitted on
// stale_revision and retained-conflict failures.
type T006Problem struct {
	Type            string `json:"type" format:"uri-reference"`
	Title           string `json:"title" minLength:"1" maxLength:"1024"`
	Status          int    `json:"status" minimum:"400" maximum:"599"`
	Detail          string `json:"detail" minLength:"0" maxLength:"8192"`
	Code            string `json:"code" minLength:"1" maxLength:"128"`
	RequestID       string `json:"requestId" format:"uuid"`
	CurrentRevision string `json:"currentRevision,omitempty" pattern:"^(0|[1-9][0-9]*)$"`
	ConflictID      string `json:"conflictId,omitempty" format:"uuid"`
}

// t006Read declares T006 read-route security and the T006Problem error body.
func t006Read(o huma.Operation) huma.Operation {
	o.Security = []map[string][]string{{"bearer": {}}, {"browserSession": {}}}
	o.Errors = nil
	o.Responses = map[string]*huma.Response{}
	for _, code := range stdErrors {
		o.Responses[strconv.Itoa(code)] = &huma.Response{Description: "Typed error",
			Content: map[string]*huma.MediaType{"application/problem+json": {Schema: &huma.Schema{Ref: "#/components/schemas/T006Problem"}}}}
	}
	return o
}

// t006Write is t006Read plus the browser CSRF requirement for unsafe methods.
func t006Write(o huma.Operation) huma.Operation {
	o = t006Read(o)
	o.Security = []map[string][]string{{"bearer": {}}, {"browserSession": {}, "csrf": {}}}
	return o
}

func (a *API) serverSmtpAvailable(ctx context.Context) bool {
	if a.Delivery == nil {
		return false
	}
	return a.Delivery.ServerAvailable(ctx)
}

func (a *API) registerIntegrations(api huma.API) {
	huma.Register(api, t006Read(op("getIntegrationSettings", http.MethodGet, "/integrations/settings", "Integration enablement and limits", "integrations")),
		func(ctx context.Context, _ *struct{}) (*bodyOut[wire.T006IntegrationSettings], error) {
			out, err := a.Integrations.View(ctx, a.serverSmtpAvailable(ctx))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T006IntegrationSettings]{Body: out}, nil
		})

	huma.Register(api, adminOp(t006Write(op("setIntegrationSettings", http.MethodPut, "/admin/integrations/settings", "Change integration enablement and limits", "integrations"))),
		func(ctx context.Context, in *struct {
			Body wire.T006IntegrationSettingsWrite
		}) (*bodyOut[wire.T006IntegrationSettings], error) {
			out, err := a.Integrations.Put(ctx, principal(ctx).UserID, in.Body, a.serverSmtpAvailable(ctx))
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T006IntegrationSettings]{Body: out}, nil
		})

	huma.Register(api, t006Read(op("listIntegrationCredentials", http.MethodGet, "/integration-credentials", "The caller's active protocol credentials", "integrations")),
		func(ctx context.Context, _ *struct{}) (*bodyOut[wire.T006CredentialList], error) {
			out, err := a.Integrations.ListCredentials(ctx, principal(ctx).UserID)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T006CredentialList]{Body: out}, nil
		})

	create := t006Write(op("createIntegrationCredential", http.MethodPost, "/integration-credentials", "Register an OPDS or KOReader credential", "integrations"))
	create.DefaultStatus = http.StatusCreated
	huma.Register(api, create,
		func(ctx context.Context, in *struct{ Body wire.T006CredentialCreate }) (*bodyOut[wire.T006Credential], error) {
			out, err := a.Integrations.CreateCredential(ctx, principal(ctx).UserID, in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T006Credential]{Body: out}, nil
		})

	huma.Register(api, t006Write(op("revokeIntegrationCredential", http.MethodPost, "/integration-credentials/{credentialId}/revoke", "Permanently revoke a credential", "integrations")),
		func(ctx context.Context, in *struct {
			CredentialID string `path:"credentialId" format:"uuid"`
			Body         wire.T006CredentialRevoke
		}) (*bodyOut[wire.T006Credential], error) {
			out, err := a.Integrations.RevokeCredential(ctx, principal(ctx).UserID, mustUUID(in.CredentialID), in.Body)
			if err != nil {
				return nil, a.fail(ctx, err)
			}
			return &bodyOut[wire.T006Credential]{Body: out}, nil
		})
}
