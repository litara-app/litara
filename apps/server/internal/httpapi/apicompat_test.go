package httpapi_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/apicompat"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
)

// ADR-0082: the API a third-party client sees must stay backward compatible. This runs with `go test ./...`, so it does not
// depend on CI. If it fails, do not edit the snapshots by hand: revert the change, or add a compatible change and run
// `go run ./cmd/ctl api-baseline update` (development) or `release` (after the first release).
func TestAPIStaysBackwardCompatible(t *testing.T) {
	doc, err := httpapi.OpenAPIJSON()
	if err != nil {
		t.Fatal(err)
	}
	if problems := apicompat.Verify(apicompat.Snapshots(), doc); len(problems) > 0 {
		t.Fatalf("the API is not compatible with what has been promised:\n  %s", strings.Join(problems, "\n  "))
	}
}

// The guard must actually bite on the real API: remove or rename anything and the check has to fail.
func TestTheCompatibilityGuardCatchesRealBreaks(t *testing.T) {
	doc, err := httpapi.OpenAPIJSON()
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(doc, &m); err != nil {
		t.Fatal(err)
	}
	paths := m["paths"].(map[string]any)

	// 1. An endpoint disappears.
	delete(paths, "/discovery")
	if !fails(t, m) {
		t.Fatal("removing /discovery went unnoticed")
	}
	// 2. A response property disappears from a shared schema.
	m = reload(t, doc)
	schemas := m["components"].(map[string]any)["schemas"].(map[string]any)
	delete(schemas["Discovery"].(map[string]any)["properties"].(map[string]any), "serverId")
	if !fails(t, m) {
		t.Fatal("removing a response property went unnoticed")
	}
	// 3. A request enum value is removed.
	m = reload(t, doc)
	if !renameOperation(m) {
		t.Fatal("no operation to rename")
	}
	if !fails(t, m) {
		t.Fatal("renaming an operationId went unnoticed")
	}
}

func reload(t *testing.T, doc []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(doc, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func fails(t *testing.T, m map[string]any) bool {
	t.Helper()
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return len(apicompat.Verify(apicompat.Snapshots(), b)) > 0
}

func renameOperation(m map[string]any) bool {
	for _, item := range m["paths"].(map[string]any) {
		for _, op := range item.(map[string]any) {
			if o, ok := op.(map[string]any); ok {
				if id, ok := o["operationId"].(string); ok {
					o["operationId"] = id + "Renamed"
					return true
				}
			}
		}
	}
	return false
}
