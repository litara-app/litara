package httpapi_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
	"github.com/deranjer/ebooker/apps/server/internal/integrations"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

const (
	nsAtom      = "http://www.w3.org/2005/Atom"
	nsDC        = "http://purl.org/dc/terms/"
	nsOS        = "http://a9.com/-/spec/opensearch/1.1/"
	trickyTitle = `A & B <Fixture> "quoted" é`
)

type opdsEnv struct {
	e                 *apitest.Env
	admin, userA      string
	userB             string
	lib, root         string
	credA, credB      wire.T006Credential
	pwA, pwB          string
	epubPath, cbzPath string
}

// epubTitled writes an epub whose OPF metadata is XML-escaped; the shared epub
// helper concatenates raw text, which a title containing markup would break.
func epubTitled(t *testing.T, p, title, author, isbn string) {
	t.Helper()
	esc := func(s string) string {
		var b bytes.Buffer
		_ = xml.EscapeText(&b, []byte(s))
		return b.String()
	}
	epub(t, p, esc(title), esc(author), isbn)
}

func basicAuth(user, pass string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+pass))
}

func newOPDSEnv(t *testing.T) *opdsEnv {
	t.Helper()
	e := apitest.New(t)
	root, _ := filepath.Abs(filepath.Join(e.Cfg.MediaRoot, "opds"))
	_ = os.MkdirAll(root, 0o755)
	admin := e.Login(seed.AdminName, "cli").AccessToken
	o := &opdsEnv{e: e, admin: admin, root: root,
		userA: e.Login(seed.UserAName, "phone").AccessToken, userB: e.Login(seed.UserBName, "tablet").AccessToken,
		pwA: secret("opds-a-"), pwB: secret("opds-b-")}
	if r := e.Do("PUT", "/admin/integrations/settings", admin, settingsBody("0", true, false, false, 26214400, 10)); r.StatusCode != 200 {
		t.Fatalf("enable: %d %s", r.StatusCode, r.Body)
	}
	d := setupLibrary(t, e, admin, root)
	o.lib = d.Library.ID
	if r := e.Do("PUT", "/admin/users/"+e.Fix.UserAID.String()+"/libraries/"+o.lib, admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d %s", r.StatusCode, r.Body)
	}
	o.epubPath = filepath.Join(root, "Saga", "vol2.epub")
	epubTitled(t, o.epubPath, trickyTitle, "Ada Author", "978-1-4028-9462-6")
	epub(t, filepath.Join(root, "Zeta", "zebra.epub"), "Zebra Tales", "Zed Writer", "978-3-16-148410-0")
	o.cbzPath = filepath.Join(root, "Hero", "issue1.cbz")
	writeZip(t, o.cbzPath, map[string]string{"ComicInfo.xml": "<ComicInfo/>", "p/1.png": pngPage(10, 10), "p/2.png": pngPage(12, 12)})
	scanTwice(t, e, admin, o.lib)
	for _, c := range []struct {
		tok, pw string
		dst     *wire.T006Credential
	}{{o.userA, o.pwA, &o.credA}, {o.userB, o.pwB, &o.credB}} {
		r := createCred(e, c.tok, "opds", "reader", c.pw)
		if r.StatusCode != 201 {
			t.Fatalf("credential: %d %s", r.StatusCode, r.Body)
		}
		r.JSON(t, c.dst)
	}
	return o
}

// get sends an authenticated OPDS request over the (forwarded) HTTPS transport.
func (o *opdsEnv) get(path, user, pass string, extra ...string) apitest.Response {
	return o.do("GET", path, user, pass, extra...)
}

func (o *opdsEnv) do(method, path, user, pass string, extra ...string) apitest.Response {
	hdr := []string{"X-Forwarded-Proto", "https"}
	if user != "" {
		hdr = append(hdr, "Authorization", basicAuth(user, pass))
	}
	return o.e.Proto(method, path, nil, append(hdr, extra...)...)
}

func (o *opdsEnv) asA(path string, extra ...string) apitest.Response {
	return o.get(path, o.credA.Username, o.pwA, extra...)
}

// ---- independent decoders (namespace-aware Atom, JSON) ---------------------

type atomLink struct {
	Rel    string `xml:"rel,attr"`
	Href   string `xml:"href,attr"`
	Type   string `xml:"type,attr"`
	Length string `xml:"length,attr"`
}

type atomEntry struct {
	ID      string `xml:"http://www.w3.org/2005/Atom id"`
	Title   string `xml:"http://www.w3.org/2005/Atom title"`
	Updated string `xml:"http://www.w3.org/2005/Atom updated"`
	Authors []struct {
		Name string `xml:"http://www.w3.org/2005/Atom name"`
	} `xml:"http://www.w3.org/2005/Atom author"`
	Language string     `xml:"http://purl.org/dc/terms/ language"`
	Summary  string     `xml:"http://www.w3.org/2005/Atom summary"`
	Links    []atomLink `xml:"http://www.w3.org/2005/Atom link"`
}

