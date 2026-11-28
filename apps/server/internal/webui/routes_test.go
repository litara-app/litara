package webui

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// The server only answers a page's address with the app if it knows the address. A page added to the web app and not
// here works when reached by a link and is "not found" when reloaded or bookmarked.
func TestEveryWebAppPageCanBeOpenedByItsAddress(t *testing.T) {
	src, err := os.ReadFile("../../../web/src/App.tsx")
	if err != nil {
		t.Skipf("the web sources are not here: %v", err)
	}
	pages := 0
	// Paths written without a leading slash directly under the signed-in layout are first segments; nested ones such as
	// settings/devices are covered by their parent, so only paths with a parameter or a single segment are checked.
	for _, m := range regexp.MustCompile(`<Route path="([^"*]+)"`).FindAllStringSubmatch(string(src), -1) {
		first := "/" + strings.SplitN(strings.TrimPrefix(m[1], "/"), "/", 2)[0]
		if nested[first] {
			continue
		}
		pages++
		if !isSPA(first) {
			t.Errorf("%s is a page of the web app that the server does not serve", first)
		}
	}
	if pages < 10 {
		t.Fatalf("only %d pages were found; the pattern no longer reads App.tsx", pages)
	}
}

// Pages that live under settings or administration.
var nested = map[string]bool{"/devices": true, "/appearance": true, "/credentials": true, "/email": true, "/koreader": true,
	"/notifications": true, "/users": true, "/libraries": true, "/integrations": true, "/repairs": true}
