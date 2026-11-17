package httpapi_test

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
)

// schemaLoader resolves the upstream $id URLs from local files only: the
// Readium schemas are vendored (BSD-3-Clause) and the OPDS ones are fetched by
// scripts/contracts/fetch_opds_schemas.py with checksum verification. There is
// never a network fetch.
type schemaLoader struct{ opds, readium string }

func (l schemaLoader) Load(url string) (any, error) {
	var path string
	switch {
	case strings.HasPrefix(url, "https://specs.opds.io/schema/"):
		path = filepath.Join(l.opds, strings.TrimPrefix(url, "https://specs.opds.io/schema/"))
	case strings.HasPrefix(url, "https://readium.org/webpub-manifest/schema/"):
		path = filepath.Join(l.readium, filepath.FromSlash(strings.TrimPrefix(url, "https://readium.org/webpub-manifest/schema/")))
	default:
		return nil, fmt.Errorf("refusing to load %s: only pinned local schemas are allowed", url)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return jsonschema.UnmarshalJSON(bytes.NewReader(b))
}

func opdsSchemas(t *testing.T) *jsonschema.Compiler {
	t.Helper()
	root, _ := filepath.Abs("../../../..")
	l := schemaLoader{opds: filepath.Join(root, ".tmp", "t006-opds-schemas"), readium: filepath.Join(root, "contracts", "t006", "vendor", "readium", "schema")}
	if _, err := os.Stat(filepath.Join(l.opds, "feed.schema.json")); err != nil {
		if os.Getenv("LITARA_REQUIRE_INTEGRATION") == "1" {
			t.Fatal("OPDS schemas missing; run python scripts/contracts/fetch_opds_schemas.py")
		}
		t.Skip("OPDS schemas not fetched; run python scripts/contracts/fetch_opds_schemas.py")
	}
	c := jsonschema.NewCompiler()
	c.UseLoader(l)
	c.AssertFormat()
	// jsonschema v6.0.3's built-in uri-template check rejects the RFC 6570 query
	// operator, including the OPDS spec's own "{?query}" example, so that one
	// format uses an explicit RFC 6570 expression grammar. All others stay strict.
	c.RegisterFormat(&jsonschema.Format{Name: "uri-template", Validate: func(v any) error {
		str, ok := v.(string)
		if !ok {
			return nil
		}
		rest := str
		for {
			i := strings.IndexAny(rest, "{}")
			if i < 0 {
				return nil
			}
			if rest[i] == '}' {
				return fmt.Errorf("unmatched closing brace")
			}
			j := strings.IndexByte(rest[i:], '}')
			if j < 0 {
				return fmt.Errorf("no matching closing brace")
			}
			if !uriTemplateExpr.MatchString(rest[i : i+j+1]) {
				return fmt.Errorf("invalid RFC 6570 expression %q", rest[i:i+j+1])
			}
			rest = rest[i+j+1:]
		}
	}})
	return c
}

var uriTemplateExpr = regexp.MustCompile(`^\{[+#./;?&]?[A-Za-z0-9_%.]+(:[1-9][0-9]{0,3}|\*)?(,[A-Za-z0-9_%.]+(:[1-9][0-9]{0,3}|\*)?)*\}$`)

// TestOPDS2ConformsToPinnedOfficialSchemas validates the real HTTP documents.
func TestOPDS2ConformsToPinnedOfficialSchemas(t *testing.T) {
	c := opdsSchemas(t)
	feedSchema, err := c.Compile("https://specs.opds.io/schema/feed.schema.json")
	if err != nil {
		t.Fatalf("compile feed schema: %v", err)
	}
	pubSchema, err := c.Compile("https://specs.opds.io/schema/publication.schema.json")
	if err != nil {
		t.Fatalf("compile publication schema: %v", err)
	}
	o := newOPDSEnv(t)
	check := func(name string, s *jsonschema.Schema, r apitest.Response) {
		t.Helper()
		if r.StatusCode != 200 {
			t.Fatalf("%s: %d %s", name, r.StatusCode, r.Body)
		}
		v, err := jsonschema.UnmarshalJSON(bytes.NewReader(r.Body))
		if err != nil {
			t.Fatal(err)
		}
		if err := s.Validate(v); err != nil {
			t.Fatalf("%s violates the official schema: %v\n%s", name, err, r.Body)
		}
	}
	check("root", feedSchema, o.asA("/opds/v2"))
	check("all publications", feedSchema, o.asA("/opds/v2/publications?size=200"))
	check("page 2", feedSchema, o.asA("/opds/v2/publications?size=3&page=1"))
	check("search", feedSchema, o.asA("/opds/v2/publications?q=zebra"))
	check("empty page", feedSchema, o.asA("/opds/v2/publications?q=nothing-matches-this"))
	f := decodeJSONFeed(t, o.asA("/opds/v2/publications?size=200"))
	for _, p := range f.Publications {
		check("detail "+p.Metadata.Identifier, pubSchema, o.asA("/opds/v2/publications/"+strings.TrimPrefix(p.Metadata.Identifier, "urn:uuid:")))
	}
}
