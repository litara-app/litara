package httpapi

import (
	"encoding/json"
	"net/http"
)

// OpenAPIJSON renders the generated OpenAPI document exactly as `ctl openapi` prints it. It needs no database.
func OpenAPIJSON() ([]byte, error) {
	api := RegisterAPI(http.NewServeMux(), APIDeps{})
	return json.MarshalIndent(api.OpenAPI(), "", "  ")
}
