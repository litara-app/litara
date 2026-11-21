package apicompat

import (
	"encoding/json"
	"strings"
	"testing"
)

// base is a small API that exercises every part of the comparison.
const base = `{
 "openapi": "3.1.0",
 "info": {"title": "t", "version": "1.0.0"},
 "paths": {
  "/things/{id}": {
   "get": {
    "operationId": "getThing",
    "parameters": [
     {"name": "id", "in": "path", "required": true, "schema": {"type": "string", "format": "uuid"}},
     {"name": "q", "in": "query", "schema": {"type": "string", "maxLength": 50}}
    ],
    "security": [{"bearer": []}, {"browserSession": []}],
    "responses": {
     "200": {"description": "ok", "headers": {"X-Request-Id": {"schema": {"type": "string"}}},
             "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Thing"}}}},
     "404": {"description": "no", "content": {"application/problem+json": {"schema": {"$ref": "#/components/schemas/Problem"}}}}
    }
   }
  },
  "/things": {
   "post": {
    "operationId": "makeThing",
    "security": [{"bearer": [], "csrf": []}],
    "requestBody": {"required": true, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/NewThing"}}}},
    "responses": {"201": {"description": "made", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Thing"}}}}}
   }
  },
  "/public": {"get": {"operationId": "open", "responses": {"200": {"description": "ok"}}}}
 },
 "components": {"schemas": {
  "Thing": {"type": "object", "required": ["id", "name"], "properties": {
    "id": {"type": "string", "format": "uuid"},
    "name": {"type": "string", "maxLength": 100},
    "status": {"type": "string", "enum": ["x", "y"]},
    "count": {"type": "integer", "minimum": 0, "maximum": 100},
    "tags": {"type": "array", "items": {"type": "string"}},
    "note": {"type": ["string", "null"]}}},
  "NewThing": {"type": "object", "additionalProperties": false, "required": ["name"], "properties": {
    "name": {"type": "string", "minLength": 1, "maxLength": 10},
    "kind": {"type": "string", "enum": ["a", "b"]},
    "size": {"type": "integer", "minimum": 1, "maximum": 5},
    "pick": {"oneOf": [{"$ref": "#/components/schemas/ByName"}, {"$ref": "#/components/schemas/ByID"}]}}},
  "ByName": {"type": "object", "properties": {"name": {"type": "string"}}},
  "ByID": {"type": "object", "properties": {"id": {"type": "string"}}},
  "Problem": {"type": "object", "properties": {"code": {"type": "string"}}}
 }}
}`

type edit func(doc obj)

