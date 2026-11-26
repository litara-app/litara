package httpapi_test

import (
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// ADR-0100: authors and series are names matched ignoring case, over the titles the viewer can see.
func TestAuthorAndSeriesDirectories(t *testing.T) {
	r := newReadingEnv(t)
	e := r.e
	epub(t, filepath.Join(r.root, "Saga", "vol1.epub"), "First Volume", "Ada Author", "978-0-306-40615-7")
	epub(t, filepath.Join(r.root, "Saga", "vol3.epub"), "Third Volume", "Ada Author", "978-1-56619-909-4")
	epub(t, filepath.Join(r.root, "Other", "tale.epub"), "Other Tale", "Zed Writer", "978-0-13-468599-1")
	scanTwice(t, e, r.admin, r.lib)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := e.Pool.Exec(t.Context(), sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	// One series spelt two ways, and a second author on another book whose name differs only in case.
	exec(`UPDATE titles SET series_name = 'The Saga', series_index = 1 WHERE title = 'First Volume'`)
	exec(`UPDATE titles SET series_name = 'The Saga', series_index = 2 WHERE title = 'Second Volume'`)
	exec(`UPDATE titles SET series_name = 'the saga', series_index = 4 WHERE title = 'Third Volume'`)
	exec(`UPDATE titles SET authors = ARRAY['Zed Writer', 'ada author'] WHERE title = 'Other Tale'`)
	var first string
	if err := e.Pool.QueryRow(t.Context(), `SELECT id::text FROM titles WHERE title = 'First Volume'`).Scan(&first); err != nil {
		t.Fatal(err)
	}

	authors := func(token, q string) (wire.DirectoryAuthors, int) {
		var out wire.DirectoryAuthors
		resp := e.Do("GET", "/authors?"+q, token, nil)
		if resp.StatusCode == http.StatusOK {
			resp.JSON(t, &out)
		}
		return out, resp.StatusCode
	}
	a, code := authors(r.userA, "q=ADA")
	if code != 200 || a.Total != 1 || len(a.Items) != 1 || a.Items[0].Name != "Ada Author" || a.Items[0].Titles != 4 || a.Items[0].CoverTitleID != first {
		t.Fatalf("ada: %d %+v (first %s)", code, a, first)
	}
	if a, _ := authors(r.userA, "q=zed"); a.Total != 1 || a.Items[0].Titles != 1 {
		t.Fatalf("zed: %+v", a)
	}
	all, _ := authors(r.userA, "size=200")
	names := []string{}
	for _, it := range all.Items {
		names = append(names, it.Name)
	}
	if !sortedFold(names) || all.Total != int64(len(all.Items)) {
		t.Fatalf("all authors not sorted by name or total wrong: %d %v", all.Total, names)
	}
	if p, _ := authors(r.userA, "q=a&size=1&page=1"); len(p.Items) > 1 || p.Page != 1 {
		t.Fatalf("paging: %+v", p)
	}

	var s wire.DirectorySeriesPage
	resp := e.Do("GET", "/series?q=the+saga", r.userA, nil)
	resp.JSON(t, &s)
	if resp.StatusCode != 200 || s.Total != 1 || len(s.Items) != 1 || s.Items[0].Name != "The Saga" || s.Items[0].Titles != 3 ||
		s.Items[0].CoverTitleID != first || len(s.Items[0].Authors) != 1 || s.Items[0].Authors[0] != "Ada Author" {
		t.Fatalf("series: %d %+v", resp.StatusCode, s)
	}

	// The author and series pages use the title search; "is" matches either spelling.
	var titles wire.T005Titles
	resp = e.Do("POST", "/titles/search", r.userA, map[string]any{"filter": map[string]any{"type": "rule", "field": "series", "operator": "is", "value": []string{"THE SAGA"}},
		"sort": "series_index", "order": "asc", "page": 0, "size": 50})
	resp.JSON(t, &titles)
	if resp.StatusCode != 200 || len(titles.Items) != 3 || titles.Items[0].Title != "First Volume" || titles.Items[2].Title != "Third Volume" {
		t.Fatalf("series search: %d %s", resp.StatusCode, resp.Body)
	}

	// Another account without the grant sees none of it; anonymous requests and long queries are refused.
	if a, _ := authors(r.userB, "q=ada"); a.Total != 0 || len(a.Items) != 0 {
		t.Fatalf("user B: %+v", a)
	}
	if _, code := authors(r.userA, "q="+strings.Repeat("a", 201)); code != http.StatusUnprocessableEntity {
		t.Fatalf("long query: %d", code)
	}
	for _, p := range []string{"/authors", "/series"} {
		if resp := e.Do("GET", p, "", nil); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("anonymous %s: %d", p, resp.StatusCode)
		}
	}
	if resp := e.Do("DELETE", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+r.lib, r.admin, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke grant: %d %s", resp.StatusCode, resp.Body)
	}
	if a, _ := authors(r.userA, "q=ada"); a.Total != 0 {
		t.Fatalf("after losing the grant: %+v", a)
	}
	e.Do("GET", "/series?q=the+saga", r.userA, nil).JSON(t, &s)
	if s.Total != 0 || len(s.Items) != 0 {
		t.Fatalf("series after losing the grant: %+v", s)
	}
}

func sortedFold(xs []string) bool {
	for i := 1; i < len(xs); i++ {
		if strings.ToLower(xs[i-1]) > strings.ToLower(xs[i]) {
			return false
		}
	}
	return true
}
