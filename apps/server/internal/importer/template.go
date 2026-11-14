// Package importer plans and performs reviewed, copy-only imports into a
// managed library (ADR-0046/0054). Sources are never modified or removed.
package importer

import (
	"fmt"
	"path"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// DefaultTemplate is used when a managed library has none.
const DefaultTemplate = "{author}/{title}/{filename}"

var placeholders = map[string]bool{"author": true, "title": true, "series": true, "series_index": true, "narrator": true, "filename": true}

var placeholderRE = regexp.MustCompile(`\{([a-z_]+)\}`)

// ValidateTemplate rejects unknown placeholders, absolute or escaping paths,
// and templates that cannot keep two files apart.
func ValidateTemplate(t string) error {
	if strings.TrimSpace(t) == "" {
		return fmt.Errorf("template is empty")
	}
	if strings.ContainsAny(t, "\\:") || strings.HasPrefix(t, "/") || strings.Contains(t, "..") {
		return fmt.Errorf("template must be a relative slash-separated path")
	}
	if strings.Count(t, "{") != strings.Count(t, "}") {
		return fmt.Errorf("unbalanced braces")
	}
	for _, m := range placeholderRE.FindAllStringSubmatch(t, -1) {
		if !placeholders[m[1]] {
			return fmt.Errorf("unknown placeholder {%s}", m[1])
		}
	}
	rest := placeholderRE.ReplaceAllString(t, "")
	if strings.ContainsAny(rest, "{}") {
		return fmt.Errorf("malformed placeholder")
	}
	if !strings.Contains(t, "{filename}") {
		return fmt.Errorf("template must end with {filename}")
	}
	if !strings.HasSuffix(t, "{filename}") {
		return fmt.Errorf("template must end with {filename}")
	}
	return nil
}

// Values supplies placeholder text.
type Values struct {
	Author, Title, Series, SeriesIndex, Narrator, Filename string
}

var reserved = map[string]bool{"con": true, "prn": true, "aux": true, "nul": true}

func init() {
	for i := 1; i <= 9; i++ {
		reserved[fmt.Sprintf("com%d", i)] = true
		reserved[fmt.Sprintf("lpt%d", i)] = true
	}
}

const maxComponent = 120

// SanitizeComponent makes one path component safe on Linux, macOS and Windows
// shares: no separators, controls or reserved characters, no dot-only,
// trailing dot/space or device names, bounded length.
func SanitizeComponent(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|':
			b.WriteRune('_')
		case unicode.IsControl(r) || r == utf8.RuneError:
			// dropped
		default:
			b.WriteRune(r)
		}
	}
	out := strings.TrimSpace(b.String())
	out = strings.TrimRight(out, ". ")
	out = strings.TrimLeft(out, ". ")
	if out == "" {
		return "Unknown"
	}
	stem := strings.ToLower(strings.SplitN(out, ".", 2)[0])
	if reserved[stem] {
		out = "_" + out
	}
	if len(out) > maxComponent {
		// Cut on a rune boundary, keeping a file extension if there is one.
		ext := path.Ext(out)
		if len(ext) > 12 {
			ext = ""
		}
		keep := maxComponent - len(ext)
		cut := out[:keep]
		for !utf8.ValidString(cut) && len(cut) > 0 {
			cut = cut[:len(cut)-1]
		}
		out = strings.TrimRight(cut, ". ") + ext
	}
	return out
}

var optional = map[string]bool{"series": true, "series_index": true, "narrator": true}

// Render fills the template; every component is sanitized, so a hostile tag
// value can never add separators or escape the library root. A component whose
// placeholders are all optional and empty (for example {series}) is omitted.
func Render(t string, v Values) (string, error) {
	if err := ValidateTemplate(t); err != nil {
		return "", err
	}
	val := map[string]string{"author": v.Author, "title": v.Title, "series": v.Series, "series_index": v.SeriesIndex, "narrator": v.Narrator, "filename": v.Filename}
	var parts []string
	for _, comp := range strings.Split(t, "/") {
		skip := true
		for _, m := range placeholderRE.FindAllStringSubmatch(comp, -1) {
			if !optional[m[1]] || strings.TrimSpace(val[m[1]]) != "" {
				skip = false
			}
		}
		if skip && placeholderRE.MatchString(comp) {
			continue
		}
		filled := placeholderRE.ReplaceAllStringFunc(comp, func(m string) string {
			return val[m[1:len(m)-1]]
		})
		parts = append(parts, SanitizeComponent(filled))
	}
	if len(parts) == 0 {
		return "", fmt.Errorf("template produced an empty path")
	}
	return path.Join(parts...), nil
}

// WithSuffix inserts " (n)" before the extension: the visible, non-overwriting
// rename used on a collision.
func WithSuffix(rel string, n int) string {
	dir, file := path.Split(rel)
	ext := path.Ext(file)
	return dir + strings.TrimSuffix(file, ext) + fmt.Sprintf(" (%d)", n) + ext
}
