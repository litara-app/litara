// Package media implements byte-exact original-file delivery: one bounded,
// open or suffix range, strong validators, If-Range/If-Match/If-None-Match,
// exact 206/416 semantics and offsets above 4 GiB. It never transforms bytes.
package media

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Request carries the conditional/range headers of one GET or HEAD.
type Request struct {
	Method      string
	Range       string
	IfRange     string
	IfMatch     string
	IfNoneMatch string
}

// Plan is the decided response. Code is non-empty for problem statuses.
type Plan struct {
	Status       int
	Start, End   int64 // inclusive; valid for 200/206 with Length>0
	Length       int64
	ContentRange string
	Code         string // stable problem code for 400/412/416
	Detail       string
}

// Body reports whether bytes follow the headers.
func (p Plan) Body(method string) bool {
	return method != http.MethodHead && (p.Status == http.StatusOK || p.Status == http.StatusPartialContent) && p.Length > 0
}

type rangeKind int

const (
	rangeNone rangeKind = iota
	rangeValid
	rangeUnsatisfiable
	rangeMalformed
	rangeIgnored // multiple ranges: serve the full representation
)

func parseRange(h string, size int64) (kind rangeKind, start, end int64) {
	if h == "" {
		return rangeNone, 0, 0
	}
	const unit = "bytes="
	if len(h) < len(unit) || !strings.EqualFold(h[:len(unit)], unit) {
		return rangeMalformed, 0, 0
	}
	spec := strings.TrimSpace(h[len(unit):])
	if spec == "" {
		return rangeMalformed, 0, 0
	}
	if strings.Contains(spec, ",") {
		// Validate each part's syntax so garbage is still 400, then ignore the set.
		for _, part := range strings.Split(spec, ",") {
			if _, _, _, ok := splitSpec(strings.TrimSpace(part)); !ok {
				return rangeMalformed, 0, 0
			}
		}
		return rangeIgnored, 0, 0
	}
	first, last, suffix, ok := splitSpec(spec)
	if !ok {
		return rangeMalformed, 0, 0
	}
	if suffix {
		if last == 0 || size == 0 {
			return rangeUnsatisfiable, 0, 0
		}
		if last > size {
			last = size
		}
		return rangeValid, size - last, size - 1
	}
	if first >= size {
		return rangeUnsatisfiable, 0, 0
	}
	if last < 0 || last >= size {
		last = size - 1
	}
	return rangeValid, first, last
}

// splitSpec parses "a-b", "a-" or "-n". last is -1 when open.
func splitSpec(s string) (first, last int64, suffix, ok bool) {
	dash := strings.IndexByte(s, '-')
	if dash < 0 {
		return 0, 0, false, false
	}
	a, b := s[:dash], s[dash+1:]
	digits := func(v string) bool {
		if v == "" {
			return false
		}
		for _, c := range v {
			if c < '0' || c > '9' {
				return false
			}
		}
		return true
	}
	num := func(v string) (int64, bool) {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			// Overflowing offsets are beyond any file: treat as very large.
			return int64(^uint64(0) >> 1), digits(v)
		}
		return n, true
	}
	switch {
	case a == "" && digits(b):
		n, ok := num(b)
		return 0, n, true, ok
	case digits(a) && b == "":
		n, ok := num(a)
		return n, -1, false, ok
	case digits(a) && digits(b):
		f, ok1 := num(a)
		l, ok2 := num(b)
		if !ok1 || !ok2 || l < f {
			return 0, 0, false, false
		}
		return f, l, false, true
	}
	return 0, 0, false, false
}

func etagListMatch(header, etag string, weak bool) bool {
	for _, part := range strings.Split(header, ",") {
		p := strings.TrimSpace(part)
		if p == "*" {
			return true
		}
		if !weak && strings.HasPrefix(p, "W/") {
			continue
		}
		if weak {
			p = strings.TrimPrefix(p, "W/")
		}
		if p == etag {
			return true
		}
	}
	return false
}

// Decide applies RFC 9110 precondition and range handling for a strong ETag.
func Decide(r Request, size int64, etag string) Plan {
	if r.IfMatch != "" && !etagListMatch(r.IfMatch, etag, false) {
		return Plan{Status: http.StatusPreconditionFailed, Code: "precondition_failed", Detail: "The If-Match precondition failed."}
	}
	if r.IfNoneMatch != "" && etagListMatch(r.IfNoneMatch, etag, true) {
		return Plan{Status: http.StatusNotModified}
	}
	kind, start, end := parseRange(r.Range, size)
	if kind == rangeValid && r.IfRange != "" && r.IfRange != etag {
		kind = rangeIgnored // validator mismatch: ignore Range, send the full representation
	}
	switch kind {
	case rangeMalformed:
		return Plan{Status: http.StatusBadRequest, Code: "malformed_request", Detail: "The Range header is malformed."}
	case rangeUnsatisfiable:
		return Plan{Status: http.StatusRequestedRangeNotSatisfiable, Code: "range_not_satisfiable", Detail: "The requested range cannot be satisfied.",
			ContentRange: fmt.Sprintf("bytes */%d", size)}
	case rangeValid:
		return Plan{Status: http.StatusPartialContent, Start: start, End: end, Length: end - start + 1,
			ContentRange: fmt.Sprintf("bytes %d-%d/%d", start, end, size)}
	}
	p := Plan{Status: http.StatusOK, Length: size}
	if size > 0 {
		p.End = size - 1
	}
	return p
}

// ErrUnavailable marks transient storage failure (never a catalog deletion).
var ErrUnavailable = errors.New("media storage unavailable")

// Open resolves the locator under root (if set) and checks the stored size.
func Open(root, locator string, wantSize int64) (*os.File, error) {
	p := filepath.Clean(locator)
	if root != "" {
		rel, err := filepath.Rel(filepath.Clean(root), p)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return nil, ErrUnavailable
		}
	}
	f, err := os.Open(p)
	if err != nil {
		return nil, ErrUnavailable
	}
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Size() != wantSize {
		f.Close()
		return nil, ErrUnavailable
	}
	return f, nil
}

// Copy writes plan's byte window of f to w.
func Copy(w io.Writer, f io.ReaderAt, p Plan) error {
	if p.Length <= 0 {
		return nil
	}
	_, err := io.Copy(w, io.NewSectionReader(f, p.Start, p.Length))
	return err
}
