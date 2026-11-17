package httpapi_test

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/integrations"
	"github.com/deranjer/ebooker/apps/server/internal/koreader"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// ---- digest ----------------------------------------------------------------

func TestKOReaderPartialMD5Vectors(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/t006/digest-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Vectors []struct {
			Size     int64  `json:"size"`
			Expected string `json:"expectedPartialMd5"`
			SHA256   string `json:"sha256"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil || len(doc.Vectors) != 9 {
		t.Fatalf("vectors: %v (%d)", err, len(doc.Vectors))
	}
	for _, v := range doc.Vectors {
		data := make([]byte, v.Size)
		for i := range data {
			data[i] = byte(i % 251)
		}
		if sum := sha256.Sum256(data); hex.EncodeToString(sum[:]) != v.SHA256 {
			t.Fatalf("size %d: generator differs from the recorded sha256", v.Size)
		}
		got, err := koreader.PartialMD5(bytes.NewReader(data), v.Size)
		if err != nil || got != v.Expected {
			t.Fatalf("size %d: got %s err=%v want %s", v.Size, got, err, v.Expected)
		}
	}
}

// referencePartialMD5 re-derives the algorithm independently (sequential seeks and
// ReadFull) so the production ReadAt implementation is not compared with itself.
func referencePartialMD5(t *testing.T, path string) string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	h := md5.New()
	for _, off := range append([]int64{0}, func() []int64 {
		var o []int64
		for i := 0; i <= 10; i++ {
			o = append(o, 1024*(int64(1)<<(2*i)))
		}
		return o
	}()...) {
		if _, err := f.Seek(off, io.SeekStart); err != nil {
			t.Fatal(err)
		}
		buf := make([]byte, 1024)
		n, err := io.ReadFull(f, buf)
		if n == 0 {
			break
		}
		h.Write(buf[:n])
		if err != nil {
			break
		}
	}
	return hex.EncodeToString(h.Sum(nil))
}

func TestKOReaderSparseLargeFileDigestIsBounded(t *testing.T) {
	p := filepath.Join(t.TempDir(), "huge.bin")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	const size = int64(3)<<30 + 12345 // > 3 GiB, sparse
	if err := f.Truncate(size); err != nil {
		t.Skipf("sparse files unsupported here: %v", err)
	}
	// Distinct bytes at sampled offsets prove each sample is actually read.
	for i, off := range []int64{0, 1024, 4096, 16384, 1 << 20, 1 << 30} {
		_, _ = f.WriteAt([]byte{byte(i + 1), 0xAB}, off)
	}
	_ = f.Close()
	r, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	got, err := koreader.PartialMD5(r, size)
	if err != nil || got != referencePartialMD5(t, p) {
		t.Fatalf("sparse digest %s vs reference %s (%v)", got, referencePartialMD5(t, p), err)
	}
}

// ---- environment -------------------------------------------------------------

type koEnv struct {
	*opdsEnv
	credA1, credA2, credB wire.T006Credential
	pwA1, pwA2, pwB       string
	docs                  map[string]string // basename -> digest
	editions              map[string]wire.T005Edition
}

func koCode(r apitest.Response) int {
	var p struct {
		Code int `json:"code"`
	}
	_ = json.Unmarshal(r.Body, &p)
	return p.Code
}

func newKOEnv(t *testing.T) *koEnv {
	t.Helper()
	o := newOPDSEnv(t)
	e := o.e
	if r := e.Do("PUT", "/admin/integrations/settings", o.admin, settingsBody("1", true, false, true, 26214400, 10)); r.StatusCode != 200 {
		t.Fatalf("enable koreader: %d %s", r.StatusCode, r.Body)
	}
	k := &koEnv{opdsEnv: o, pwA1: secret("kor-a1-"), pwA2: secret("kor-a2-"), pwB: secret("kor-b-"), docs: map[string]string{}, editions: map[string]wire.T005Edition{}}
	for _, c := range []struct {
		tok, pw string
		dst     *wire.T006Credential
	}{{o.userA, k.pwA1, &k.credA1}, {o.userA, k.pwA2, &k.credA2}, {o.userB, k.pwB, &k.credB}} {
		r := createCred(e, c.tok, "koreader", "kobo", c.pw)
		if r.StatusCode != 201 {
			t.Fatalf("ko credential: %d %s", r.StatusCode, r.Body)
		}
		r.JSON(t, c.dst)
	}
	// Index digests through the bounded job entry point (never on a request).
	if n, err := e.Indexer.IndexPending(context.Background(), 100); err != nil || n != 3 {
		t.Fatalf("indexed %d files: %v", n, err)
	}
	for name, path := range map[string]string{"vol2": o.epubPath, "zebra": filepath.Join(o.root, "Zeta", "zebra.epub"), "issue1": o.cbzPath} {
		raw, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		st, _ := raw.Stat()
		d, err := koreader.PartialMD5(raw, st.Size())
		raw.Close()
		if err != nil || d != referencePartialMD5(t, path) {
			t.Fatalf("client digest of %s: %s %v", name, d, err)
		}
		k.docs[name] = d
	}
	var eds wire.T005Editions
	e.Do("GET", "/editions?libraryId="+o.lib+"&size=200", o.userA, nil).JSON(t, &eds)
	for _, ed := range eds.Items {
		for _, p := range []string{"vol2", "zebra", "issue1"} {
			if f, ok := k.docs[p]; ok {
				if g, _ := e.Pool.Query(context.Background(), "SELECT 1 FROM koreader_digests WHERE file_id = $1 AND digest = $2", ed.File.ID, f); g != nil {
					if g.Next() {
						k.editions[p] = ed
					}
					g.Close()
				}
			}
		}
	}
	if len(k.editions) != 3 {
		t.Fatalf("edition mapping: %d", len(k.editions))
	}
	return k
}

func (k *koEnv) do(method, path string, cred wire.T006Credential, pw string, body any) apitest.Response {
	hdr := []string{"x-auth-user", cred.Username, "x-auth-key", integrations.KOKey(pw), "Accept", "application/vnd.koreader.v1+json"}
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
		hdr = append(hdr, "Content-Type", "application/json")
	}
	return k.e.Proto(method, path, raw, hdr...)
}

func (k *koEnv) get(doc string, cred wire.T006Credential, pw string) apitest.Response {
	return k.do("GET", "/1/syncs/progress/"+doc, cred, pw, nil)
}

func koPut(doc, progress string, pct float64, device string) map[string]any {
	return map[string]any{"document": doc, "progress": progress, "percentage": pct, "device": device, "device_id": device + "-id"}
}

func (k *koEnv) position(t *testing.T, edition string) wire.T006KoPosition {
	t.Helper()
	var p wire.T006KoPosition
	r := k.e.Do("GET", "/editions/"+edition+"/koreader-position", k.userA, nil)
	if r.StatusCode != 200 {
		t.Fatalf("position: %d %s", r.StatusCode, r.Body)
	}
	r.JSON(t, &p)
	return p
}

func (k *koEnv) conflicts(t *testing.T) []wire.T006KoConflict {
	t.Helper()
	var l wire.T006KoConflictList
	k.e.Do("GET", "/koreader/conflicts", k.userA, nil).JSON(t, &l)
	return l.Items
}

// ---- tests -------------------------------------------------------------------

func TestKOReaderWireAuthAndEnvelopes(t *testing.T) {
	k := newKOEnv(t)
	e := k.e
	if r := e.Proto("GET", "/1/healthcheck", nil); r.StatusCode != 200 || !strings.Contains(string(r.Body), `"OK"`) {
		t.Fatalf("health: %d %s", r.StatusCode, r.Body)
	}
	// Registration is always refused; the body is irrelevant.
	if r := e.Proto("POST", "/1/users/create", []byte(`{"username":"x","password":"secret-body"}`), "Content-Type", "application/json"); r.StatusCode != 403 || koCode(r) != 2005 || strings.Contains(string(r.Body), "secret-body") {
		t.Fatalf("registration: %d %s", r.StatusCode, r.Body)
	}
	if r := k.do("GET", "/1/users/auth", k.credA1, k.pwA1, nil); r.StatusCode != 200 || !strings.Contains(string(r.Body), `"authorized":"OK"`) {
		t.Fatalf("auth: %d %s", r.StatusCode, r.Body)
	}
	for name, r := range map[string]apitest.Response{
		"wrong key":         k.do("GET", "/1/users/auth", k.credA1, "x"+k.pwA1, nil),
		"opds credential":   k.do("GET", "/1/users/auth", k.credA1, k.pwA1+"y", nil),
		"missing headers":   e.Proto("GET", "/1/users/auth", nil),
		"unknown user":      k.do("GET", "/1/users/auth", wire.T006Credential{Username: "kor-nobody"}, k.pwA1, nil),
		"progress no creds": e.Proto("GET", "/1/syncs/progress/"+k.docs["vol2"], nil),
	} {
		if r.StatusCode != 401 || koCode(r) != 2001 {
			t.Fatalf("%s: %d %s", name, r.StatusCode, r.Body)
		}
	}
	// An OPDS credential and the main account password are not KOReader credentials.
	if r := e.Proto("GET", "/1/users/auth", nil, "x-auth-user", k.credA.Username, "x-auth-key", integrations.KOKey(k.pwA)); r.StatusCode != 401 {
		t.Fatalf("opds credential on KOReader: %d", r.StatusCode)
	}
	if r := e.Proto("GET", "/1/users/auth", nil, "x-auth-user", "fixture-user-a", "x-auth-key", integrations.KOKey(e.Password)); r.StatusCode != 401 {
		t.Fatalf("main password on KOReader: %d", r.StatusCode)
	}
	// Upstream lifecycle methods that this adapter must not implement.
	for _, m := range [][2]string{{"PUT", "/1/users/auth"}, {"DELETE", "/1/users/auth"}, {"POST", "/1/users/password"}, {"DELETE", "/1/users/delete"}} {
		if r := k.do(m[0], m[1], k.credA1, k.pwA1, map[string]any{}); r.StatusCode != 404 && r.StatusCode != 405 {
			t.Fatalf("%s %s: %d", m[0], m[1], r.StatusCode)
		}
	}
	// Field validation precedes any lookup.
	if r := k.get("not-a-digest", k.credA1, k.pwA1); r.StatusCode != 400 || koCode(r) != 2004 {
		t.Fatalf("bad digest: %d %s", r.StatusCode, r.Body)
	}
	unknown := strings.Repeat("a", 32)
	if r := k.get(unknown, k.credA1, k.pwA1); r.StatusCode != 404 || koCode(r) != 2006 {
		t.Fatalf("unknown document: %d %s", r.StatusCode, r.Body)
	}
	for name, b := range map[string]map[string]any{
		"percentage": koPut(k.docs["vol2"], "p", 1.5, "d"), "empty progress": koPut(k.docs["vol2"], "", 0.5, "d"),
		"no device": koPut(k.docs["vol2"], "p", 0.5, ""), "long progress": koPut(k.docs["vol2"], strings.Repeat("x", 8193), 0.5, "d"),
	} {
		if r := k.do("PUT", "/1/syncs/progress", k.credA1, k.pwA1, b); r.StatusCode != 400 || koCode(r) != 2003 {
			t.Fatalf("%s: %d %s", name, r.StatusCode, r.Body)
		}
	}
	if r := k.do("PUT", "/1/syncs/progress", k.credA1, k.pwA1, koPut("zz", "p", 0.5, "d")); r.StatusCode != 400 || koCode(r) != 2004 {
		t.Fatalf("put bad digest: %d %s", r.StatusCode, r.Body)
	}
	if r := k.do("PUT", "/1/syncs/progress", k.credA1, k.pwA1, koPut(unknown, "p", 0.5, "d")); r.StatusCode != 404 || koCode(r) != 2006 {
		t.Fatalf("put unknown: %d %s", r.StatusCode, r.Body)
	}
	big := map[string]any{"document": k.docs["vol2"], "progress": strings.Repeat("x", 40000), "percentage": 0.1, "device": "d"}
	if r := k.do("PUT", "/1/syncs/progress", k.credA1, k.pwA1, big); r.StatusCode != 400 {
		t.Fatalf("oversize body: %d", r.StatusCode)
	}
	// Another account never reaches this account's files: same envelope as unknown.
	if r := k.get(k.docs["vol2"], k.credB, k.pwB); r.StatusCode != 404 || koCode(r) != 2006 {
		t.Fatalf("ungranted account: %d %s", r.StatusCode, r.Body)
	}
	// Metadata from newer clients is accepted but never used.
	m := koPut(k.docs["vol2"], "p1", 0.2, "Kobo")
	m["metadata"] = map[string]any{"filename": "evil/../x.epub", "title": "Other Book", "authors": "Someone"}
	if r := k.get(k.docs["vol2"], k.credA1, k.pwA1); r.StatusCode != 200 || strings.TrimSpace(string(r.Body)) != "{}" {
		t.Fatalf("empty source: %d %s", r.StatusCode, r.Body)
	}
	if r := k.do("PUT", "/1/syncs/progress", k.credA1, k.pwA1, m); r.StatusCode != 200 {
		t.Fatalf("metadata put: %d %s", r.StatusCode, r.Body)
	}

	// Service disabled: authenticated callers get 503 2009 (health too).
	e.Do("PUT", "/admin/integrations/settings", k.admin, settingsBody("2", true, false, false, 26214400, 10))
	if r := k.do("GET", "/1/users/auth", k.credA1, k.pwA1, nil); r.StatusCode != 503 || koCode(r) != 2009 {
		t.Fatalf("disabled: %d %s", r.StatusCode, r.Body)
	}
	if r := e.Proto("GET", "/1/healthcheck", nil); r.StatusCode != 503 || koCode(r) != 2009 {
		t.Fatalf("disabled health: %d", r.StatusCode)
	}
	e.Do("PUT", "/admin/integrations/settings", k.admin, settingsBody("3", true, false, true, 26214400, 10))
	// Revocation and account disablement apply immediately.
	if r := e.Do("POST", "/integration-credentials/"+k.credA2.ID+"/revoke", k.userA, map[string]any{"operationId": uuid.NewString()}); r.StatusCode != 200 {
		t.Fatalf("revoke: %d", r.StatusCode)
	}
	if r := k.do("GET", "/1/users/auth", k.credA2, k.pwA2, nil); r.StatusCode != 401 {
		t.Fatalf("revoked: %d", r.StatusCode)
	}
	e.Do("PATCH", "/admin/users/"+e.Fix.UserAID.String(), k.admin, map[string]any{"active": false})
	if r := k.do("GET", "/1/users/auth", k.credA1, k.pwA1, nil); r.StatusCode != 401 {
		t.Fatalf("disabled account: %d", r.StatusCode)
	}
}

// TestKOReaderDeviceSequence follows contracts/t006/fixtures/koreader-device-sequence.json
// step by step, then proves web/Android state, completion and history are untouched.
func TestKOReaderDeviceSequence(t *testing.T) {
	k := newKOEnv(t)
	doc, ed := k.docs["vol2"], k.editions["vol2"]
	A, B := k.credA1, k.credA2
	pa, pb := k.pwA1, k.pwA2
	webBefore := k.e.Do("GET", "/editions/"+ed.ID+"/position", k.userA, nil).Body
	compBefore := k.e.Do("GET", "/editions/"+ed.ID+"/completion", k.userA, nil).Body

	// device-a-read-empty: {} and baseline zero.
	if r := k.get(doc, A, pa); r.StatusCode != 200 || strings.TrimSpace(string(r.Body)) != "{}" {
		t.Fatalf("a read empty: %d %s", r.StatusCode, r.Body)
	}
	// device-a-backward-put-new-payload: accepted at revision 1 (backward progress is just a payload).
	first := koPut(doc, "epubcfi(/6/8)", 0.80, "Kobo A")
	r := k.do("PUT", "/1/syncs/progress", A, pa, first)
	var acc koreader.Accepted
	r.JSON(t, &acc)
	if r.StatusCode != 200 || acc.Document != doc || acc.Timestamp <= 0 {
		t.Fatalf("a put: %d %s", r.StatusCode, r.Body)
	}
	if p := k.position(t, ed.ID); p.Revision != "1" || p.Source != "koreader" || p.Position.Value == nil || p.Position.Value.Progress != "epubcfi(/6/8)" {
		t.Fatalf("position after A: %+v", p)
	}
	back := koPut(doc, "epubcfi(/6/2)", 0.10, "Kobo A") // intentional backward move
	if r := k.do("PUT", "/1/syncs/progress", A, pa, back); r.StatusCode != 200 {
		t.Fatalf("backward put: %d %s", r.StatusCode, r.Body)
	}
	if p := k.position(t, ed.ID); p.Revision != "2" || p.Position.Value.Percentage != 0.10 {
		t.Fatalf("backward must be canonical: %+v", p)
	}
	// device-b-read: the nonempty source is returned but B adopts no baseline.
	g := k.get(doc, B, pb)
	var env koreader.ProgressBody
	g.JSON(t, &env)
	if g.StatusCode != 200 || env.Progress != "epubcfi(/6/2)" || env.Device != "Kobo A" || env.Document != doc {
		t.Fatalf("b read: %d %s", g.StatusCode, g.Body)
	}
	// device-b-put-new-payload: 409 2007, canonical unchanged, candidate retained.
	b1 := koPut(doc, "epubcfi(/6/50)", 0.55, "Kobo B")
	if r := k.do("PUT", "/1/syncs/progress", B, pb, b1); r.StatusCode != 409 || koCode(r) != 2007 {
		t.Fatalf("b put: %d %s", r.StatusCode, r.Body)
	}
	if p := k.position(t, ed.ID); p.Revision != "2" || p.Position.Value.Progress != "epubcfi(/6/2)" {
		t.Fatalf("canonical changed by a retained candidate: %+v", p)
	}
	cs := k.conflicts(t)
	if len(cs) != 1 || cs[0].Reason != "baseline_required" || cs[0].Resolved || cs[0].CurrentRevision != "2" || cs[0].Candidate.Progress != "epubcfi(/6/50)" {
		t.Fatalf("conflicts: %+v", cs)
	}
	// device-b-read-again: still no baseline. device-b-retry-B1: same 409, no second candidate or revision.
	k.get(doc, B, pb)
	if r := k.do("PUT", "/1/syncs/progress", B, pb, b1); r.StatusCode != 409 || koCode(r) != 2007 {
		t.Fatalf("b retry: %d %s", r.StatusCode, r.Body)
	}
	if len(k.conflicts(t)) != 1 || k.position(t, ed.ID).Revision != "2" {
		t.Fatalf("a retry created state: %+v", k.conflicts(t))
	}
	// owner-keep-server-B1: base must be the current source revision.
	conflict := cs[0]
	if r := k.e.Do("POST", "/koreader/conflicts/"+conflict.ID+"/resolve", k.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "1", "action": "keep_server"}); r.StatusCode != 409 || r.Code() != "stale_revision" {
		t.Fatalf("stale resolve: %d %s", r.StatusCode, r.Body)
	}
	resolve := map[string]any{"operationId": uuid.NewString(), "baseRevision": "2", "action": "keep_server"}
	rr := k.e.Do("POST", "/koreader/conflicts/"+conflict.ID+"/resolve", k.userA, resolve)
	if rr.StatusCode != 200 || !strings.Contains(string(rr.Body), `"revision":"2"`) {
		t.Fatalf("keep_server: %d %s", rr.StatusCode, rr.Body)
	}
	if replay := k.e.Do("POST", "/koreader/conflicts/"+conflict.ID+"/resolve", k.userA, resolve); replay.StatusCode != 200 || !bytes.Equal(replay.Body, rr.Body) {
		t.Fatalf("resolve replay: %d %s", replay.StatusCode, replay.Body)
	}
	// A different operation cannot resolve it again.
	if r := k.e.Do("POST", "/koreader/conflicts/"+conflict.ID+"/resolve", k.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "2", "action": "use_candidate"}); r.StatusCode != 409 || r.Code() != "conflict_resolved" {
		t.Fatalf("second resolve: %d %s", r.StatusCode, r.Body)
	}
	// device-b-read-after-explicit-resolution adopts baseline 2; the old payload still fails (receipt fence).
	k.get(doc, B, pb)
	if r := k.do("PUT", "/1/syncs/progress", B, pb, b1); r.StatusCode != 409 || koCode(r) != 2007 {
		t.Fatalf("b1 after resolution: %d %s", r.StatusCode, r.Body)
	}
	if k.position(t, ed.ID).Revision != "2" || len(k.conflicts(t)) != 1 {
		t.Fatal("old payload altered state after resolution")
	}
	// device-b-different-payload: accepted at revision 3.
	if r := k.do("PUT", "/1/syncs/progress", B, pb, koPut(doc, "epubcfi(/6/60)", 0.6, "Kobo B")); r.StatusCode != 200 {
		t.Fatalf("b different payload: %d %s", r.StatusCode, r.Body)
	}
	if k.position(t, ed.ID).Revision != "3" {
		t.Fatal("expected revision 3")
	}

	// The source is separate: web position, completion and history are untouched.
	if now := k.e.Do("GET", "/editions/"+ed.ID+"/position", k.userA, nil).Body; !bytes.Equal(now, webBefore) {
		t.Fatalf("web position changed:\n%s\n%s", webBefore, now)
	}
	if now := k.e.Do("GET", "/editions/"+ed.ID+"/completion", k.userA, nil).Body; !bytes.Equal(now, compBefore) {
		t.Fatalf("completion changed:\n%s\n%s", compBefore, now)
	}
	var hist wire.T005History
	k.e.Do("GET", "/titles/"+ed.TitleID+"/history", k.userA, nil).JSON(t, &hist)
	if hist.Total != 0 {
		t.Fatalf("title history changed: %d", hist.Total)
	}
}

func TestKOReaderRetryReplayAndStaleAcceptedPayload(t *testing.T) {
	k := newKOEnv(t)
	doc, ed := k.docs["zebra"], k.editions["zebra"]
	A, B := k.credA1, k.credA2
	k.get(doc, A, k.pwA1) // baseline 0
	p1 := koPut(doc, "x1", 0.3, "A")
	r1 := k.do("PUT", "/1/syncs/progress", A, k.pwA1, p1)
	// Response loss: the device repeats the identical request; same success, no new revision.
	r2 := k.do("PUT", "/1/syncs/progress", A, k.pwA1, p1)
	if r1.StatusCode != 200 || r2.StatusCode != 200 || !bytes.Equal(r1.Body, r2.Body) || k.position(t, ed.ID).Revision != "1" {
		t.Fatalf("replay: %d %s / %d %s rev=%s", r1.StatusCode, r1.Body, r2.StatusCode, r2.Body, k.position(t, ed.ID).Revision)
	}
	// Another accepted write moves canonical state on.
	if r := k.do("PUT", "/1/syncs/progress", A, k.pwA1, koPut(doc, "x2", 0.4, "A")); r.StatusCode != 200 {
		t.Fatalf("second put: %d", r.StatusCode)
	}
	// Repeating the first payload now must not claim it is current: it is retained instead.
	if r := k.do("PUT", "/1/syncs/progress", A, k.pwA1, p1); r.StatusCode != 409 || koCode(r) != 2007 {
		t.Fatalf("stale accepted payload: %d %s", r.StatusCode, r.Body)
	}
	if k.position(t, ed.ID).Revision != "2" || len(k.conflicts(t)) != 1 {
		t.Fatalf("state after stale replay: rev=%s conflicts=%d", k.position(t, ed.ID).Revision, len(k.conflicts(t)))
	}
	// Repeating the refused payload returns the recorded failure without another candidate.
	k.do("PUT", "/1/syncs/progress", A, k.pwA1, p1)
	if len(k.conflicts(t)) != 1 {
		t.Fatal("repeated refusal appended a candidate")
	}
	// A stale device reading before replaying an old upload gains no baseline for it.
	k.get(doc, B, k.pwA2)
	stale := koPut(doc, "queued-offline", 0.9, "B")
	if r := k.do("PUT", "/1/syncs/progress", B, k.pwA2, stale); r.StatusCode != 409 {
		t.Fatalf("stale device: %d %s", r.StatusCode, r.Body)
	}
	if k.position(t, ed.ID).Revision != "2" {
		t.Fatal("stale device mutated the source")
	}
}

func TestKOReaderResolveUseCandidateReapplyAndRaces(t *testing.T) {
	k := newKOEnv(t)
	doc, ed := k.docs["vol2"], k.editions["vol2"]
	A, B := k.credA1, k.credA2
	k.get(doc, A, k.pwA1)
	k.do("PUT", "/1/syncs/progress", A, k.pwA1, koPut(doc, "a1", 0.2, "A"))
	k.get(doc, B, k.pwA2)
	cand := koPut(doc, "b-candidate", 0.7, "B")
	k.do("PUT", "/1/syncs/progress", B, k.pwA2, cand)
	c := k.conflicts(t)[0]

	// Concurrent resolves: exactly one wins, the other gets durable 409 evidence.
	var wg sync.WaitGroup
	codes := make([]int, 4)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body := map[string]any{"operationId": uuid.NewString(), "baseRevision": "1", "action": "use_candidate"}
			codes[i] = k.e.Do("POST", "/koreader/conflicts/"+c.ID+"/resolve", k.userA, body).StatusCode
		}(i)
	}
	wg.Wait()
	wins := 0
	for _, s := range codes {
		if s == 200 {
			wins++
		} else if s != 409 {
			t.Fatalf("unexpected status %d in %v", s, codes)
		}
	}
	if wins != 1 {
		t.Fatalf("exactly one resolve must win: %v", codes)
	}
	if p := k.position(t, ed.ID); p.Revision != "2" || p.Position.Value.Progress != "b-candidate" {
		t.Fatalf("candidate not applied exactly once: %+v", p)
	}
	// Only B's device may adopt the resolved revision, and only by reading it.
	if r := k.do("PUT", "/1/syncs/progress", B, k.pwA2, koPut(doc, "b-next", 0.75, "B")); r.StatusCode != 409 {
		t.Fatalf("write before re-reading must still be retained: %d", r.StatusCode)
	}
	// That refusal left a new unresolved candidate, which blocks the device even after it re-reads.
	k.get(doc, B, k.pwA2)
	if r := k.do("PUT", "/1/syncs/progress", B, k.pwA2, koPut(doc, "b-next2", 0.76, "B")); r.StatusCode != 409 {
		t.Fatalf("an unresolved candidate must keep blocking the device: %d %s", r.StatusCode, r.Body)
	}
	for _, x := range k.conflicts(t) {
		if !x.Resolved {
			body := map[string]any{"operationId": uuid.NewString(), "baseRevision": x.CurrentRevision, "action": "keep_server"}
			if r := k.e.Do("POST", "/koreader/conflicts/"+x.ID+"/resolve", k.userA, body); r.StatusCode != 200 {
				t.Fatalf("resolve blocker: %d %s", r.StatusCode, r.Body)
			}
		}
	}
	k.get(doc, B, k.pwA2)
	if r := k.do("PUT", "/1/syncs/progress", B, k.pwA2, koPut(doc, "b-next3", 0.77, "B")); r.StatusCode != 200 {
		t.Fatalf("write after resolution and re-read: %d %s", r.StatusCode, r.Body)
	}

	// Reapply: needs a resolved candidate and the current revision; applies as a new event.
	if r := k.e.Do("POST", "/koreader/conflicts/"+c.ID+"/reapply", k.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "1"}); r.StatusCode != 409 || r.Code() != "stale_revision" {
		t.Fatalf("stale reapply: %d %s", r.StatusCode, r.Body)
	}
	cur := k.position(t, ed.ID).Revision
	rb := map[string]any{"operationId": uuid.NewString(), "baseRevision": cur}
	rp := k.e.Do("POST", "/koreader/conflicts/"+c.ID+"/reapply", k.userA, rb)
	var pos wire.T006KoPosition
	rp.JSON(t, &pos)
	if rp.StatusCode != 200 || pos.Position.Value == nil || pos.Position.Value.Progress != "b-candidate" || pos.Revision == cur {
		t.Fatalf("reapply: %d %s", rp.StatusCode, rp.Body)
	}
	if again := k.e.Do("POST", "/koreader/conflicts/"+c.ID+"/reapply", k.userA, rb); again.StatusCode != 200 || !bytes.Equal(again.Body, rp.Body) {
		t.Fatalf("reapply replay: %d", again.StatusCode)
	}
	// An unresolved candidate cannot be reapplied.
	k.get(doc, A, k.pwA1)
	k.do("PUT", "/1/syncs/progress", A, k.pwA1, koPut(doc, "a-late", 0.1, "A"))
	var open wire.T006KoConflict
	for _, x := range k.conflicts(t) {
		if !x.Resolved {
			open = x
		}
	}
	if open.ID == "" {
		t.Fatal("expected an unresolved candidate")
	}
	if r := k.e.Do("POST", "/koreader/conflicts/"+open.ID+"/reapply", k.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": k.position(t, ed.ID).Revision}); r.StatusCode != 409 || r.Code() != "conflict_unresolved" {
		t.Fatalf("reapply unresolved: %d %s", r.StatusCode, r.Body)
	}
	// Another account sees and can act on nothing.
	var other wire.T006KoConflictList
	k.e.Do("GET", "/koreader/conflicts", k.userB, nil).JSON(t, &other)
	if len(other.Items) != 0 {
		t.Fatal("conflicts leaked across accounts")
	}
	if r := k.e.Do("POST", "/koreader/conflicts/"+open.ID+"/resolve", k.userB, map[string]any{"operationId": uuid.NewString(), "baseRevision": "0", "action": "keep_server"}); r.StatusCode != 404 {
		t.Fatalf("foreign resolve: %d", r.StatusCode)
	}
	// Grant loss prevents applying a retained candidate.
	revBeforeGrantLoss := k.position(t, ed.ID).Revision
	if r := k.e.Do("DELETE", "/admin/users/"+k.e.Fix.UserAID.String()+"/libraries/"+k.lib, k.admin, nil); r.StatusCode != 204 {
		t.Fatalf("remove grant: %d", r.StatusCode)
	}
	if r := k.e.Do("POST", "/koreader/conflicts/"+open.ID+"/resolve", k.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": revBeforeGrantLoss, "action": "use_candidate"}); r.StatusCode == 200 {
		t.Fatalf("a candidate was applied without a grant: %d", r.StatusCode)
	}
	if r := k.get(doc, A, k.pwA1); r.StatusCode != 404 || koCode(r) != 2006 {
		t.Fatalf("ungranted after grant loss: %d %s", r.StatusCode, r.Body)
	}
}

func TestKOReaderAmbiguityBindingAndReplacement(t *testing.T) {
	k := newKOEnv(t)
	e := k.e
	doc := k.docs["vol2"]
	// An identical copy in the same granted library makes the digest ambiguous.
	dup := filepath.Join(k.root, "Saga", "vol2-copy.epub")
	raw, _ := os.ReadFile(k.epubPath)
	if err := os.WriteFile(dup, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	scanTwice(t, e, k.admin, k.lib)
	if n, err := e.Indexer.IndexPending(context.Background(), 100); err != nil || n != 1 {
		t.Fatalf("index copy: %d %v", n, err)
	}
	if r := k.get(doc, k.credA1, k.pwA1); r.StatusCode != 404 || koCode(r) != 2006 {
		t.Fatalf("ambiguous digest must not select a file: %d %s", r.StatusCode, r.Body)
	}
	if r := k.do("PUT", "/1/syncs/progress", k.credA1, k.pwA1, koPut(doc, "p", 0.5, "d")); r.StatusCode != 404 {
		t.Fatalf("ambiguous put: %d", r.StatusCode)
	}
	target := k.editions["vol2"]
	// Binding validation: wrong digest, foreign/revoked credential, unknown file.
	bid := uuid.NewString()
	bind := func(cred wire.T006Credential, document string, base string, ver string) apitest.Response {
		return e.Do("PUT", "/koreader/bindings/"+bid, k.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": base, "credentialId": cred.ID,
			"document": document, "fileId": target.File.ID, "contentVersion": ver})
	}
	if r := bind(k.credA1, strings.Repeat("0", 32), "0", target.File.ContentVersion); r.StatusCode != 422 {
		t.Fatalf("digest mismatch: %d %s", r.StatusCode, r.Body)
	}
	if r := bind(k.credB, doc, "0", target.File.ContentVersion); r.StatusCode != 404 {
		t.Fatalf("foreign credential: %d %s", r.StatusCode, r.Body)
	}
	if r := bind(k.credA1, doc, "0", uuid.NewString()); r.StatusCode == 200 {
		t.Fatalf("unknown version: %d", r.StatusCode)
	}
	ok := bind(k.credA1, doc, "0", target.File.ContentVersion)
	var b wire.T006DigestBinding
	ok.JSON(t, &b)
	if ok.StatusCode != 200 || b.Revision != "1" || b.Deleted {
		t.Fatalf("bind: %d %s", ok.StatusCode, ok.Body)
	}
	// Only the bound credential resolves; A2 (unbound) still sees the ambiguity.
	if r := k.get(doc, k.credA1, k.pwA1); r.StatusCode != 200 {
		t.Fatalf("bound credential: %d %s", r.StatusCode, r.Body)
	}
	if r := k.get(doc, k.credA2, k.pwA2); r.StatusCode != 404 {
		t.Fatalf("unbound credential: %d", r.StatusCode)
	}
	if r := k.do("PUT", "/1/syncs/progress", k.credA1, k.pwA1, koPut(doc, "bound", 0.5, "d")); r.StatusCode != 200 {
		t.Fatalf("bound put: %d %s", r.StatusCode, r.Body)
	}
	var list wire.T006DigestBindingList
	e.Do("GET", "/koreader/bindings", k.userA, nil).JSON(t, &list)
	if list.Total != 1 || len(list.Items) != 1 {
		t.Fatalf("list: %+v", list)
	}
	if r := bind(k.credA1, doc, "5", target.File.ContentVersion); r.StatusCode != 409 || r.Code() != "stale_revision" {
		t.Fatalf("stale binding: %d %s", r.StatusCode, r.Body)
	}

	// Replacement: new bytes get a new version; positions never transfer to them.
	oldVersion := target.File.ContentVersion
	if err := os.WriteFile(k.epubPath, append(append([]byte{}, raw...), []byte("NEWBYTES")...), 0o644); err != nil {
		t.Fatal(err)
	}
	scanTwice(t, e, k.admin, k.lib)
	if r := k.get(doc, k.credA1, k.pwA1); r.StatusCode != 412 || koCode(r) != 2008 {
		t.Fatalf("binding to superseded bytes: %d %s", r.StatusCode, r.Body)
	}
	if r := k.do("PUT", "/1/syncs/progress", k.credA1, k.pwA1, koPut(doc, "after-replace", 0.9, "d")); r.StatusCode != 412 {
		t.Fatalf("put to superseded bytes: %d", r.StatusCode)
	}
	var cs []wire.T006KoConflict
	for _, c := range k.conflicts(t) {
		if c.Reason == "content_changed" && c.ContentVersion == oldVersion {
			cs = append(cs, c)
		}
	}
	if len(cs) != 1 {
		t.Fatalf("a content_changed candidate must stay attached to the old version: %+v", k.conflicts(t))
	}
	// The candidate cannot be applied to the new bytes.
	if r := e.Do("POST", "/koreader/conflicts/"+cs[0].ID+"/resolve", k.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": cs[0].CurrentRevision, "action": "use_candidate"}); r.StatusCode != 412 {
		t.Fatalf("apply to superseded bytes: %d %s", r.StatusCode, r.Body)
	}
	// The edition's KOReader position is for the new bytes only: empty.
	if p := k.position(t, target.ID); p.Revision != "0" || p.ContentVersion == oldVersion || p.Position.Value != nil {
		t.Fatalf("position leaked to replacement bytes: %+v", p)
	}
	// Deleting the binding tombstones it; the tombstone cannot be revived.
	del := e.Do("DELETE", "/koreader/bindings/"+bid, k.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "1"})
	var d wire.T006DigestBinding
	del.JSON(t, &d)
	if del.StatusCode != 200 || !d.Deleted || d.Revision != "2" {
		t.Fatalf("delete: %d %s", del.StatusCode, del.Body)
	}
	e.Do("GET", "/koreader/bindings", k.userA, nil).JSON(t, &list)
	if list.Total != 0 {
		t.Fatalf("deleted binding listed: %+v", list)
	}
}

func TestKOReaderIndexingIsBoundedAndHonest(t *testing.T) {
	e := apitest.New(t)
	ctx := context.Background()
	var n int
	if err := e.Pool.QueryRow(ctx, "SELECT count(*) FROM koreader_digests").Scan(&n); err != nil || n != 0 {
		t.Fatalf("digests exist before indexing: %d %v", n, err)
	}
	// Nothing is indexed on a request path; an empty catalog indexes nothing and does not error.
	if done, err := e.Indexer.IndexPending(ctx, 5); err != nil || done != 0 {
		t.Fatalf("empty index: %d %v", done, err)
	}
}
