// Package apicompat decides whether one version of the OpenAPI document is backward compatible with an earlier one
// (ADR-0082). It understands requests and responses separately, because the same change is safe in one direction and a
// break in the other: a server may accept more than before and may promise less than before, never the reverse.
//
// The check is deliberately conservative. Anything it cannot prove compatible is reported as breaking.
package apicompat

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Severity of a change to the API surface.
type Severity string

const (
	// Breaking changes can make a client written for the older document fail.
	Breaking Severity = "breaking"
	// Additive changes cannot.
	Additive Severity = "additive"
)

// Change is one difference between two documents. ID is stable and is what a waiver names. Where is the place in the API,
// except for a changed schema name, where it is the pair of names.
type Change struct {
	Severity Severity `json:"severity"`
	Rule     string   `json:"rule"`
	Where    string   `json:"where"`
	Detail   string   `json:"detail,omitempty"`
}

// ID identifies the change for waivers.
func (c Change) ID() string { return c.Rule + " " + c.Where }

func (c Change) String() string {
	if c.Detail == "" {
		return fmt.Sprintf("%s: %s", c.Severity, c.ID())
	}
	return fmt.Sprintf("%s: %s (%s)", c.Severity, c.ID(), c.Detail)
}

type obj = map[string]any

type dir int

const (
	request dir = iota
	response
)

type differ struct {
	oldDoc, newDoc obj
	changes        []Change
	seen           map[string]bool
	// ignoreNames compares shapes only. It is set on a probe that looks for the union branch a renamed one came from.
	ignoreNames bool
}

// Diff compares two OpenAPI 3.x documents (JSON) and lists every difference that affects a client, breaking ones first.
func Diff(oldJSON, newJSON []byte) ([]Change, error) {
	var o, n obj
	if err := json.Unmarshal(oldJSON, &o); err != nil {
		return nil, fmt.Errorf("old document: %w", err)
	}
	if err := json.Unmarshal(newJSON, &n); err != nil {
		return nil, fmt.Errorf("new document: %w", err)
	}
	d := &differ{oldDoc: o, newDoc: n, seen: map[string]bool{}}
	d.paths()
	sort.SliceStable(d.changes, func(i, j int) bool {
		if d.changes[i].Severity != d.changes[j].Severity {
			return d.changes[i].Severity == Breaking
		}
		return d.changes[i].ID() < d.changes[j].ID()
	})
	return d.changes, nil
}

// Breaks returns only the breaking changes.
func Breaks(changes []Change) []Change {
	var out []Change
	for _, c := range changes {
		if c.Severity == Breaking {
			out = append(out, c)
		}
	}
	return out
}

func (d *differ) add(sev Severity, rule, where, detail string) {
	c := Change{sev, rule, where, detail}
	if d.seen[c.ID()] {
		return
	}
	d.seen[c.ID()] = true
	d.changes = append(d.changes, c)
}

func (d *differ) brk(rule, where, detail string) { d.add(Breaking, rule, where, detail) }
func (d *differ) ok(rule, where, detail string)  { d.add(Additive, rule, where, detail) }

// ---- document walking ------------------------------------------------------------------------------------------------

func asObj(v any) obj {
	m, _ := v.(obj)
	return m
}

func asList(v any) []any {
	l, _ := v.([]any)
	return l
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func sortedKeys(m obj) []string {
	k := make([]string, 0, len(m))
	for key := range m {
		k = append(k, key)
	}
	sort.Strings(k)
	return k
}

var methods = []string{"get", "put", "post", "delete", "patch", "head", "options", "trace"}

// resolve follows $ref chains inside doc. A reference that does not resolve is returned as a marker so two such references
// compare equal only when their targets are named identically.
func resolve(doc obj, node any) obj {
	m := asObj(node)
	for i := 0; i < 32 && m != nil; i++ {
		ref := str(m["$ref"])
		if ref == "" {
			return m
		}
		if !strings.HasPrefix(ref, "#/") {
			return obj{"x-unresolved": ref}
		}
		var cur any = doc
		for _, part := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
			part = strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
			next, ok := asObj(cur)[part]
			if !ok {
				return obj{"x-unresolved": ref}
			}
			cur = next
		}
		m = asObj(cur)
	}
	return m
}

