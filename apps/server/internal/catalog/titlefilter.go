package catalog

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Limits on a filter tree (ADR-0085): a query is bounded in depth and in rule count, so its cost is bounded.
const (
	MaxFilterDepth = 3
	MaxFilterRules = 30
	maxListValues  = 20
	maxValueLen    = 512
)

type fieldKind int

const (
	kindText fieldKind = iota
	kindAuthors
	kindArray // language, format, library
	kindStatus
	kindNumber
	kindDate
	kindFlag
)

type fieldSpec struct {
	kind fieldKind
	// col is the SQL expression over the title_rows alias "b" this field reads.
	col string
	ops []string
}

var (
	textOps  = []string{"is", "is_not", "contains", "not_contains", "is_empty", "not_empty"}
	listOps  = []string{"is", "is_not"}
	emptyOps = []string{"is", "is_not", "is_empty", "not_empty"}
	numOps   = []string{"is", "is_not", "gt", "gte", "lt", "lte", "between", "is_empty", "not_empty"}
	dateOps  = []string{"before", "after", "between"}
	flagOps  = []string{"is"}
)

// filterFields is the catalogue the validator, the SQL compiler and the web builder share. A rule never reaches SQL by
// field name from the request: the name only selects an entry here.
var filterFields = map[string]fieldSpec{
	"title":           {kindText, "b.title", textOps},
	"author":          {kindAuthors, "b.authors", textOps},
	"series":          {kindText, "COALESCE(b.series_name, '')", textOps},
	"publisher":       {kindText, "COALESCE(b.publisher, '')", textOps},
	"language":        {kindArray, "b.languages", emptyOps},
	"format":          {kindArray, "b.formats", emptyOps},
	"library":         {kindArray, "b.library_ids", listOps},
	"status":          {kindStatus, "b.status", listOps},
	"rating":          {kindNumber, "b.rating_halves", numOps},
	"published":       {kindNumber, "NULLIF(substring(b.published from '^\\d{4}'), '')::int", numOps},
	"pages":           {kindNumber, "b.page_count", numOps},
	"series_index":    {kindNumber, "b.series_index", numOps},
	"added":           {kindDate, "b.added_at", dateOps},
	"has_ebook":       {kindFlag, "(b.edition_count > 0)", flagOps},
	"has_audio":       {kindFlag, "(b.recording_count > 0)", flagOps},
	"has_description": {kindFlag, "b.has_description", flagOps},
}

type filterCompiler struct {
	args  []any
	rules int
}

// arg adds a bound parameter and returns its placeholder. Values are never written into the SQL text.
func (c *filterCompiler) arg(v any) string {
	c.args = append(c.args, v)
	return fmt.Sprintf("$%d", len(c.args))
}

func bad(format string, a ...any) error { return apperr.Validation(fmt.Sprintf(format, a...)) }

// compile turns a validated tree into a boolean SQL expression. A nil or empty tree matches everything.
func (c *filterCompiler) compile(n *wire.TitleFilter, depth int) (string, error) {
	if n == nil {
		return "TRUE", nil
	}
	switch n.Type {
	case "group":
		if depth > MaxFilterDepth {
			return "", bad("filters nest at most %d groups deep", MaxFilterDepth)
		}
		if n.Join != "AND" && n.Join != "OR" {
			return "", bad("a group needs join AND or OR")
		}
		var parts []string
		for i := range n.Rules {
			part, err := c.compile(&n.Rules[i], depth+1)
			if err != nil {
				return "", err
			}
			parts = append(parts, part)
		}
		if len(parts) == 0 {
			return "TRUE", nil
		}
		return "(" + strings.Join(parts, " "+n.Join+" ") + ")", nil
	case "rule":
		c.rules++
		if c.rules > MaxFilterRules {
			return "", bad("a filter holds at most %d rules", MaxFilterRules)
		}
		return c.rule(n)
	default:
		return "", bad("a filter node is a group or a rule")
	}
}

