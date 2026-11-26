package httpapi_test

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// ADR-0099: the annotations hub lists, searches and exports the caller's own live annotations on editions they can
// still see, across books.
func TestAnnotationHubSearchExportPrivacyAndGrants(t *testing.T) {
	r := newReadingEnv(t)
	e := r.e
	epub(t, filepath.Join(r.root, "Other", "tale.epub"), "Other Tale", "Zed Writer", "978-0-306-40615-7")
	scanTwice(t, e, r.admin, r.lib)
	var eds wire.Editions
	e.Do("GET", "/editions?libraryId="+r.lib, r.userA, nil).JSON(t, &eds)
	var saga, tale wire.Edition
	for _, ed := range eds.Items {
		if ed.ID == r.ed.ID {
			saga = ed
		} else {
			tale = ed
		}
	}
	if saga.ID == "" || tale.ID == "" {
		t.Fatalf("editions: %+v", eds)
	}
	put := func(token string, ed wire.Edition, kind, text, quote string) string {
		t.Helper()
		id := uuid.NewString()
		var sel any
		if kind != "bookmark" {
			sel = rangeSel
		}
		body := map[string]any{"operationId": uuid.NewString(), "baseRevision": "0", "capturedAt": "2026-11-14T10:00:00Z",
			"data": map[string]any{"kind": kind, "text": text, "quote": quote, "selection": sel,
				"anchor": map[string]any{"fileId": ed.File.ID, "contentVersion": ed.File.ContentVersion, "locator": r.cfi("/6/8!/4/2")}}}
		if resp := e.Do("PUT", "/editions/"+ed.ID+"/annotations/"+id, token, body); resp.StatusCode != http.StatusOK {
			t.Fatalf("put %s: %d %s", kind, resp.StatusCode, resp.Body)
		}
		return id
	}
	put(r.userA, saga, "highlight", "50% sure", "the long road")
	put(r.userA, saga, "note", "=SUM(A1)", "")
	put(r.userA, tale, "highlight", "", "a quiet sea\nand stars")
	gone := put(r.userA, tale, "bookmark", "deleted one", "")
	if resp := e.Do("PUT", "/admin/users/"+e.Fix.UserBID.String()+"/libraries/"+r.lib, r.admin, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("grant B: %d %s", resp.StatusCode, resp.Body)
	}
	put(r.userB, saga, "note", "user B private", "")
	var g wire.Annotation
	e.Do("GET", "/editions/"+tale.ID+"/annotations/"+gone, r.userA, nil).JSON(t, &g)
	if d := e.Do("DELETE", "/editions/"+tale.ID+"/annotations/"+gone, r.userA, delBody(uuid.NewString(), g.Revision)); d.StatusCode != http.StatusOK {
		t.Fatalf("delete: %d %s", d.StatusCode, d.Body)
	}

	list := func(token, q string) (wire.AnnotationHub, int) {
		var h wire.AnnotationHub
		resp := e.Do("GET", "/annotations?"+q, token, nil)
		if resp.StatusCode == http.StatusOK {
			resp.JSON(t, &h)
		}
		return h, resp.StatusCode
	}
	h, code := list(r.userA, "")
	if code != 200 || h.Total != 3 || len(h.Items) != 3 { // B's note and the tombstone are left out
		t.Fatalf("all: %d %+v", code, h)
	}
	for _, it := range h.Items {
		if it.Annotation.Deleted || it.Annotation.Data.Value == nil || it.Title == "" || it.TitleID == "" || len(it.Authors) == 0 {
			t.Fatalf("item: %+v", it)
		}
	}
	for q, want := range map[string]int64{
		"q=" + url.QueryEscape("50%"):   1, // a literal percent sign, not a wildcard
		"q=" + url.QueryEscape("%"):     1,
		"q=" + url.QueryEscape("_"):     0,
		"q=QUIET":                       1, // quote, any case
		"q=zed":                         1, // author
		"q=second":                      2, // title
		"kind=note":                     1,
		"kind=highlight":                2,
		"titleId=" + h.Items[0].TitleID: map[bool]int64{true: 1, false: 2}[h.Items[0].Title == "Other Tale"],
	} {
		if got, code := list(r.userA, q); code != 200 || got.Total != want {
			t.Fatalf("%s: %d total %d, want %d", q, code, got.Total, want)
		}
	}
	if _, code := list(r.userA, "kind=poem"); code != http.StatusUnprocessableEntity {
		t.Fatalf("bad kind: %d", code)
	}
	if _, code := list(r.userA, "q="+strings.Repeat("a", 201)); code != http.StatusUnprocessableEntity {
		t.Fatalf("long query: %d", code)
	}

	var titles wire.AnnotationHubTitles
	e.Do("GET", "/annotations/titles", r.userA, nil).JSON(t, &titles)
	if len(titles.Items) != 2 || titles.Items[0].Title != "Other Tale" || titles.Items[0].Annotations != 1 || titles.Items[1].Annotations != 2 {
		t.Fatalf("titles: %+v", titles)
	}

	export := func(token, q string) (string, http.Header, int) {
		resp := e.Do("GET", "/annotations/export?"+q, token, nil)
		return string(resp.Body), resp.Header, resp.StatusCode
	}
	md, hdr, code := export(r.userA, "format=markdown")
	if code != 200 || !strings.HasPrefix(hdr.Get("Content-Type"), "text/markdown") || !strings.Contains(hdr.Get("Content-Disposition"), `attachment; filename="litara-annotations-`) ||
		hdr.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("markdown: %d %v", code, hdr)
	}
	if !strings.Contains(md, "## Other Tale") || !strings.Contains(md, "> a quiet sea\n> and stars\n") || !strings.Contains(md, "*Zed Writer*") ||
		strings.Index(md, "## Other Tale") > strings.Index(md, "## Second Volume") || strings.Contains(md, "user B") || strings.Contains(md, "deleted one") {
		t.Fatalf("markdown body:\n%s", md)
	}
	body, hdr, code := export(r.userA, "format=csv&kind=note")
	recs, err := csv.NewReader(strings.NewReader(body)).ReadAll()
	if code != 200 || err != nil || !strings.HasPrefix(hdr.Get("Content-Type"), "text/csv") || len(recs) != 2 || recs[0][4] != "note" || recs[1][4] != "'=SUM(A1)" {
		t.Fatalf("csv: %d %v %q", code, err, recs)
	}
	body, _, code = export(r.userA, "format=json&q=zed")
	var js struct {
		ExportedAt string `json:"exportedAt"`
		Items      []struct {
			Title, Kind, Quote string
			Authors            []string
		} `json:"items"`
	}
	if code != 200 || json.Unmarshal([]byte(body), &js) != nil || len(js.Items) != 1 || js.Items[0].Title != "Other Tale" || js.ExportedAt == "" {
		t.Fatalf("json: %d %s", code, body)
	}
	if _, _, code := export(r.userA, "format=pdf"); code != http.StatusUnprocessableEntity {
		t.Fatalf("bad format: %d", code)
	}
	if _, _, code := export(r.userA, ""); code != http.StatusUnprocessableEntity {
		t.Fatalf("no format: %d", code)
	}

	// The administrator sees none of A's annotations; anonymous requests are refused.
	if h, _ := list(r.admin, ""); h.Total != 0 {
		t.Fatalf("admin: %+v", h)
	}
	for _, p := range []string{"/annotations", "/annotations/titles", "/annotations/export?format=json"} {
		if resp := e.Do("GET", p, "", nil); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("anonymous %s: %d", p, resp.StatusCode)
		}
	}

	// Without a grant on the library, its annotations drop out of the list, the titles and the export.
	if resp := e.Do("DELETE", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+r.lib, r.admin, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke grant: %d %s", resp.StatusCode, resp.Body)
	}
	if h, _ := list(r.userA, ""); h.Total != 0 || len(h.Items) != 0 {
		t.Fatalf("after losing the grant: %+v", h)
	}
	e.Do("GET", "/annotations/titles", r.userA, nil).JSON(t, &titles)
	if len(titles.Items) != 0 {
		t.Fatalf("titles after losing the grant: %+v", titles)
	}
	if body, _, _ := export(r.userA, "format=json"); strings.Contains(body, "Tale") {
		t.Fatalf("export after losing the grant: %s", body)
	}
}
