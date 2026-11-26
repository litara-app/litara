package httpapi_test

import (
	"bytes"
	"image"
	"image/color"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// ADR-0101 and ADR-0104: the guessed last name and the letter a name is filed under.
func TestGuessedLastNames(t *testing.T) {
	e := newReadingEnv(t).e
	for name, want := range map[string]string{
		"Ambrose Hale":            "Hale",
		"  Ambrose   Hale  ":      "Hale",
		"Ursula K. Le Guin":       "Le Guin",
		"John le Carré":           "le Carré",
		"Ludwig van der Berg":     "van der Berg",
		"Van Morrison":            "Morrison",
		"Kurt Vonnegut Jr.":       "Vonnegut",
		"Martin Luther King, Jr.": "King",
		"Henry Jones III":         "Jones",
		"Le Guin, Ursula K.":      "Le Guin",
		"Homer":                   "Homer",
		"Jr.":                     "Jr.",
		"Daphne du Maurier":       "du Maurier",
	} {
		var got string
		if err := e.Pool.QueryRow(t.Context(), `SELECT guess_last_name($1)`, name).Scan(&got); err != nil || got != want {
			t.Errorf("guess_last_name(%q) = %q, %v; want %q", name, got, err, want)
		}
	}
	for name, want := range map[string]string{"hale": "H", "Étienne": "E", "Østby": "O", "'t Hooft": "T", "3M": "", "村上": "", "": ""} {
		var got string
		if err := e.Pool.QueryRow(t.Context(), `SELECT directory_letter($1)`, name).Scan(&got); err != nil || got != want {
			t.Errorf("directory_letter(%q) = %q, %v; want %q", name, got, err, want)
		}
	}
}

// ADR-0101 to ADR-0105: shared author and series details, locks, revisions, photos and who may do what.
func TestAuthorAndSeriesDetails(t *testing.T) {
	r := newReadingEnv(t)
	e := r.e
	epub(t, filepath.Join(r.root, "A", "one.epub"), "Alpha Book", "Zara Adams", "978-0-306-40615-7")
	epub(t, filepath.Join(r.root, "B", "two.epub"), "Beta Book", "Ursula K. Le Guin", "978-1-56619-909-4")
	scanTwice(t, e, r.admin, r.lib)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := e.Pool.Exec(t.Context(), sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`UPDATE titles SET series_name = 'Earth Cycle', series_index = 1 WHERE title = 'Beta Book'`)

	const author = "Ursula K. Le Guin"
	q := func(name string) string { return "?name=" + url.QueryEscape(name) }
	get := func(token, path, name string) (wire.DirectoryDetails, apitest.Response) {
		var out wire.DirectoryDetails
		resp := e.Do("GET", path+q(name), token, nil)
		if resp.StatusCode == http.StatusOK {
			resp.JSON(t, &out)
		}
		return out, resp
	}
	change := func(field, action string, value any, clear bool) map[string]any {
		c := map[string]any{"field": field, "action": action}
		if action == "set" {
			c["value"] = value
			if clear {
				c["clear"] = true
			}
		}
		return c
	}
	save := func(token, path, name, revision string, changes ...map[string]any) (wire.DirectoryDetails, apitest.Response) {
		var out wire.DirectoryDetails
		resp := e.Do("PATCH", path+q(name), token, map[string]any{"operationId": uuid.NewString(), "baseRevision": revision, "changes": changes})
		if resp.StatusCode == http.StatusOK {
			resp.JSON(t, &out)
		}
		return out, resp
	}
	field := func(d wire.DirectoryDetails, name string) wire.DirectoryField {
		t.Helper()
		for _, f := range d.Fields {
			if f.Field == name {
				return f
			}
		}
		t.Fatalf("no field %s in %+v", name, d)
		return wire.DirectoryField{}
	}
	text := func(f wire.DirectoryField) string { return string(f.Value.Raw) }

	// An administrator without a grant for the author's library may not read or edit.
	adminGrant := "/admin/users/" + e.Fix.AdminID.String() + "/libraries/" + r.lib
	if resp := e.Do("DELETE", adminGrant, r.admin, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke admin: %d %s", resp.StatusCode, resp.Body)
	}
	if _, resp := get(r.admin, "/authors/details", author); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("admin without a grant: %d %s", resp.StatusCode, resp.Body)
	}
	if _, resp := save(r.admin, "/authors/details", author, "0", change("introduction", "set", "x", false)); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("admin edit without a grant: %d %s", resp.StatusCode, resp.Body)
	}
	if resp := e.Do("PUT", adminGrant, r.admin, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("grant admin: %d %s", resp.StatusCode, resp.Body)
	}

	d, resp := get(r.userA, "/authors/details", strings.ToUpper(author))
	if resp.StatusCode != http.StatusOK || d.Name != author || d.Revision != "0" || d.Photo == nil || d.Photo.Source != "none" ||
		field(d, "last_name").Source != "guessed" || text(field(d, "last_name")) != `"Le Guin"` || field(d, "biography").Source != "none" {
		t.Fatalf("new details: %d %s", resp.StatusCode, resp.Body)
	}
	if _, resp := save(r.userA, "/authors/details", author, "0", change("introduction", "set", "x", false)); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("member edit: %d", resp.StatusCode)
	}
	if _, resp := get(r.userB, "/authors/details", author); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("no grant: %d", resp.StatusCode)
	}
	if _, resp := get("", "/authors/details", author); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d", resp.StatusCode)
	}

	// By last name, Zara Adams comes before Ursula K. Le Guin; by first name the order is reversed.
	list := func(query string) wire.DirectoryAuthors {
		var out wire.DirectoryAuthors
		resp := e.Do("GET", "/authors?"+query, r.userA, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("list %s: %d %s", query, resp.StatusCode, resp.Body)
		}
		resp.JSON(t, &out)
		return out
	}
	order := func(l wire.DirectoryAuthors) []string {
		names := []string{}
		for _, a := range l.Items {
			if a.Name == "Zara Adams" || a.Name == author {
				names = append(names, a.Name)
			}
		}
		return names
	}
	if got := order(list("size=200")); !slices.Equal(got, []string{"Zara Adams", author}) {
		t.Fatalf("by last name: %v", got)
	}
	if got := order(list("size=200&sort=first")); !slices.Equal(got, []string{author, "Zara Adams"}) {
		t.Fatalf("by first name: %v", got)
	}
	l := list("letter=L&q=guin")
	if l.Total != 1 || len(l.Items) != 1 || l.Items[0].LastName != "Le Guin" || l.Items[0].PhotoVersion != nil || !slices.Equal(l.Letters, []string{"L"}) {
		t.Fatalf("letter L: %+v", l)
	}
	if l := list("letter=U&sort=first&q=guin"); l.Total != 1 {
		t.Fatalf("first-name letter: %+v", l)
	}
	if l := list("letter=Q&q=guin"); l.Total != 0 || len(l.Items) != 0 || !slices.Equal(l.Letters, []string{"L"}) {
		t.Fatalf("a letter with nobody keeps the others: %+v", l)
	}
	if resp := e.Do("GET", "/authors?letter=ab", r.userA, nil); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("bad letter: %d", resp.StatusCode)
	}

	// Lock freezes the guess; a locked field refuses a change and the whole save stores nothing.
	d, resp = save(r.admin, "/authors/details", author, "0", change("last_name", "lock", nil, false))
	if resp.StatusCode != http.StatusOK || d.Revision != "1" || !field(d, "last_name").Locked || field(d, "last_name").Source != "user" || text(field(d, "last_name")) != `"Le Guin"` {
		t.Fatalf("lock the guess: %d %s", resp.StatusCode, resp.Body)
	}
	_, resp = save(r.admin, "/authors/details", author, "1", change("introduction", "set", "Intro", false), change("last_name", "set", "Guin", false))
	if resp.StatusCode != http.StatusConflict || resp.Code() != "field_locked" {
		t.Fatalf("locked: %d %s", resp.StatusCode, resp.Body)
	}
	if d, _ := get(r.userA, "/authors/details", author); d.Revision != "1" || field(d, "introduction").Source != "none" {
		t.Fatalf("refused save stored something: %+v", d)
	}

	// Unlock keeps the value, and a corrected last name moves the author. A stale save is refused.
	d, resp = save(r.admin, "/authors/details", author, "1", change("last_name", "unlock", nil, false))
	if resp.StatusCode != http.StatusOK || field(d, "last_name").Locked || text(field(d, "last_name")) != `"Le Guin"` {
		t.Fatalf("unlock: %d %s", resp.StatusCode, resp.Body)
	}
	d, resp = save(r.admin, "/authors/details", author, "2", change("last_name", "set", "  Aardvark ", false), change("biography", "set", "A life.", false))
	if resp.StatusCode != http.StatusOK || d.Revision != "3" || text(field(d, "last_name")) != `"Aardvark"` {
		t.Fatalf("correct the last name: %d %s", resp.StatusCode, resp.Body)
	}
	if got := order(list("size=200")); !slices.Equal(got, []string{author, "Zara Adams"}) {
		t.Fatalf("corrected order: %v", got)
	}
	if l := list("letter=A&q=guin"); l.Total != 1 || l.Items[0].LastName != "Aardvark" {
		t.Fatalf("corrected letter: %+v", l)
	}
	_, resp = save(r.admin, "/authors/details", author, "2", change("biography", "set", "Overwrite", false))
	if resp.StatusCode != http.StatusConflict || resp.Code() != "stale_revision" {
		t.Fatalf("stale: %d %s", resp.StatusCode, resp.Body)
	}
	// A retried operation is applied once.
	body := map[string]any{"operationId": uuid.NewString(), "baseRevision": "3", "changes": []any{change("introduction", "set", "Intro", false)}}
	first := e.Do("PATCH", "/authors/details"+q(author), r.admin, body)
	again := e.Do("PATCH", "/authors/details"+q(author), r.admin, body)
	if first.StatusCode != http.StatusOK || again.StatusCode != http.StatusOK || !bytes.Equal(first.Body, again.Body) {
		t.Fatalf("retry: %d %d %s", first.StatusCode, again.StatusCode, again.Body)
	}

	// Reset returns to the guess; a clear is kept as a saved empty value.
	d, resp = save(r.admin, "/authors/details", author, "4", change("last_name", "reset", nil, false), change("biography", "set", nil, true))
	if resp.StatusCode != http.StatusOK || field(d, "last_name").Source != "guessed" || !field(d, "biography").Cleared || text(field(d, "biography")) != "null" {
		t.Fatalf("reset and clear: %d %s", resp.StatusCode, resp.Body)
	}
	for name, c := range map[string]map[string]any{
		"cleared last name": change("last_name", "set", nil, true),
		"empty text":        change("introduction", "set", "  ", false),
		"long text":         change("introduction", "set", strings.Repeat("a", 501), false),
		"series field":      change("status", "set", "ongoing", false),
		"setting a photo":   change("photo", "set", "x", false),
		"number as text":    change("biography", "set", 3, false),
	} {
		if _, resp := save(r.admin, "/authors/details", author, "5", c); resp.StatusCode != http.StatusUnprocessableEntity {
			t.Errorf("%s: %d %s", name, resp.StatusCode, resp.Body)
		}
	}

	// Photos: upload and fetch are stored as the server's own JPEG; hostile input stores nothing.
	photo := func(token, name, revision string, body []byte) apitest.Response {
		return e.Do("PUT", "/authors/photo"+q(name)+"&operationId="+uuid.NewString()+"&baseRevision="+revision, token, body, "Content-Type", "image/png")
	}
	picture := solidPNG(2000, 1000, color.NRGBA{R: 10, G: 20, B: 200, A: 255})
	if resp := photo(r.userA, author, "5", picture); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("member upload: %d", resp.StatusCode)
	}
	if resp := photo(r.admin, author, "5", []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("svg upload: %d %s", resp.StatusCode, resp.Body)
	}
	if resp := photo(r.admin, author, "4", picture); resp.StatusCode != http.StatusConflict || resp.Code() != "stale_revision" {
		t.Fatalf("stale upload: %d %s", resp.StatusCode, resp.Body)
	}
	if resp := e.Do("GET", "/authors/photo"+q(author), r.userA, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("refused uploads stored a photo: %d", resp.StatusCode)
	}
	if resp := photo(r.admin, author, "5", picture); resp.StatusCode != http.StatusOK {
		t.Fatalf("upload: %d %s", resp.StatusCode, resp.Body)
	}
	served := e.Do("GET", "/authors/photo"+q(author), r.userA, nil)
	cfg, format, err := image.DecodeConfig(bytes.NewReader(served.Body))
	if served.StatusCode != http.StatusOK || err != nil || format != "jpeg" || cfg.Width != 1600 || cfg.Height != 800 {
		t.Fatalf("served photo: %d %s %+v %v", served.StatusCode, format, cfg, err)
	}
	etag := served.Header.Get("ETag")
	if again := e.Do("GET", "/authors/photo"+q(author), r.userA, nil, "If-None-Match", etag); again.StatusCode != http.StatusNotModified {
		t.Fatalf("revalidation: %d", again.StatusCode)
	}
	if resp := e.Do("GET", "/authors/photo"+q(author), r.userB, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("photo without a grant: %d", resp.StatusCode)
	}
	if l := list("q=guin"); l.Items[0].PhotoVersion == nil || `"`+*l.Items[0].PhotoVersion+`"` != etag {
		t.Fatalf("list photo version: %+v %s", l.Items[0], etag)
	}

	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(solidPNG(40, 50, color.NRGBA{G: 200, A: 255}))
	}))
	defer site.Close()
	fromURL := func(revision string) apitest.Response {
		return e.Do("POST", "/authors/photo/from-url"+q(author), r.admin, map[string]any{"operationId": uuid.NewString(), "baseRevision": revision, "url": site.URL + "/p.png"})
	}
	resp = fromURL("6")
	var after wire.DirectoryDetails
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("from url: %d %s", resp.StatusCode, resp.Body)
	}
	resp.JSON(t, &after)
	if after.Photo.Source != "url" || after.Revision != "7" || `"`+*after.Photo.Version+`"` == etag {
		t.Fatalf("from url: %+v", after.Photo)
	}

	// A locked photo cannot be replaced or removed; unlocking keeps it, and reset removes it.
	if _, resp := save(r.admin, "/authors/details", author, "7", change("photo", "lock", nil, false)); resp.StatusCode != http.StatusOK {
		t.Fatalf("lock photo: %d %s", resp.StatusCode, resp.Body)
	}
	if resp := photo(r.admin, author, "8", picture); resp.StatusCode != http.StatusConflict || resp.Code() != "field_locked" {
		t.Fatalf("upload over a lock: %d %s", resp.StatusCode, resp.Body)
	}
	if _, resp := save(r.admin, "/authors/details", author, "8", change("photo", "reset", nil, false)); resp.StatusCode != http.StatusConflict {
		t.Fatalf("remove a locked photo: %d %s", resp.StatusCode, resp.Body)
	}
	d, _ = save(r.admin, "/authors/details", author, "8", change("photo", "unlock", nil, false))
	if d.Photo == nil || d.Photo.Locked || d.Photo.Source != "url" {
		t.Fatalf("unlock kept the photo: %+v", d.Photo)
	}
	d, _ = save(r.admin, "/authors/details", author, "9", change("photo", "reset", nil, false))
	if d.Photo == nil || d.Photo.Source != "none" || d.Photo.Version != nil {
		t.Fatalf("removed: %+v", d.Photo)
	}
	// "No photo" can be locked too.
	d, _ = save(r.admin, "/authors/details", author, "10", change("photo", "lock", nil, false))
	if d.Photo == nil || !d.Photo.Locked || d.Photo.Source != "none" {
		t.Fatalf("locked without a photo: %+v", d.Photo)
	}
	if resp := photo(r.admin, author, "11", picture); resp.Code() != "field_locked" {
		t.Fatalf("upload over an empty lock: %d %s", resp.StatusCode, resp.Body)
	}

	// Series details use the same rules.
	s, resp := get(r.userA, "/series/details", "earth cycle")
	if resp.StatusCode != http.StatusOK || s.Name != "Earth Cycle" || s.Photo != nil || len(s.Fields) != 3 {
		t.Fatalf("series: %d %s", resp.StatusCode, resp.Body)
	}
	s, resp = save(r.admin, "/series/details", "Earth Cycle", "0", change("description", "set", "Islands.", false),
		change("book_count", "set", 6, false), change("status", "set", "complete", false), change("status", "lock", nil, false))
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("one change per field in a save: %d %s", resp.StatusCode, resp.Body)
	}
	s, resp = save(r.admin, "/series/details", "Earth Cycle", "0", change("description", "set", "Islands.", false),
		change("book_count", "set", 6, false), change("status", "set", "complete", false))
	if resp.StatusCode != http.StatusOK || text(field(s, "book_count")) != "6" || text(field(s, "status")) != `"complete"` {
		t.Fatalf("series save: %d %s", resp.StatusCode, resp.Body)
	}
	for _, c := range []map[string]any{change("book_count", "set", 0, false), change("book_count", "set", 1.5, false),
		change("book_count", "set", "6", false), change("status", "set", "paused", false), change("photo", "lock", nil, false)} {
		if _, resp := save(r.admin, "/series/details", "Earth Cycle", "1", c); resp.StatusCode != http.StatusUnprocessableEntity {
			t.Errorf("%v: %d %s", c, resp.StatusCode, resp.Body)
		}
	}

	// Details stay under the old name: a renamed author does not inherit them, and renaming back finds them (ADR-0104).
	exec(`UPDATE titles SET authors = ARRAY['U. K. Le Guin'] WHERE title = 'Beta Book'`)
	renamed, _ := get(r.userA, "/authors/details", "U. K. Le Guin")
	if renamed.Revision != "0" || field(renamed, "introduction").Source != "none" {
		t.Fatalf("renamed: %+v", renamed)
	}
	if _, resp := get(r.userA, "/authors/details", author); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("old name: %d", resp.StatusCode)
	}
	exec(`UPDATE titles SET authors = ARRAY[$1] WHERE title = 'Beta Book'`, author)
	if back, _ := get(r.userA, "/authors/details", author); text(field(back, "introduction")) != `"Intro"` {
		t.Fatalf("renamed back: %+v", back)
	}
}