func asStrings(v any) ([]string, error) {
	switch x := v.(type) {
	case string:
		if x == "" || len(x) > maxValueLen {
			return nil, bad("a value is 1 to %d characters", maxValueLen)
		}
		return []string{x}, nil
	case []any:
		if len(x) == 0 || len(x) > maxListValues {
			return nil, bad("a list holds 1 to %d values", maxListValues)
		}
		out := make([]string, 0, len(x))
		for _, e := range x {
			s, ok := e.(string)
			if !ok || s == "" || len(s) > maxValueLen {
				return nil, bad("list values are strings of 1 to %d characters", maxValueLen)
			}
			out = append(out, s)
		}
		return out, nil
	case []string:
		return asStrings(toAny(x))
	}
	return nil, bad("this operator needs a text value")
}

func toAny(s []string) []any {
	out := make([]any, len(s))
	for i, v := range s {
		out[i] = v
	}
	return out
}

func lowered(in []string) []string {
	out := make([]string, len(in))
	for i, v := range in {
		out[i] = strings.ToLower(v)
	}
	return out
}

func asNumber(v any) (float64, error) {
	switch x := v.(type) {
	case float64:
		return x, nil
	case int:
		return float64(x), nil
	case int64:
		return float64(x), nil
	}
	return 0, bad("this operator needs a number")
}

func asDate(v any) (time.Time, error) {
	s, ok := v.(string)
	if !ok {
		return time.Time{}, bad("this operator needs a date as YYYY-MM-DD")
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}, bad("this operator needs a date as YYYY-MM-DD")
	}
	return t.UTC(), nil
}

func asBool(v any) (bool, error) {
	switch x := v.(type) {
	case bool:
		return x, nil
	case string:
		if x == "true" || x == "false" {
			return x == "true", nil
		}
	}
	return false, bad("this field needs true or false")
}

func allowed(ops []string, op string) bool {
	for _, o := range ops {
		if o == op {
			return true
		}
	}
	return false
}

func (c *filterCompiler) rule(n *wire.TitleFilter) (string, error) {
	spec, ok := filterFields[n.Field]
	if !ok {
		return "", bad("unknown filter field")
	}
	if !allowed(spec.ops, n.Operator) {
		return "", bad("operator %q is not valid for %s", n.Operator, n.Field)
	}
	negate := func(expr string) string { return "(NOT " + expr + ")" }
	switch spec.kind {
	case kindText, kindAuthors:
		return c.textRule(n, spec, negate)
	case kindArray, kindStatus:
		return c.listRule(n, spec, negate)
	case kindNumber:
		return c.numberRule(n, spec)
	case kindDate:
		return c.dateRule(n, spec)
	default: // flag
		v, err := asBool(n.Value)
		if err != nil {
			return "", err
		}
		if v {
			return spec.col, nil
		}
		return negate(spec.col), nil
	}
}

func (c *filterCompiler) textRule(n *wire.TitleFilter, spec fieldSpec, negate func(string) string) (string, error) {
	text := spec.col
	if spec.kind == kindAuthors {
		text = "array_to_string(b.authors, chr(10))"
	}
	switch n.Operator {
	case "is", "is_not":
		vals, err := asStrings(n.Value)
		if err != nil {
			return "", err
		}
		p := c.arg(lowered(vals))
		expr := "(lower(" + text + ") = ANY(" + p + "::text[]))"
		if spec.kind == kindAuthors {
			expr = "EXISTS (SELECT 1 FROM unnest(b.authors) AS a(name) WHERE lower(a.name) = ANY(" + p + "::text[]))"
		}
		if n.Operator == "is_not" {
			return negate(expr), nil
		}
		return expr, nil
	case "contains", "not_contains":
		vals, err := asStrings(n.Value)
		if err != nil || len(vals) != 1 {
			return "", bad("contains takes one text value")
		}
		expr := "(position(lower(" + c.arg(vals[0]) + "::text) in lower(" + text + ")) > 0)"
		if n.Operator == "not_contains" {
			return negate(expr), nil
		}
		return expr, nil
	default: // is_empty, not_empty
		expr := "(" + text + " = '')"
		if spec.kind == kindAuthors {
			expr = "(cardinality(b.authors) = 0)"
		}
		if n.Operator == "not_empty" {
			return negate(expr), nil
		}
		return expr, nil
	}
}