type atomFeed struct {
	XMLName xml.Name    `xml:"http://www.w3.org/2005/Atom feed"`
	ID      string      `xml:"http://www.w3.org/2005/Atom id"`
	Title   string      `xml:"http://www.w3.org/2005/Atom title"`
	Updated string      `xml:"http://www.w3.org/2005/Atom updated"`
	Total   int         `xml:"http://a9.com/-/spec/opensearch/1.1/ totalResults"`
	PerPage int         `xml:"http://a9.com/-/spec/opensearch/1.1/ itemsPerPage"`
	Links   []atomLink  `xml:"http://www.w3.org/2005/Atom link"`
	Entries []atomEntry `xml:"http://www.w3.org/2005/Atom entry"`
}

func (f atomFeed) link(rel string) string {
	for _, l := range f.Links {
		if l.Rel == rel {
			return l.Href
		}
	}
	return ""
}

func (e atomEntry) link(rel string) *atomLink {
	for i := range e.Links {
		if e.Links[i].Rel == rel {
			return &e.Links[i]
		}
	}
	return nil
}

func decodeAtom(t *testing.T, r apitest.Response) atomFeed {
	t.Helper()
	var f atomFeed
	if err := xml.Unmarshal(r.Body, &f); err != nil {
		t.Fatalf("atom: %v\n%s", err, r.Body)
	}
	return f
}

type jLinkT struct {
	Rel       any    `json:"rel"`
	Href      string `json:"href"`
	Type      string `json:"type"`
	Templated bool   `json:"templated"`
}