func variant(t *testing.T, e edit) []byte {
	t.Helper()
	var doc obj
	if err := json.Unmarshal([]byte(base), &doc); err != nil {
		t.Fatal(err)
	}
	e(doc)
	b, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func schemas(d obj) obj  { return asObj(asObj(d["components"])["schemas"]) }
func thing(d obj) obj    { return asObj(asObj(schemas(d)["Thing"])["properties"]) }
func newThing(d obj) obj { return asObj(asObj(schemas(d)["NewThing"])["properties"]) }
func getOp(d obj) obj    { return asObj(asObj(asObj(d["paths"])["/things/{id}"])["get"]) }
func postOp(d obj) obj   { return asObj(asObj(asObj(d["paths"])["/things"])["post"]) }
func params(d obj) []any { return asList(getOp(d)["parameters"]) }
func ok200(d obj) obj    { return asObj(asObj(getOp(d)["responses"])["200"]) }
func ruleNames(c []Change) string {
	var out []string
	for _, x := range c {
		out = append(out, x.Rule)
	}
	return strings.Join(out, ",")
}

func TestIdenticalDocumentsAreCompatible(t *testing.T) {
	c, err := Diff([]byte(base), []byte(base))
	if err != nil || len(c) != 0 {
		t.Fatalf("%v %v", c, err)
	}
}

func TestBreakingChangesAreCaught(t *testing.T) {
	for name, tc := range map[string]struct {
		rule string
		e    edit
	}{
		"operation removed":   {"operation-removed", func(d obj) { delete(asObj(d["paths"]), "/public") }},
		"method removed":      {"operation-removed", func(d obj) { delete(asObj(asObj(d["paths"])["/things"]), "post") }},
		"operationId renamed": {"operation-id-changed", func(d obj) { getOp(d)["operationId"] = "fetchThing" }},
		"parameter removed":   {"parameter-removed", func(d obj) { getOp(d)["parameters"] = params(d)[:1] }},
		"required parameter added": {"required-parameter-added", func(d obj) {
			getOp(d)["parameters"] = append(params(d), obj{"name": "must", "in": "query", "required": true, "schema": obj{"type": "string"}})
		}},
		"parameter now required":    {"parameter-now-required", func(d obj) { asObj(params(d)[1])["required"] = true }},
		"parameter type changed":    {"type-changed", func(d obj) { asObj(asObj(params(d)[1])["schema"])["type"] = "integer" }},
		"parameter limit tightened": {"request-maxLength-tightened", func(d obj) { asObj(asObj(params(d)[1])["schema"])["maxLength"] = 10.0 }},
		"request property removed":  {"request-property-removed", func(d obj) { delete(newThing(d), "size") }},
		"required request prop added": {"required-request-property-added", func(d obj) {
			newThing(d)["owner"] = obj{"type": "string"}
			s := asObj(schemas(d)["NewThing"])
			s["required"] = append(asList(s["required"]), "owner")
		}},
		"request prop now required": {"request-property-now-required", func(d obj) {
			s := asObj(schemas(d)["NewThing"])
			s["required"] = append(asList(s["required"]), "kind")
		}},
		"request enum value removed": {"request-enum-value-removed", func(d obj) { asObj(newThing(d)["kind"])["enum"] = []any{"a"} }},
		"request enum added":         {"request-enum-added", func(d obj) { asObj(newThing(d)["name"])["enum"] = []any{"x"} }},
		"request maxLength lowered":  {"request-maxLength-tightened", func(d obj) { asObj(newThing(d)["name"])["maxLength"] = 5.0 }},
		"request minLength raised":   {"request-minLength-tightened", func(d obj) { asObj(newThing(d)["name"])["minLength"] = 3.0 }},
		"request minimum raised":     {"request-minimum-tightened", func(d obj) { asObj(newThing(d)["size"])["minimum"] = 2.0 }},
		"request limit added": {"request-maxItems-tightened", func(d obj) {
			newThing(d)["list"] = nil
			delete(newThing(d), "list")
			asObj(newThing(d)["name"])["maxItems"] = 3.0
		}},
		"request pattern added":        {"pattern-changed", func(d obj) { asObj(newThing(d)["name"])["pattern"] = "^[a-z]+$" }},
		"request type changed":         {"type-changed", func(d obj) { asObj(newThing(d)["size"])["type"] = "string" }},
		"request format added":         {"format-changed", func(d obj) { asObj(newThing(d)["name"])["format"] = "uuid" }},
		"request body removed":         {"request-body-removed", func(d obj) { delete(postOp(d), "requestBody") }},
		"request media type removed":   {"media-type-removed", func(d obj) { asObj(postOp(d)["requestBody"])["content"] = obj{} }},
		"request oneOf branch removed": {"request-oneOf-branch-removed", func(d obj) { asObj(newThing(d)["pick"])["oneOf"] = []any{obj{"$ref": "#/components/schemas/ByName"}} }},
		"response property removed":    {"response-property-removed", func(d obj) { delete(thing(d), "status") }},
		"response type changed":        {"type-changed", func(d obj) { asObj(thing(d)["count"])["type"] = "string" }},
		"response nullable added":      {"type-changed", func(d obj) { asObj(thing(d)["name"])["type"] = []any{"string", "null"} }},
		"response prop now optional":   {"response-property-now-optional", func(d obj) { asObj(schemas(d)["Thing"])["required"] = []any{"id"} }},
		"response maxLength loosened":  {"response-maxLength-loosened", func(d obj) { asObj(thing(d)["name"])["maxLength"] = 500.0 }},
		"response maximum loosened":    {"response-maximum-loosened", func(d obj) { asObj(thing(d)["count"])["maximum"] = 1000.0 }},
		"response limit removed":       {"response-minimum-loosened", func(d obj) { delete(asObj(thing(d)["count"]), "minimum") }},
		"response format changed":      {"format-changed", func(d obj) { asObj(thing(d)["id"])["format"] = "uri" }},
		"response items changed":       {"type-changed", func(d obj) { asObj(asObj(thing(d)["tags"])["items"])["type"] = "integer" }},
		"success response removed":     {"success-response-removed", func(d obj) { delete(asObj(getOp(d)["responses"]), "200") }},
		"response body removed":        {"response-body-removed", func(d obj) { delete(ok200(d), "content") }},
		"response media type removed":  {"media-type-removed", func(d obj) { ok200(d)["content"] = obj{"text/plain": obj{"schema": obj{"type": "string"}}} }},
		"response header removed":      {"response-header-removed", func(d obj) { delete(ok200(d), "headers") }},
		"error body changed":           {"response-property-removed", func(d obj) { delete(asObj(asObj(schemas(d)["Problem"])["properties"]), "code") }},
		"response oneOf added":         {"response-oneOf-added", func(d obj) { asObj(thing(d)["name"])["oneOf"] = []any{obj{"type": "string"}} }},
		"security tightened":           {"security-tightened", func(d obj) { getOp(d)["security"] = []any{obj{"bearer": []any{}, "csrf": []any{}}} }},
		"security alternative removed": {"security-tightened", func(d obj) { getOp(d)["security"] = []any{obj{"bearer": []any{}}} }},
		"public made private": {"security-added", func(d obj) {
			asObj(asObj(asObj(d["paths"])["/public"])["get"])["security"] = []any{obj{"bearer": []any{}}}
		}},
	} {
		t.Run(name, func(t *testing.T) {
			c, err := Diff([]byte(base), variant(t, tc.e))
			if err != nil {
				t.Fatal(err)
			}
			for _, x := range Breaks(c) {
				if x.Rule == tc.rule {
					return
				}
			}
			t.Fatalf("expected a breaking %q, got: %v", tc.rule, c)
		})
	}
}

func TestAdditiveChangesAreNotBreaking(t *testing.T) {
	for name, tc := range map[string]struct {
		rule string
		e    edit
	}{
		"operation added": {"operation-added", func(d obj) {
			asObj(d["paths"])["/new"] = obj{"get": obj{"operationId": "newOne", "responses": obj{"200": obj{"description": "ok"}}}}
		}},
		"optional parameter added": {"optional-parameter-added", func(d obj) {
			getOp(d)["parameters"] = append(params(d), obj{"name": "extra", "in": "query", "schema": obj{"type": "string"}})
		}},
		"optional request property added": {"optional-request-property-added", func(d obj) { newThing(d)["extra"] = obj{"type": "string"} }},
		"request enum value added":        {"request-enum-value-added", func(d obj) { asObj(newThing(d)["kind"])["enum"] = []any{"a", "b", "c"} }},
		"request maxLength raised":        {"", func(d obj) { asObj(newThing(d)["name"])["maxLength"] = 20.0 }},
		"request minimum lowered":         {"", func(d obj) { asObj(newThing(d)["size"])["minimum"] = 0.0 }},
		"request type widened":            {"", func(d obj) { asObj(newThing(d)["name"])["type"] = []any{"string", "null"} }},
		"request limit removed":           {"", func(d obj) { delete(asObj(newThing(d)["name"]), "maxLength") }},
		"request format removed":          {"", func(d obj) { delete(asObj(asObj(params(d)[0])["schema"]), "format") }},
		"request oneOf branch added": {"", func(d obj) {
			p := asObj(newThing(d)["pick"])
			p["oneOf"] = append(asList(p["oneOf"]), obj{"type": "string"})
		}},
		"response property added":   {"response-property-added", func(d obj) { thing(d)["extra"] = obj{"type": "string"} }},
		"response enum value added": {"response-enum-value-added", func(d obj) { asObj(thing(d)["status"])["enum"] = []any{"x", "y", "z"} }},
		"response pattern added":    {"", func(d obj) { asObj(thing(d)["name"])["pattern"] = "^[A-Za-z]" }},
		"request pattern removed":   {"", func(d obj) { delete(asObj(newThing(d)["name"]), "pattern") }},
		"response limit tightened":  {"", func(d obj) { asObj(thing(d)["name"])["maxLength"] = 50.0 }},
		"response made required":    {"", func(d obj) { asObj(schemas(d)["Thing"])["required"] = []any{"id", "name", "status"} }},
		"response type narrowed":    {"", func(d obj) { asObj(thing(d)["note"])["type"] = "string" }},
		"response status added":     {"response-added", func(d obj) { asObj(getOp(d)["responses"])["429"] = obj{"description": "slow down"} }},
		"error status removed":      {"", func(d obj) { delete(asObj(getOp(d)["responses"]), "404") }},
		"media type added":          {"media-type-added", func(d obj) { asObj(ok200(d)["content"])["text/csv"] = obj{"schema": obj{"type": "string"}} }},
		"security relaxed":          {"security-relaxed", func(d obj) { getOp(d)["security"] = []any{} }},
		"security alternative added": {"", func(d obj) {
			getOp(d)["security"] = append(asList(getOp(d)["security"]), obj{"other": []any{}})
		}},
		"documentation changed": {"", func(d obj) {
			getOp(d)["summary"] = "new words"
			d["info"] = obj{"title": "renamed", "version": "1.1.0"}
		}},
	} {
		t.Run(name, func(t *testing.T) {
			c, err := Diff([]byte(base), variant(t, tc.e))
			if err != nil {
				t.Fatal(err)
			}
			if b := Breaks(c); len(b) > 0 {
				t.Fatalf("flagged as breaking: %v", b)
			}
			if tc.rule == "" {
				return
			}
			for _, x := range c {
				if x.Rule == tc.rule {
					return
				}
			}
			t.Fatalf("expected an additive %q, got %v (%s)", tc.rule, c, ruleNames(c))
		})
	}
}

func TestSchemaReferencesAreFollowed(t *testing.T) {
	// A change deep inside a shared component must be found from every operation that reaches it.
	c, err := Diff([]byte(base), variant(t, func(d obj) { delete(asObj(asObj(schemas(d)["ByName"])["properties"]), "name") }))
	if err != nil {
		t.Fatal(err)
	}
	if len(Breaks(c)) == 0 {
		t.Fatal("a property removed from a referenced request schema was not noticed")
	}
}

func TestChangeIDsAreStableForWaivers(t *testing.T) {
	c, _ := Diff([]byte(base), variant(t, func(d obj) { delete(asObj(d["paths"]), "/public") }))
	if len(c) != 1 || c[0].ID() != "operation-removed GET /public" {
		t.Fatalf("%v", c)
	}
}

// Some breaks only exist in the other direction: the older document was the more permissive one.
func TestChangesThatNarrowWhatARequestAccepts(t *testing.T) {
	for name, tc := range map[string]struct {
		rule string
		old  edit
	}{
		"object closed":            {"request-object-closed", func(d obj) { delete(asObj(schemas(d)["NewThing"]), "additionalProperties") }},
		"body became required":     {"request-body-now-required", func(d obj) { asObj(postOp(d)["requestBody"])["required"] = false }},
		"type narrowed":            {"type-changed", func(d obj) { asObj(newThing(d)["name"])["type"] = []any{"string", "null"} }},
		"response pattern removed": {"pattern-changed", func(d obj) { asObj(thing(d)["id"])["pattern"] = "^x" }},
		"enum added":               {"request-enum-added", func(d obj) { delete(asObj(newThing(d)["kind"]), "enum") }},
	} {
		t.Run(name, func(t *testing.T) {
			c, err := Diff(variant(t, tc.old), []byte(base))
			if err != nil {
				t.Fatal(err)
			}
			for _, x := range Breaks(c) {
				if x.Rule == tc.rule {
					return
				}
			}
			t.Fatalf("expected a breaking %q, got: %v", tc.rule, c)
		})
	}
}