func (c *filterCompiler) listRule(n *wire.TitleFilter, spec fieldSpec, negate func(string) string) (string, error) {
	if n.Operator == "is_empty" || n.Operator == "not_empty" {
		expr := "(cardinality(" + spec.col + ") = 0)"
		if n.Operator == "not_empty" {
			return negate(expr), nil
		}
		return expr, nil
	}
	vals, err := asStrings(n.Value)
	if err != nil {
		return "", err
	}
	lv := lowered(vals)
	switch n.Field {
	case "status":
		for _, v := range lv {
			if v != "unread" && v != "reading" && v != "finished" {
				return "", bad("status is unread, reading or finished")
			}
		}
	case "library":
		for _, v := range lv {
			if _, err := uuid.Parse(v); err != nil {
				return "", bad("library values are library IDs")
			}
		}
	}
	p := c.arg(lv)
	expr := "(" + spec.col + " = ANY(" + p + "::text[]))"
	if spec.kind == kindArray {
		expr = "EXISTS (SELECT 1 FROM unnest(" + spec.col + ") AS x(v) WHERE lower(x.v::text) = ANY(" + p + "::text[]))"
	}
	if n.Operator == "is_not" {
		return negate(expr), nil
	}
	return expr, nil
}

func (c *filterCompiler) numberRule(n *wire.TitleFilter, spec fieldSpec) (string, error) {
	col := spec.col
	if n.Operator == "is_empty" {
		return "(" + col + " IS NULL)", nil
	}
	if n.Operator == "not_empty" {
		return "(" + col + " IS NOT NULL)", nil
	}
	scale := 1.0
	if n.Field == "rating" {
		scale = 2 // the caller works in stars; the column holds halves
	}
	lo, err := asNumber(n.Value)
	if err != nil {
		return "", err
	}
	if n.Field == "rating" && (lo < 0.5 || lo > 5 || lo*2 != float64(int(lo*2))) {
		return "", bad("ratings are 0.5 to 5 stars in half steps")
	}
	pa := c.arg(lo * scale)
	switch n.Operator {
	case "is":
		return "(" + col + " = " + pa + "::double precision)", nil
	case "is_not":
		return "(" + col + " IS DISTINCT FROM " + pa + "::double precision)", nil
	case "gt":
		return "(" + col + " > " + pa + "::double precision)", nil
	case "gte":
		return "(" + col + " >= " + pa + "::double precision)", nil
	case "lt":
		return "(" + col + " < " + pa + "::double precision)", nil
	case "lte":
		return "(" + col + " <= " + pa + "::double precision)", nil
	default: // between
		hi, err := asNumber(n.ValueTo)
		if err != nil {
			return "", bad("between needs two numbers")
		}
		return "(" + col + " BETWEEN " + pa + "::double precision AND " + c.arg(hi*scale) + "::double precision)", nil
	}
}

func (c *filterCompiler) dateRule(n *wire.TitleFilter, spec fieldSpec) (string, error) {
	from, err := asDate(n.Value)
	if err != nil {
		return "", err
	}
	switch n.Operator {
	case "before":
		return "(" + spec.col + " < " + c.arg(from) + "::timestamptz)", nil
	case "after": // the whole named day is not "after" itself
		return "(" + spec.col + " >= " + c.arg(from.AddDate(0, 0, 1)) + "::timestamptz)", nil
	default: // between, both days included
		to, err := asDate(n.ValueTo)
		if err != nil {
			return "", bad("between needs two dates")
		}
		return "(" + spec.col + " >= " + c.arg(from) + "::timestamptz AND " + spec.col + " < " + c.arg(to.AddDate(0, 0, 1)) + "::timestamptz)", nil
	}
}