func (d *differ) paths() {
	op, np := asObj(d.oldDoc["paths"]), asObj(d.newDoc["paths"])
	for _, path := range sortedKeys(op) {
		for _, m := range methods {
			old := asObj(asObj(op[path])[m])
			if old == nil {
				continue
			}
			where := strings.ToUpper(m) + " " + path
			cur := asObj(asObj(np[path])[m])
			if cur == nil {
				d.brk("operation-removed", where, "")
				continue
			}
			d.operation(where, path, old, cur)
		}
	}
	for _, path := range sortedKeys(np) {
		for _, m := range methods {
			if asObj(asObj(np[path])[m]) != nil && asObj(asObj(op[path])[m]) == nil {
				d.ok("operation-added", strings.ToUpper(m)+" "+path, "")
			}
		}
	}
}

func (d *differ) operation(where, path string, old, cur obj) {
	if a, b := str(old["operationId"]), str(cur["operationId"]); a != b {
		d.brk("operation-id-changed", where, a+" -> "+b)
	}
	d.parameters(where, path, old, cur)
	d.body(where, old, cur)
	d.responses(where, old, cur)
	d.security(where, old, cur)
}

func (d *differ) paramKey(p obj) string { return str(p["in"]) + ":" + str(p["name"]) }

func (d *differ) paramList(doc obj, path obj, op obj) map[string]obj {
	out := map[string]obj{}
	for _, src := range []any{path["parameters"], op["parameters"]} {
		for _, raw := range asList(src) {
			p := resolve(doc, raw)
			if p != nil {
				out[d.paramKey(p)] = p
			}
		}
	}
	return out
}

func (d *differ) parameters(where, path string, old, cur obj) {
	oldPathItem, newPathItem := asObj(asObj(d.oldDoc["paths"])[path]), asObj(asObj(d.newDoc["paths"])[path])
	op, np := d.paramList(d.oldDoc, oldPathItem, old), d.paramList(d.newDoc, newPathItem, cur)
	for _, k := range sortedKeys(toObj(op)) {
		o := op[k]
		n, ok := np[k]
		loc := where + " parameter " + k
		if !ok {
			d.brk("parameter-removed", loc, "")
			continue
		}
		if o["required"] != true && n["required"] == true {
			d.brk("parameter-now-required", loc, "")
		}
		d.schema(loc, asObj(o["schema"]), asObj(n["schema"]), d.oldDoc, d.newDoc, request, 0)
	}
	for _, k := range sortedKeys(toObj(np)) {
		if _, ok := op[k]; ok {
			continue
		}
		if np[k]["required"] == true {
			d.brk("required-parameter-added", where+" parameter "+k, "")
		} else {
			d.ok("optional-parameter-added", where+" parameter "+k, "")
		}
	}
}

func toObj(m map[string]obj) obj {
	out := obj{}
	for k := range m {
		out[k] = nil
	}
	return out
}

func (d *differ) body(where string, old, cur obj) {
	ob, nb := resolve(d.oldDoc, old["requestBody"]), resolve(d.newDoc, cur["requestBody"])
	loc := where + " request body"
	switch {
	case ob == nil && nb == nil:
		return
	case ob == nil:
		if nb["required"] == true {
			d.brk("required-request-body-added", loc, "")
		} else {
			d.ok("optional-request-body-added", loc, "")
		}
		return
	case nb == nil:
		d.brk("request-body-removed", loc, "")
		return
	}
	if ob["required"] != true && nb["required"] == true {
		d.brk("request-body-now-required", loc, "")
	}
	d.content(loc, asObj(ob["content"]), asObj(nb["content"]), request)
}

// content compares media types. A request may gain accepted types; a response must keep every type it offered.
func (d *differ) content(loc string, oc, nc obj, dr dir) {
	for _, mt := range sortedKeys(oc) {
		n, ok := nc[mt]
		if !ok {
			d.brk("media-type-removed", loc+" "+mt, "")
			continue
		}
		d.schema(loc+" "+mt, asObj(asObj(oc[mt])["schema"]), asObj(asObj(n)["schema"]), d.oldDoc, d.newDoc, dr, 0)
	}
	for _, mt := range sortedKeys(nc) {
		if _, ok := oc[mt]; !ok {
			d.ok("media-type-added", loc+" "+mt, "")
		}
	}
}

func isSuccess(code string) bool { return strings.HasPrefix(code, "2") }