type jPubT struct {
	Metadata struct {
		Identifier  string `json:"identifier"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Author      []struct {
			Name string `json:"name"`
		} `json:"author"`
		Narrator []struct {
			Name string `json:"name"`
		} `json:"narrator"`
	} `json:"metadata"`
	Links  []jLinkT `json:"links"`
	Images []struct {
		Href string `json:"href"`
		Type string `json:"type"`
	} `json:"images"`
}

type jFeedT struct {
	Metadata struct {
		Title         string `json:"title"`
		NumberOfItems int    `json:"numberOfItems"`
		ItemsPerPage  int    `json:"itemsPerPage"`
		CurrentPage   int    `json:"currentPage"`
	} `json:"metadata"`
	Links        []jLinkT `json:"links"`
	Navigation   []jLinkT `json:"navigation"`
	Publications []jPubT  `json:"publications"`
}

func (f jFeedT) link(rel string) string {
	for _, l := range f.Links {
		if l.Rel == rel {
			return l.Href
		}
	}
	return ""
}

func (p jPubT) link(rel string) *jLinkT {
	for i := range p.Links {
		if p.Links[i].Rel == rel {
			return &p.Links[i]
		}
	}
	return nil
}

func decodeJSONFeed(t *testing.T, r apitest.Response) jFeedT {
	t.Helper()
	var f jFeedT
	if err := json.Unmarshal(r.Body, &f); err != nil {
		t.Fatalf("json feed: %v\n%s", err, r.Body)
	}
	return f
}

// pathOf strips the configured origin from an absolute link.
func (o *opdsEnv) pathOf(t *testing.T, href string) string {
	t.Helper()
	if !strings.HasPrefix(href, o.e.Cfg.PublicOrigin+"/") {
		t.Fatalf("link %q is not under the configured public origin %q", href, o.e.Cfg.PublicOrigin)
	}
	return strings.TrimPrefix(href, o.e.Cfg.PublicOrigin)
}

// ---- tests ------------------------------------------------------------------

func TestOPDSAuthenticationBoundaries(t *testing.T) {
	o := newOPDSEnv(t)
	e := o.e
	paths := []string{"/opds/v1", "/opds/v2", "/opds/v1/publications", "/opds/v2/publications", "/opds/v1/search.xml",
		"/opds/v1/publications/" + uuid.NewString(), "/opds/v2/publications/" + uuid.NewString(),
		"/opds/files/" + uuid.NewString() + "/versions/" + uuid.NewString() + "/content",
		"/opds/publications/" + uuid.NewString() + "/artwork"}
	for _, p := range paths {
		for _, m := range []string{"GET", "HEAD"} {
			if strings.HasSuffix(p, "search.xml") && m == "HEAD" {
				continue
			}
			r := o.do(m, p, "", "")
			if r.StatusCode != 401 || !strings.HasPrefix(r.Header.Get("WWW-Authenticate"), "Basic ") {
				t.Fatalf("%s %s unauthenticated: %d %q", m, p, r.StatusCode, r.Header.Get("WWW-Authenticate"))
			}
		}
	}
	// Plain HTTP (no forwarded HTTPS, not dev mode) is refused before credentials are read.
	r := e.Proto("GET", "/opds/v1", nil, "Authorization", basicAuth(o.credA.Username, o.pwA))
	if r.StatusCode != 403 || r.Code() != "https_required" {
		t.Fatalf("plain http: %d %s", r.StatusCode, r.Body)
	}
	// The designated credential works; feeds are private and vary on Authorization.
	ok := o.asA("/opds/v1")
	if ok.StatusCode != 200 || ok.Header.Get("Cache-Control") != "private, no-store" || ok.Header.Get("Vary") != "Authorization" {
		t.Fatalf("root: %d cache=%q vary=%q", ok.StatusCode, ok.Header.Get("Cache-Control"), ok.Header.Get("Vary"))
	}
	// Wrong secret, the main account password, a bearer token and a KOReader credential are all refused.
	kpw := secret("ko-")
	kr := createCred(e, o.userA, "koreader", "kobo", kpw)
	var kc wire.T006Credential
	kr.JSON(t, &kc)
	for name, c := range map[string][2]string{"wrong secret": {o.credA.Username, "x" + o.pwA}, "main password": {seed.UserAName, e.Password},
		"koreader credential": {kc.Username, kpw}, "koreader md5 key": {kc.Username, integrations.KOKey(kpw)}, "other user's secret": {o.credA.Username, o.pwB}} {
		if x := o.get("/opds/v1", c[0], c[1]); x.StatusCode != 401 || strings.Contains(string(x.Body), o.pwA) {
			t.Fatalf("%s: %d %s", name, x.StatusCode, x.Body)
		}
	}
	bearer := e.Login(seed.UserAName, "x").AccessToken
	if x := e.Proto("GET", "/opds/v1", nil, "X-Forwarded-Proto", "https", "Authorization", "Bearer "+bearer); x.StatusCode != 401 {
		t.Fatalf("bearer on OPDS: %d", x.StatusCode)
	}
	// An OPDS secret gives no management authority (bearer or Basic).
	if x := e.Proto("GET", "/api/v1/integration-credentials", nil, "X-Forwarded-Proto", "https", "Authorization", basicAuth(o.credA.Username, o.pwA)); x.StatusCode != 401 {
		t.Fatalf("basic on management API: %d", x.StatusCode)
	}

	// Disabled service: authenticated callers get 503 integration_disabled; the unauthenticated still get 401.
	if x := e.Do("PUT", "/admin/integrations/settings", o.admin, settingsBody("1", false, false, false, 26214400, 10)); x.StatusCode != 200 {
		t.Fatalf("disable: %d %s", x.StatusCode, x.Body)
	}
	if x := o.asA("/opds/v1"); x.StatusCode != 503 || x.Code() != "integration_disabled" {
		t.Fatalf("disabled: %d %s", x.StatusCode, x.Body)
	}
	if x := o.get("/opds/v1", "", ""); x.StatusCode != 401 {
		t.Fatalf("disabled unauthenticated: %d", x.StatusCode)
	}
	if x := e.Do("PUT", "/admin/integrations/settings", o.admin, settingsBody("2", true, false, false, 26214400, 10)); x.StatusCode != 200 {
		t.Fatalf("re-enable: %d %s", x.StatusCode, x.Body)
	}

	// Revocation and account disablement take effect on the very next request.
	if x := e.Do("POST", "/integration-credentials/"+o.credB.ID+"/revoke", o.userB, map[string]any{"operationId": uuid.NewString()}); x.StatusCode != 200 {
		t.Fatalf("revoke: %d %s", x.StatusCode, x.Body)
	}
	if x := o.get("/opds/v2", o.credB.Username, o.pwB); x.StatusCode != 401 {
		t.Fatalf("revoked: %d", x.StatusCode)
	}
	if x := o.asA("/opds/v2"); x.StatusCode != 200 {
		t.Fatalf("before disable: %d", x.StatusCode)
	}
	if x := e.Do("PATCH", "/admin/users/"+e.Fix.UserAID.String(), o.admin, map[string]any{"active": false}); x.StatusCode != 200 {
		t.Fatalf("disable user: %d %s", x.StatusCode, x.Body)
	}
	for _, p := range []string{"/opds/v1", "/opds/v2", "/opds/v1/publications"} {
		if x := o.asA(p); x.StatusCode != 401 {
			t.Fatalf("disabled account %s: %d", p, x.StatusCode)
		}
	}
}

func TestOPDSDevelopmentHTTPException(t *testing.T) {
	e := apitest.New(t, apitest.Options{Cfg: httpapiConfigDev()})
	admin := e.Login(seed.AdminName, "cli").AccessToken
	userA := e.Login(seed.UserAName, "phone").AccessToken
	e.Do("PUT", "/admin/integrations/settings", admin, settingsBody("0", true, false, false, 26214400, 10))
	pw := secret("dev-")
	var c wire.T006Credential
	createCred(e, userA, "opds", "dev", pw).JSON(t, &c)
	r := e.Proto("GET", "/opds/v1", nil, "Authorization", basicAuth(c.Username, pw))
	if r.StatusCode != 200 {
		t.Fatalf("explicit development HTTP exception: %d %s", r.StatusCode, r.Body)
	}
}

func TestOPDSFeedsProjectOneGrantedDataset(t *testing.T) {
	o := newOPDSEnv(t)

	// Root navigation in both versions; library entries for granted libraries only.
	root1 := decodeAtom(t, o.asA("/opds/v1"))
	if root1.link("search") == "" || root1.link("start") == "" || root1.link("self") == "" || len(root1.Entries) < 2 {
		t.Fatalf("v1 root: %+v", root1)
	}
	var root2 jFeedT
	r2 := o.asA("/opds/v2")
	if r2.Header.Get("Content-Type") != "application/opds+json" {
		t.Fatalf("v2 content type %q", r2.Header.Get("Content-Type"))
	}
	root2 = decodeJSONFeed(t, r2)
	if len(root2.Navigation) != len(root1.Entries) {
		t.Fatalf("navigation differs: v1 %d v2 %d", len(root1.Entries), len(root2.Navigation))
	}
	var tmpl *jLinkT
	for i := range root2.Links {
		if root2.Links[i].Rel == "search" {
			tmpl = &root2.Links[i]
		}
	}
	if tmpl == nil || !tmpl.Templated || !strings.Contains(tmpl.Href, "{?q") {
		t.Fatalf("v2 search template: %+v", root2.Links)
	}
	osd := o.asA("/opds/v1/search.xml")
	if osd.StatusCode != 200 || !strings.HasPrefix(osd.Header.Get("Content-Type"), "application/opensearchdescription+xml") {
		t.Fatalf("opensearch: %d %q", osd.StatusCode, osd.Header.Get("Content-Type"))
	}
	var od struct {
		XMLName xml.Name `xml:"http://a9.com/-/spec/opensearch/1.1/ OpenSearchDescription"`
		URL     struct {
			Template string `xml:"template,attr"`
			Type     string `xml:"type,attr"`
		} `xml:"http://a9.com/-/spec/opensearch/1.1/ Url"`
	}
	if err := xml.Unmarshal(osd.Body, &od); err != nil || !strings.Contains(od.URL.Template, "{searchTerms}") {
		t.Fatalf("opensearch doc: %v %s", err, osd.Body)
	}

	f1 := decodeAtom(t, o.asA("/opds/v1/publications?size=200"))
	f2 := decodeJSONFeed(t, o.asA("/opds/v2/publications?size=200"))
	// 2 epubs + 1 comic in the new library, 5 audio files (3 + 1 + the one available file of the incomplete recording).
	if f1.Total != 8 || f2.Metadata.NumberOfItems != 8 || len(f1.Entries) != 8 || len(f2.Publications) != 8 {
		t.Fatalf("totals: v1 %d/%d v2 %d/%d", f1.Total, len(f1.Entries), f2.Metadata.NumberOfItems, len(f2.Publications))
	}
	type row struct{ title, acq, mime string }
	got1, got2 := map[string]row{}, map[string]row{}
	for _, en := range f1.Entries {
		acq := en.link("http://opds-spec.org/acquisition")
		if acq == nil || en.link("http://opds-spec.org/open-access") != nil {
			t.Fatalf("v1 acquisition relation: %+v", en.Links)
		}
		if !strings.HasPrefix(en.ID, "urn:uuid:") || en.Updated == "" || len(en.Authors) == 0 {
			t.Fatalf("v1 entry fields: %+v", en)
		}
		got1[strings.TrimPrefix(en.ID, "urn:uuid:")] = row{en.Title, acq.Href, acq.Type}
	}
	for _, p := range f2.Publications {
		acq := p.link("http://opds-spec.org/acquisition")
		if acq == nil {
			t.Fatalf("v2 acquisition: %+v", p.Links)
		}
		got2[strings.TrimPrefix(p.Metadata.Identifier, "urn:uuid:")] = row{p.Metadata.Title, acq.Href, acq.Type}
	}
	if len(got1) != 8 || len(got2) != 8 {
		t.Fatalf("distinct ids: %d %d", len(got1), len(got2))
	}
	for id, a := range got1 {
		if b, ok := got2[id]; !ok || a != b {
			t.Fatalf("versions disagree for %s: %+v vs %+v", id, a, b)
		}
	}

	// Metadata is decoded intact (escaping round-trips) and the epub's publication ID is its edition ID.
	var eds wire.T005Editions
	o.e.Do("GET", "/editions?libraryId="+o.lib+"&size=200", o.userA, nil).JSON(t, &eds)
	if len(eds.Items) != 3 {
		t.Fatalf("editions: %d", len(eds.Items))
	}
	found := false
	for _, ed := range eds.Items {
		if r, ok := got1[ed.ID]; ok && r.title == trickyTitle {
			found = true
			wantAcq := o.e.Cfg.PublicOrigin + "/opds/files/" + ed.File.ID + "/versions/" + ed.File.ContentVersion + "/content"
			if r.acq != wantAcq || r.mime != "application/epub+zip" {
				t.Fatalf("epub acquisition: %+v want %s", r, wantAcq)
			}
		}
	}
	if !found {
		t.Fatalf("escaped title not found: %+v", got1)
	}
	// Both raw documents are well formed and carry no executable markup.
	if strings.Contains(string(o.asA("/opds/v1/publications?size=200").Body), "<Fixture>") {
		t.Fatal("unescaped markup in Atom")
	}

	// Audio: one file per publication, identified by file ID, ordered, never a whole-recording bundle.
	three := o.e.Fix.Files["r1-f2"]
	a1, ok := got1[three.ID.String()]
	if !ok || !strings.HasSuffix(a1.title, "(file 2 of 3)") || a1.mime != "audio/mpeg" {
		t.Fatalf("audio publication: %+v ok=%v", a1, ok)
	}
	if want := o.e.Cfg.PublicOrigin + "/opds/files/" + three.ID.String() + "/versions/" + three.Version.String() + "/content"; a1.acq != want {
		t.Fatalf("audio acquisition %q want %q", a1.acq, want)
	}
	det := decodeJSONFeedPublication(t, o.asA("/opds/v2/publications/"+three.ID.String()))
	if !strings.Contains(det.Metadata.Description, "individual original file, not a complete-recording package") || len(det.Metadata.Narrator) != 1 {
		t.Fatalf("audio description: %+v", det.Metadata)
	}
	for _, l := range det.Links {
		if l.Rel == "http://opds-spec.org/acquisition" && !strings.Contains(l.Href, three.ID.String()) {
			t.Fatalf("acquisition names another file: %s", l.Href)
		}
	}
	// The incomplete recording's available file is still an original download (distinct from playback readiness).
	inc := o.e.Fix.Files["r3-f1"]
	if _, ok := got1[inc.ID.String()]; !ok {
		t.Fatal("incomplete recording's available file must be offered")
	}
	if _, ok := got1[o.e.Fix.Files["r3-f2"].ID.String()]; ok {
		t.Fatal("an unavailable file must never be advertised")
	}
	// Ordering: normalized base title; one recording's files stay together in file order.
	suffix := regexp.MustCompile(` \(file (\d+) of (\d+)\)$`)
	var bases []string
	lastRecording, lastOrder := "", 0
	for _, en := range f1.Entries {
		base := suffix.ReplaceAllString(en.Title, "")
		bases = append(bases, strings.ToLower(base))
		if m := suffix.FindStringSubmatch(en.Title); m != nil {
			n, _ := strconv.Atoi(m[1])
			key := base + "/" + m[2]
			if key == lastRecording && n < lastOrder {
				t.Fatalf("files of %q out of order: %d after %d", base, n, lastOrder)
			}
			lastRecording, lastOrder = key, n
		}
	}
	if !sort.StringsAreSorted(bases) {
		t.Fatalf("not sorted by normalized title: %v", bases)
	}

	// Another account sees only its own granted library, never the first account's metadata.
	other := o.e.Fix.Files["r4-f1"]
	kb := createCred(o.e, o.userB, "opds", "b2", secret("b2-"))
	var cb wire.T006Credential
	kb.JSON(t, &cb)
	bf := decodeAtom(t, o.get("/opds/v1/publications?size=200", cb.Username, secret("b2-")))
	if bf.Total != 1 || len(bf.Entries) != 1 || strings.TrimPrefix(bf.Entries[0].ID, "urn:uuid:") != other.ID.String() {
		t.Fatalf("user B dataset: %+v", bf.Entries)
	}
	for id := range got1 {
		if id == other.ID.String() {
			t.Fatal("user A must not see library 2")
		}
	}
	// Ungranted and unknown details are indistinguishable 404s with no metadata.
	for _, id := range []string{three.ID.String(), uuid.NewString()} {
		r := o.get("/opds/v2/publications/"+id, cb.Username, secret("b2-"))
		if r.StatusCode != 404 || strings.Contains(string(r.Body), "Fixture") || r.Code() != "not_found" {
			t.Fatalf("detail %s as B: %d %s", id, r.StatusCode, r.Body)
		}
		r = o.get("/opds/v1/publications/"+id, cb.Username, secret("b2-"))
		if r.StatusCode != 404 {
			t.Fatalf("v1 detail %s as B: %d", id, r.StatusCode)
		}
	}
}

func decodeJSONFeedPublication(t *testing.T, r apitest.Response) jPubT {
	t.Helper()
	if r.StatusCode != 200 || r.Header.Get("Content-Type") != "application/opds-publication+json" {
		t.Fatalf("publication: %d %q %s", r.StatusCode, r.Header.Get("Content-Type"), r.Body)
	}
	var p jPubT
	if err := json.Unmarshal(r.Body, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestOPDSSearchPaginationAndFilters(t *testing.T) {
	o := newOPDSEnv(t)
	all := decodeAtom(t, o.asA("/opds/v1/publications?size=200"))
	var order []string
	for _, en := range all.Entries {
		order = append(order, en.ID)
	}

	// Deterministic pages concatenate to the full ordering, in both versions.
	for _, version := range []string{"v1", "v2"} {
		var ids []string
		next := "/opds/" + version + "/publications?size=3"
		for next != "" {
			r := o.asA(next)
			if version == "v1" {
				f := decodeAtom(t, r)
				if f.Total != 8 || f.PerPage != 3 {
					t.Fatalf("v1 page meta: %+v", f)
				}
				for _, en := range f.Entries {
					ids = append(ids, en.ID)
				}
				next = ""
				if n := f.link("next"); n != "" {
					next = o.pathOf(t, n)
				}
			} else {
				f := decodeJSONFeed(t, r)
				if f.Metadata.NumberOfItems != 8 || f.Metadata.ItemsPerPage != 3 {
					t.Fatalf("v2 page meta: %+v", f.Metadata)
				}
				for _, p := range f.Publications {
					ids = append(ids, p.Metadata.Identifier)
				}
				next = ""
				if n := f.link("next"); n != "" {
					next = o.pathOf(t, n)
				}
			}
		}
		if strings.Join(ids, ",") != strings.Join(order, ",") {
			t.Fatalf("%s pages differ:\n%v\n%v", version, ids, order)
		}
	}
	// A page past the end is empty, not an error; previous/first links exist.
	past := decodeAtom(t, o.asA("/opds/v1/publications?size=3&page=40"))
	if len(past.Entries) != 0 || past.link("previous") == "" || past.link("first") == "" {
		t.Fatalf("past end: %+v", past)
	}
	// size is capped at 200 and rejects nonsense.
	if r := o.asA("/opds/v1/publications?size=100000"); r.StatusCode != 200 || decodeAtom(t, r).PerPage != 200 {
		t.Fatalf("size cap: %d", r.StatusCode)
	}
	for _, bad := range []string{"size=0", "size=x", "page=-1", "libraryId=nope", "mediaKind=video", "q=" + strings.Repeat("a", 600)} {
		if r := o.asA("/opds/v1/publications?" + bad); r.StatusCode != 422 {
			t.Fatalf("%s: %d %s", bad, r.StatusCode, r.Body)
		}
	}

	titlesFor := func(qs string) []string {
		f := decodeAtom(t, o.asA("/opds/v1/publications?"+qs))
		var out []string
		for _, en := range f.Entries {
			out = append(out, en.Title)
		}
		return out
	}
	if got := titlesFor("q=ZEBRA"); len(got) != 1 || got[0] != "Zebra Tales" {
		t.Fatalf("case-insensitive title: %v", got)
	}
	if got := titlesFor("q=zed+writer"); len(got) != 1 {
		t.Fatalf("author search: %v", got)
	}
	if got := titlesFor("q=" + url.QueryEscape("é")); len(got) != 1 { // composed
		t.Fatalf("composed accent: %v", got)
	}
	if got := titlesFor("q=" + url.QueryEscape("é")); len(got) != 1 { // decomposed form matches the composed title
		t.Fatalf("decomposed accent: %v", got)
	}
	// Wildcards are literal: % and _ must not match everything.
	for _, q := range []string{"%25", "_", "a%25b"} {
		if got := titlesFor("q=" + q); len(got) != 0 {
			t.Fatalf("wildcard %q matched %v", q, got)
		}
	}
	// A literal ampersand in the title is searchable.
	if got := titlesFor("q=" + url.QueryEscape("a & b")); len(got) != 1 {
		t.Fatalf("ampersand: %v", got)
	}
	// Filters.
	if got := titlesFor("mediaKind=audio"); len(got) != 5 {
		t.Fatalf("audio: %v", got)
	}
	if got := titlesFor("mediaKind=comic"); len(got) != 1 {
		t.Fatalf("comic: %v", got)
	}
	if got := titlesFor("mediaKind=ebook&libraryId=" + o.lib); len(got) != 2 {
		t.Fatalf("ebook in library: %v", got)
	}
	// An ungranted library filter yields an empty list that does not confirm the library exists.
	if got := titlesFor("libraryId=" + o.e.Fix.Lib2.String()); len(got) != 0 {
		t.Fatalf("ungranted library: %v", got)
	}
}

func TestOPDSOriginalAcquisitionHeadRangeAndReplacement(t *testing.T) {
	o := newOPDSEnv(t)
	var eds wire.T005Editions
	o.e.Do("GET", "/editions?libraryId="+o.lib+"&size=200", o.userA, nil).JSON(t, &eds)
	var ed wire.T005Edition
	for _, en := range decodeAtom(t, o.asA("/opds/v1/publications?q=fixture")).Entries {
		if en.Title != trickyTitle {
			continue
		}
		for _, x := range eds.Items {
			if x.ID == strings.TrimPrefix(en.ID, "urn:uuid:") {
				ed = x
			}
		}
	}
	if ed.ID == "" {
		t.Fatalf("edition not found: %+v", eds.Items)
	}
	path := "/opds/files/" + ed.File.ID + "/versions/" + ed.File.ContentVersion + "/content"
	want, err := os.ReadFile(o.epubPath)
	if err != nil {
		t.Fatal(err)
	}

	r := o.asA(path)
	if r.StatusCode != 200 || !bytes.Equal(r.Body, want) {
		t.Fatalf("download: %d len=%d want=%d", r.StatusCode, len(r.Body), len(want))
	}
	etag := r.Header.Get("ETag")
	if etag != `"`+ed.File.ContentVersion+`"` || strings.HasPrefix(etag, "W/") {
		t.Fatalf("etag %q", etag)
	}
	if r.Header.Get("Content-Type") != "application/epub+zip" || r.Header.Get("Accept-Ranges") != "bytes" ||
		r.Header.Get("Cache-Control") != "private, no-store" || !strings.Contains(r.Header.Get("Content-Disposition"), "attachment") {
		t.Fatalf("headers: %v", r.Header)
	}
	if strings.Contains(r.Header.Get("Content-Disposition"), "\n") {
		t.Fatal("header injection")
	}
	// HEAD: identical headers, no body.
	h := o.do("HEAD", path, o.credA.Username, o.pwA)
	if h.StatusCode != 200 || len(h.Body) != 0 || h.Header.Get("Content-Length") != r.Header.Get("Content-Length") || h.Header.Get("ETag") != etag {
		t.Fatalf("head: %d len=%d %v", h.StatusCode, len(h.Body), h.Header)
	}
	// Range, If-Match and If-None-Match.
	rg := o.asA(path, "Range", "bytes=2-9")
	if rg.StatusCode != 206 || !bytes.Equal(rg.Body, want[2:10]) || rg.Header.Get("Content-Range") != "bytes 2-9/"+itoa(len(want)) {
		t.Fatalf("range: %d %q %v", rg.StatusCode, rg.Header.Get("Content-Range"), rg.Body)
	}
	if x := o.asA(path, "Range", "bytes=999999999-"); x.StatusCode != 416 || !strings.HasPrefix(x.Header.Get("Content-Range"), "bytes */") {
		t.Fatalf("416: %d %v", x.StatusCode, x.Header)
	}
	if x := o.asA(path, "Range", "bytes=oops"); x.StatusCode != 400 {
		t.Fatalf("malformed range: %d", x.StatusCode)
	}
	if x := o.asA(path, "If-Match", `"other"`); x.StatusCode != 412 {
		t.Fatalf("if-match: %d", x.StatusCode)
	}
	if x := o.asA(path, "If-None-Match", etag); x.StatusCode != 304 {
		t.Fatalf("if-none-match: %d", x.StatusCode)
	}
	// Rights are re-evaluated on every range retry: after revocation a range request fails.
	// Another account (no grant on this library) cannot learn the file exists: 404, same as unknown.
	cb := createCred(o.e, o.userB, "opds", "b", secret("bb-"))
	var credB2 wire.T006Credential
	cb.JSON(t, &credB2)
	for _, p := range []string{path, "/opds/files/" + uuid.NewString() + "/versions/" + uuid.NewString() + "/content", "/opds/files/not-a-uuid/versions/x/content"} {
		x := o.get(p, credB2.Username, secret("bb-"))
		if x.StatusCode != 404 || x.Code() != "not_found" {
			t.Fatalf("ungranted/unknown %s: %d %s", p, x.StatusCode, x.Body)
		}
		if y := o.do("HEAD", p, credB2.Username, secret("bb-")); y.StatusCode != 404 {
			t.Fatalf("ungranted HEAD: %d", y.StatusCode)
		}
	}
	// Revoking the credential stops an in-progress range sequence.
	o.e.Do("POST", "/integration-credentials/"+o.credA.ID+"/revoke", o.userA, map[string]any{"operationId": uuid.NewString()})
	if x := o.asA(path, "Range", "bytes=0-3"); x.StatusCode != 401 {
		t.Fatalf("range after revoke: %d", x.StatusCode)
	}
	// Fresh credential for the replacement checks.
	pw := secret("fresh-")
	var c2 wire.T006Credential
	createCred(o.e, o.userA, "opds", "fresh", pw).JSON(t, &c2)
	get := func(p string, extra ...string) apitest.Response { return o.get(p, c2.Username, pw, extra...) }

	// Replacement: new bytes get a new content version; the old link is 412, the feed shows the new one.
	if err := os.WriteFile(o.epubPath, append(append([]byte{}, want...), []byte("PADDING")...), 0o644); err != nil {
		t.Fatal(err)
	}
	scanTwice(t, o.e, o.admin, o.lib)
	if x := get(path); x.StatusCode != 412 || x.Code() != "content_changed" {
		t.Fatalf("superseded version: %d %s", x.StatusCode, x.Body)
	}
	feed := decodeAtom(t, get("/opds/v1/publications?size=200"))
	var cur string
	for _, en := range feed.Entries {
		if strings.TrimPrefix(en.ID, "urn:uuid:") == ed.ID {
			cur = o.pathOf(t, en.link("http://opds-spec.org/acquisition").Href)
		}
	}
	if cur == "" || cur == path {
		t.Fatalf("feed must advertise the new version: %q", cur)
	}
	if x := get(cur); x.StatusCode != 200 || !bytes.HasSuffix(x.Body, []byte("PADDING")) {
		t.Fatalf("new version: %d", x.StatusCode)
	}
	// Missing bytes are never served or advertised: delete the file and rescan.
	if err := os.Remove(o.epubPath); err != nil {
		t.Fatal(err)
	}
	if x := get(cur); x.StatusCode != 503 {
		t.Fatalf("missing bytes before rescan: %d %s", x.StatusCode, x.Body)
	}
	scanTwice(t, o.e, o.admin, o.lib)
	after := decodeAtom(t, get("/opds/v1/publications?size=200"))
	for _, en := range after.Entries {
		if strings.TrimPrefix(en.ID, "urn:uuid:") == ed.ID {
			t.Fatalf("an unavailable original must not be advertised: %+v", en)
		}
	}
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func TestOPDSAudioOriginalsAndArtwork(t *testing.T) {
	o := newOPDSEnv(t)
	f2 := o.e.Fix.Files["r1-f2"]
	raw, err := os.ReadFile(f2.Path)
	if err != nil {
		t.Fatal(err)
	}
	r := o.asA("/opds/files/" + f2.ID.String() + "/versions/" + f2.Version.String() + "/content")
	if r.StatusCode != 200 || !bytes.Equal(r.Body, raw) || r.Header.Get("Content-Type") != "audio/mpeg" {
		t.Fatalf("audio original: %d len=%d", r.StatusCode, len(r.Body))
	}
	// The incomplete recording's available file downloads even though playback is not ready.
	inc := o.e.Fix.Files["r3-f1"]
	if x := o.asA("/opds/files/" + inc.ID.String() + "/versions/" + inc.Version.String() + "/content"); x.StatusCode != 200 {
		t.Fatalf("incomplete-recording original: %d %s", x.StatusCode, x.Body)
	}
	// The unavailable file is not downloadable (storage is missing: 404 because its size is unknown/absent version).
	missing := o.e.Fix.Files["r3-f2"]
	if x := o.asA("/opds/files/" + missing.ID.String() + "/versions/" + missing.Version.String() + "/content"); x.StatusCode == 200 {
		t.Fatalf("unavailable file served: %d", x.StatusCode)
	}

	// Artwork: the recording's cover for an audio publication; absent for ebooks; same grant check.
	art := o.asA("/opds/publications/" + f2.ID.String() + "/artwork")
	if art.StatusCode != 200 || art.Header.Get("Content-Type") != "image/png" || art.Header.Get("Cache-Control") != "private, no-store" || art.Header.Get("ETag") == "" {
		t.Fatalf("artwork: %d %v", art.StatusCode, art.Header)
	}
	if !bytes.HasPrefix(art.Body, []byte("\x89PNG")) {
		t.Fatal("artwork is not the PNG cover")
	}
	hd := o.do("HEAD", "/opds/publications/"+f2.ID.String()+"/artwork", o.credA.Username, o.pwA)
	if hd.StatusCode != 200 || len(hd.Body) != 0 || hd.Header.Get("Content-Length") != art.Header.Get("Content-Length") {
		t.Fatalf("artwork HEAD: %d len=%d", hd.StatusCode, len(hd.Body))
	}
	var eds wire.T005Editions
	o.e.Do("GET", "/editions?libraryId="+o.lib+"&size=200", o.userA, nil).JSON(t, &eds)
	if x := o.asA("/opds/publications/" + eds.Items[0].ID + "/artwork"); x.StatusCode != 404 {
		t.Fatalf("ebook artwork: %d", x.StatusCode)
	}
	// An image link is advertised only where artwork exists.
	feed := decodeAtom(t, o.asA("/opds/v1/publications?size=200"))
	withImage := 0
	for _, en := range feed.Entries {
		if en.link("http://opds-spec.org/image") != nil {
			withImage++
			if strings.TrimPrefix(en.ID, "urn:uuid:") != o.e.Fix.Files["r1-f1"].ID.String() && strings.TrimPrefix(en.ID, "urn:uuid:") != f2.ID.String() &&
				strings.TrimPrefix(en.ID, "urn:uuid:") != o.e.Fix.Files["r1-f3"].ID.String() {
				t.Fatalf("image link on a publication without artwork: %s", en.Title)
			}
		}
	}
	if withImage != 3 {
		t.Fatalf("image links: %d", withImage)
	}
	// Ungranted artwork is the same 404 as absent artwork.
	var cb wire.T006Credential
	createCred(o.e, o.userB, "opds", "b", secret("bart-")).JSON(t, &cb)
	if x := o.get("/opds/publications/"+f2.ID.String()+"/artwork", cb.Username, secret("bart-")); x.StatusCode != 404 {
		t.Fatalf("ungranted artwork: %d", x.StatusCode)
	}
	// Acquisition never changes personal state.
	var pos map[string]any
	o.e.Do("GET", "/editions/"+eds.Items[0].ID+"/position", o.userA, nil).JSON(t, &pos)
	if pos["revision"] != "0" {
		t.Fatalf("acquisition changed reading state: %v", pos)
	}
}

func httpapiConfigDev() httpapi.APIConfig { return httpapi.APIConfig{DevInsecureHTTP: true} }
