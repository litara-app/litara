package httpapi_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/google/uuid"
)

// The repair responses are additive T003 behavior; these helpers check real responses against the
// committed contracts/t003/openapi.json so the documentation cannot drift from what the server sends.

func t003Schema(t *testing.T, name string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "t003", "openapi.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Components struct {
			Schemas map[string]map[string]any `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	s, ok := doc.Components.Schemas[name]
	if !ok {
		t.Fatalf("contract has no schema %s", name)
	}
	return s
}

// requireDeclared fails when body carries a member the contract schema does not declare, and checks the
// repair-specific member's shape (UUID items, at most 100).
func requireDeclared(t *testing.T, schema string, body map[string]any) {
	t.Helper()
	props, _ := t003Schema(t, schema)["properties"].(map[string]any)
	for k := range body {
		if _, ok := props[k]; !ok {
			t.Errorf("response member %q is not declared by contracts/t003 %s", k, schema)
		}
	}
	if ids, ok := body["successorRecordingIds"].([]any); ok {
		if len(ids) > 100 {
			t.Errorf("successorRecordingIds has %d items, contract allows 100", len(ids))
		}
		for _, id := range ids {
			if s, _ := id.(string); uuid.Validate(s) != nil {
				t.Errorf("successorRecordingIds item %v is not a UUID", id)
			}
		}
	}
}

// requireEnum fails when value is not in the contract's enum for schema.property.
func requireEnum(t *testing.T, schema, property, value string) {
	t.Helper()
	p, _ := t003Schema(t, schema)["properties"].(map[string]any)[property].(map[string]any)
	var allowed []string
	for _, v := range p["enum"].([]any) {
		allowed = append(allowed, v.(string))
	}
	if !slices.Contains(allowed, value) {
		t.Errorf("%s.%s value %q is not in the contract enum %v", schema, property, value, allowed)
	}
}