func (d *differ) responses(where string, old, cur obj) {
	or, nr := asObj(old["responses"]), asObj(cur["responses"])
	for _, code := range sortedKeys(or) {
		loc := where + " response " + code
		nraw, ok := nr[code]
		if !ok {
			if isSuccess(code) {
				d.brk("success-response-removed", loc, "")
			}
			continue
		}
		o, n := resolve(d.oldDoc, or[code]), resolve(d.newDoc, nraw)
		d.content(loc, asObj(o["content"]), asObj(n["content"]), response)
		if len(asObj(o["content"])) > 0 && len(asObj(n["content"])) == 0 {
			d.brk("response-body-removed", loc, "")
		}
		d.headers(loc, o, n)
	}
	for _, code := range sortedKeys(nr) {
		if _, ok := or[code]; !ok {
			d.ok("response-added", where+" response "+code, "")
		}
	}
}

// headers: a response header a client could read must stay.
func (d *differ) headers(loc string, o, n obj) {
	oh, nh := asObj(o["headers"]), asObj(n["headers"])
	for _, h := range sortedKeys(oh) {
		if _, ok := nh[h]; !ok {
			d.brk("response-header-removed", loc+" header "+h, "")
			continue
		}
		d.name(loc+" header "+h, asObj(asObj(oh[h])["schema"]), asObj(asObj(nh[h])["schema"]))
	}
}

// ---- security --------------------------------------------------------------------------------------------------------

func (d *differ) alternatives(doc obj, op obj) [][]string {
	sec, has := op["security"]
	if !has {
		sec = doc["security"]
	}
	var out [][]string
	for _, alt := range asList(sec) {
		names := sortedKeys(asObj(alt))
		out = append(out, names)
	}
	return out
}

// security: every way a client could authenticate before must still work, with no extra requirement.
func (d *differ) security(where string, old, cur obj) {
	oa, na := d.alternatives(d.oldDoc, old), d.alternatives(d.newDoc, cur)
	if len(oa) == 0 {
		if len(na) > 0 {
			d.brk("security-added", where, "a public operation now requires "+strings.Join(na[0], "+"))
		}
		return
	}
	if len(na) == 0 {
		d.ok("security-relaxed", where, "no authentication required any more")
		return
	}
	for _, o := range oa {
		accepted := false
		for _, n := range na {
			if subset(n, o) {
				accepted = true
				break
			}
		}
		if !accepted {
			d.brk("security-tightened", where, "no longer accepts "+strings.Join(o, "+"))
		}
	}
}

func subset(a, b []string) bool {
	set := map[string]bool{}
	for _, x := range b {
		set[x] = true
	}
	for _, x := range a {
		if !set[x] {
			return false
		}
	}
	return true
}

// ---- schemas ---------------------------------------------------------------------------------------------------------

func typeSet(s obj) map[string]bool {
	out := map[string]bool{}
	switch t := s["type"].(type) {
	case string:
		out[t] = true
	case []any:
		for _, x := range t {
			out[str(x)] = true
		}
	}
	if s["nullable"] == true {
		out["null"] = true
	}
	return out
}

func subsetOf(a, b map[string]bool) bool {
	for k := range a {
		if !b[k] {
			return false
		}
	}
	return true
}

func joinSet(m map[string]bool) string {
	k := make([]string, 0, len(m))
	for x := range m {
		k = append(k, x)
	}
	sort.Strings(k)
	return strings.Join(k, "|")
}

func num(v any) (float64, bool) {
	f, ok := v.(float64)
	return f, ok
}

// inlineName stands for a schema written out where it is used, which has no published name.
const inlineName = "(inline)"

func schemaName(raw obj) string {
	if ref := str(raw["$ref"]); ref != "" {
		return strings.TrimPrefix(ref, "#/components/schemas/")
	}
	return inlineName
}

// name keeps the published schema name at a place a client already reaches (ADR-0108): generated clients name their types
// after it. The change is identified by the two names, not the place, so one rename is one change however widely the schema
// is used.
func (d *differ) name(where string, oraw, nraw obj) {
	if d.ignoreNames || oraw == nil {
		return
	}
	if a, b := schemaName(oraw), schemaName(nraw); a != b {
		d.brk("schema-name-changed", a+" -> "+b, "first at "+where)
	}
}

// schema compares two schemas in the direction they travel. Direction request means a client sends it to the server;
// response means the server sends it to a client.
func (d *differ) schema(where string, oraw, nraw obj, oldDoc, newDoc obj, dr dir, depth int) {
	if depth > 24 {
		return
	}
	d.name(where, oraw, nraw)
	o, n := resolve(oldDoc, oraw), resolve(newDoc, nraw)
	if o == nil && n == nil {
		return
	}
	if o == nil || n == nil {
		if o != nil && n == nil {
			// No schema constrains the value any more.
			if dr == response {
				d.brk("schema-removed", where, "")
			}
		}
		if o == nil && n != nil && dr == request {
			d.brk("schema-added-to-request", where, "")
		}
		return
	}
	if u := str(o["x-unresolved"]); u != "" || str(n["x-unresolved"]) != "" {
		if u != str(n["x-unresolved"]) {
			d.brk("schema-reference-changed", where, u+" -> "+str(n["x-unresolved"]))
		}
		return
	}

	// type
	ot, nt := typeSet(o), typeSet(n)
	// An empty set means "any type". A request may only get wider; a response may only get narrower.
	switch dr {
	case request:
		if (len(ot) == 0 && len(nt) > 0) || (len(ot) > 0 && len(nt) > 0 && !subsetOf(ot, nt)) {
			d.brk("type-changed", where, "any|"+joinSet(ot)+" -> "+joinSet(nt))
		}
	case response:
		if len(ot) > 0 && (len(nt) == 0 || !subsetOf(nt, ot)) {
			d.brk("type-changed", where, joinSet(ot)+" -> any|"+joinSet(nt))
		}
	}
	if of, nf := str(o["format"]), str(n["format"]); of != nf {
		switch {
		case dr == request && nf == "":
		case dr == response && of == "":
		default:
			d.brk("format-changed", where, of+" -> "+nf)
		}
	}
	d.enum(where, o, n, dr)
	d.bounds(where, o, n, dr)
	// A request may only accept more, so a new or different pattern narrows it; a response may only promise more, so a removed
	// or different pattern weakens the promise. Adding a pattern to a response, or dropping one from a request, is safe.
	if op, np := str(o["pattern"]), str(n["pattern"]); op != np {
		if (dr == request && np != "") || (dr == response && op != "") {
			d.brk("pattern-changed", where, op+" -> "+np)
		}
	}

	// objects
	d.object(where, o, n, oldDoc, newDoc, dr, depth)

	// arrays
	if oi, ni := asObj(o["items"]), asObj(n["items"]); oi != nil || ni != nil {
		d.schema(where+"[]", oi, ni, oldDoc, newDoc, dr, depth+1)
	}

	// compositions
	for _, kw := range []string{"oneOf", "anyOf", "allOf"} {
		d.composition(where, kw, asList(o[kw]), asList(n[kw]), nraw, oldDoc, newDoc, dr, depth)
	}
}

func (d *differ) enum(where string, o, n obj, dr dir) {
	oe, ne := asList(o["enum"]), asList(n["enum"])
	if len(oe) == 0 && len(ne) == 0 {
		return
	}
	in := func(list []any, v any) bool {
		b, _ := json.Marshal(v)
		for _, x := range list {
			c, _ := json.Marshal(x)
			if string(b) == string(c) {
				return true
			}
		}
		return false
	}
	switch dr {
	case request:
		switch {
		case len(oe) == 0 && len(ne) > 0:
			d.brk("request-enum-added", where, "")
		case len(ne) == 0:
		default:
			for _, v := range oe {
				if !in(ne, v) {
					d.brk("request-enum-value-removed", where, fmt.Sprint(v))
				}
			}
			for _, v := range ne {
				if !in(oe, v) {
					d.ok("request-enum-value-added", where, fmt.Sprint(v))
				}
			}
		}
	case response:
		switch {
		case len(oe) > 0 && len(ne) == 0:
			d.ok("response-enum-removed", where, "")
		default:
			for _, v := range ne {
				if len(oe) > 0 && !in(oe, v) {
					d.ok("response-enum-value-added", where, fmt.Sprint(v)+" (clients must tolerate unknown values)")
				}
			}
		}
	}
}

// bounds compares numeric and size limits. In a request, a tighter limit rejects input that used to work; in a response, a
// looser limit breaks a promise a client may rely on.
func (d *differ) bounds(where string, o, n obj, dr dir) {
	type limit struct {
		key      string
		lowerNew bool // true when a larger value is tighter (minimums), false when a smaller value is tighter (maximums)
	}
	for _, l := range []limit{{"minimum", true}, {"exclusiveMinimum", true}, {"minLength", true}, {"minItems", true}, {"minProperties", true},
		{"maximum", false}, {"exclusiveMaximum", false}, {"maxLength", false}, {"maxItems", false}, {"maxProperties", false}} {
		ov, ook := num(o[l.key])
		nv, nok := num(n[l.key])
		if !ook && !nok {
			continue
		}
		tighter := false
		looser := false
		switch {
		case !ook && nok:
			tighter = true
		case ook && !nok:
			looser = true
		case l.lowerNew && nv > ov, !l.lowerNew && nv < ov:
			tighter = true
		case l.lowerNew && nv < ov, !l.lowerNew && nv > ov:
			looser = true
		}
		if dr == request && tighter {
			d.brk("request-"+l.key+"-tightened", where, "")
		}
		if dr == response && looser {
			d.brk("response-"+l.key+"-loosened", where, "")
		}
	}
	if ov, ook := num(o["multipleOf"]); ook {
		if nv, nok := num(n["multipleOf"]); !nok || nv != ov {
			if dr == response {
				d.brk("response-multipleOf-changed", where, "")
			}
		}
	} else if _, nok := num(n["multipleOf"]); nok && dr == request {
		d.brk("request-multipleOf-added", where, "")
	}
}

func requiredSet(s obj) map[string]bool {
	out := map[string]bool{}
	for _, r := range asList(s["required"]) {
		out[str(r)] = true
	}
	return out
}

func (d *differ) object(where string, o, n obj, oldDoc, newDoc obj, dr dir, depth int) {
	op, np := asObj(o["properties"]), asObj(n["properties"])
	or, nr := requiredSet(o), requiredSet(n)
	for _, name := range sortedKeys(op) {
		loc := where + "." + name
		ns, ok := np[name]
		if !ok {
			if dr == request {
				d.brk("request-property-removed", loc, "")
			} else {
				d.brk("response-property-removed", loc, "")
			}
			continue
		}
		d.schema(loc, asObj(op[name]), asObj(ns), oldDoc, newDoc, dr, depth+1)
		switch dr {
		case request:
			if !or[name] && nr[name] {
				d.brk("request-property-now-required", loc, "")
			}
		case response:
			if or[name] && !nr[name] {
				d.brk("response-property-now-optional", loc, "")
			}
		}
	}
	for _, name := range sortedKeys(np) {
		if _, ok := op[name]; ok {
			continue
		}
		loc := where + "." + name
		switch {
		case dr == request && nr[name]:
			d.brk("required-request-property-added", loc, "")
		case dr == request:
			d.ok("optional-request-property-added", loc, "")
		default:
			d.ok("response-property-added", loc, "")
		}
	}
	for name := range nr {
		if _, had := op[name]; !had && dr == request {
			if _, defined := np[name]; !defined {
				d.brk("required-request-property-added", where+"."+name, "")
			}
		}
	}
	// A closed request object stops accepting properties it used to ignore.
	if dr == request {
		oa, na := o["additionalProperties"], n["additionalProperties"]
		if oa != false && na == false {
			d.brk("request-object-closed", where, "")
		}
	}
	if oa, na := asObj(o["additionalProperties"]), asObj(n["additionalProperties"]); oa != nil || na != nil {
		d.schema(where+".*", oa, na, oldDoc, newDoc, dr, depth+1)
	}
}

// composition: every alternative a request used to accept must still be accepted; every alternative a response may now send
// must already have been one it could send. A response that drops a oneOf or anyOf altogether must stay within one of the
// old alternatives. nraw is the whole new schema that carries nb.
func (d *differ) composition(where, kw string, ob, nb []any, nraw, oldDoc, newDoc obj, dr dir, depth int) {
	if len(ob) == 0 && len(nb) == 0 {
		return
	}
	compare := func(a, b any, direction dir, ignoreNames bool) []Change {
		probe := &differ{oldDoc: oldDoc, newDoc: newDoc, seen: map[string]bool{}, ignoreNames: ignoreNames}
		probe.schema("x", asObj(a), asObj(b), oldDoc, newDoc, direction, depth+1)
		return probe.changes
	}
	compatible := func(a, b any, direction dir) bool { return len(Breaks(compare(a, b, direction, d.ignoreNames))) == 0 }
	// renamed looks among n candidate pairs for two branches that differ only in names, and reports those, which says more
	// than a missing branch. The shapes must be identical: a merely compatible one, such as a smaller response shape, could
	// be an unrelated branch.
	renamed := func(n int, pair func(int) (a, b any), direction dir) bool {
		for i := range n {
			a, b := pair(i)
			if len(compare(a, b, direction, true)) > 0 {
				continue
			}
			names := Breaks(compare(a, b, direction, false))
			for _, c := range names {
				d.brk(c.Rule, c.Where, "first in a "+kw+" branch at "+where)
			}
			return len(names) > 0
		}
		return false
	}
	switch dr {
	case request:
		if len(ob) > 0 && len(nb) == 0 && kw != "allOf" {
			d.brk("request-"+kw+"-removed", where, "")
			return
		}
		for i, a := range ob {
			found := false
			for _, b := range nb {
				if compatible(a, b, request) {
					found = true
					break
				}
			}
			if !found && !renamed(len(nb), func(j int) (any, any) { return a, nb[j] }, request) {
				d.brk("request-"+kw+"-branch-removed", fmt.Sprintf("%s.%s[%d]", where, kw, i), "")
			}
		}
	case response:
		if len(nb) > 0 && len(ob) == 0 && kw != "allOf" {
			d.brk("response-"+kw+"-added", where, "")
			return
		}
		if len(ob) > 0 && len(nb) == 0 && kw != "allOf" {
			within := func(branch any) bool { return compatible(branch, nraw, response) }
			if !staysWithinBranch(ob, resolve(newDoc, nraw), oldDoc, newDoc, within) {
				d.brk("response-"+kw+"-removed", where, "the new schema is not provably one of the old alternatives")
			}
			return
		}
		for i, b := range nb {
			found := false
			for _, a := range ob {
				if compatible(a, b, response) {
					found = true
					break
				}
			}
			if !found && !renamed(len(ob), func(j int) (any, any) { return ob[j], b }, response) {
				d.brk("response-"+kw+"-branch-added", fmt.Sprintf("%s.%s[%d]", where, kw, i), "")
			}
		}
	}
}

// staysWithinBranch reports whether schema n, which replaces a response union, promises at least what one old branch did.
// within applies the ordinary response rules. They are not enough here, because they only compare what both sides declare:
// a branch's required names and enum or const values must also survive. And when the union told several object shapes apart,
// a closed branch must not turn into an open object or gain properties, or merging the shapes into one looser object would
// pass as "properties added".
func staysWithinBranch(branches []any, n, oldDoc, newDoc obj, within func(any) bool) bool {
	shapes := 0
	for _, raw := range branches {
		if len(asObj(resolve(oldDoc, asObj(raw))["properties"])) > 0 {
			shapes++
		}
	}
	for _, raw := range branches {
		b := resolve(oldDoc, asObj(raw))
		if !within(raw) || !subsetOf(requiredSet(b), requiredSet(n)) || !keepsValues(b, n) {
			continue
		}
		if shapes > 1 && b["additionalProperties"] == false {
			if n["additionalProperties"] != false || !subsetOf(propertySet(newDoc, n), propertySet(oldDoc, b)) {
				continue
			}
		}
		return true
	}
	return false
}

func propertySet(doc, s obj) map[string]bool {
	out := map[string]bool{}
	for name := range asObj(resolve(doc, s)["properties"]) {
		out[name] = true
	}
	return out
}

// keepsValues reports whether n allows no value outside the enum or const that b was limited to.
func keepsValues(b, n obj) bool {
	allowed := func(s obj) map[string]bool {
		var values []any
		if c, ok := s["const"]; ok {
			values = []any{c}
		} else if values = asList(s["enum"]); len(values) == 0 {
			return nil
		}
		out := map[string]bool{}
		for _, v := range values {
			j, _ := json.Marshal(v)
			out[string(j)] = true
		}
		return out
	}
	old := allowed(b)
	if old == nil {
		return true
	}
	cur := allowed(n)
	return cur != nil && subsetOf(cur, old)
}
