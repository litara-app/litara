package httpapi_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/delivery"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/smtptest"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

const (
	fromAddr = "litara@example.invalid"
	toAddr   = "reader@example.invalid"
)

type delEnv struct {
	*opdsEnv
	rec        wire.T006Recipient
	serverRev  string
	ebook, cbz wire.T005Edition
}

func newDelEnv(t *testing.T, opts ...apitest.Options) *delEnv {
	t.Helper()
	o := newOPDSEnv(t, opts...)
	if r := o.e.Do("PUT", "/admin/integrations/settings", o.admin, settingsBody("1", true, true, false, 26214400, 10)); r.StatusCode != 200 {
		t.Fatalf("enable email: %d %s", r.StatusCode, r.Body)
	}
	d := &delEnv{opdsEnv: o, serverRev: "0"}
	var eds wire.T005Editions
	o.e.Do("GET", "/editions?libraryId="+o.lib+"&size=200", o.userA, nil).JSON(t, &eds)
	epubInfo, _ := os.Stat(o.epubPath)
	for _, ed := range eds.Items {
		switch {
		case ed.File.Format == "epub" && ed.File.SizeBytes != nil && *ed.File.SizeBytes == epubInfo.Size():
			d.ebook = ed
		case ed.File.Format == "cbz":
			d.cbz = ed
		}
	}
	if d.ebook.ID == "" || d.cbz.ID == "" {
		t.Fatalf("fixture editions missing: %+v", eds.Items)
	}
	d.rec = d.recipient(o.userA, "Test Reader", toAddr)
	return d
}

func smtpBody(base string, enabled bool, host string, port int, tlsMode, user, action string, pw *string) map[string]any {
	return map[string]any{"operationId": uuid.NewString(), "baseRevision": base, "enabled": enabled, "host": host, "port": port, "tlsMode": tlsMode,
		"username": user, "fromAddress": fromAddr, "secretAction": action, "password": pw}
}

func str(s string) *string { return &s }

func (d *delEnv) putServer(t *testing.T, s *smtptest.Server, mode string) wire.T006SmtpReport {
	t.Helper()
	var cur wire.T006SmtpReport
	d.e.Do("GET", "/admin/delivery/smtp", d.admin, nil).JSON(t, &cur)
	r := d.e.Do("PUT", "/admin/delivery/smtp", d.admin, smtpBody(cur.Revision, true, s.Host, s.Port, mode, "", "keep", nil))
	if r.StatusCode != 200 {
		t.Fatalf("put server smtp: %d %s", r.StatusCode, r.Body)
	}
	var out wire.T006SmtpReport
	r.JSON(t, &out)
	d.serverRev = out.Revision
	return out
}

func (d *delEnv) recipient(token, name, addr string) wire.T006Recipient {
	d.e.T.Helper()
	r := d.e.Do("PUT", "/delivery/recipients/"+uuid.NewString(), token, map[string]any{"operationId": uuid.NewString(), "baseRevision": "0",
		"data": map[string]any{"name": name, "address": addr}})
	if r.StatusCode != 200 {
		d.e.T.Fatalf("recipient: %d %s", r.StatusCode, r.Body)
	}
	var out wire.T006Recipient
	r.JSON(d.e.T, &out)
	return out
}

func (d *delEnv) sendBody(file, version string, rec wire.T006Recipient, transport, trRev string) map[string]any {
	return map[string]any{"operationId": uuid.NewString(), "fileId": file, "contentVersion": version, "recipientId": rec.ID,
		"recipientRevision": rec.Revision, "transport": transport, "transportRevision": trRev, "resendOf": nil, "acknowledgePossibleDuplicate": false}
}

func (d *delEnv) send(t *testing.T, ed wire.T005Edition) wire.T006Delivery {
	t.Helper()
	r := d.e.Do("POST", "/deliveries", d.userA, d.sendBody(ed.File.ID, ed.File.ContentVersion, d.rec, "server", d.serverRev))
	if r.StatusCode != 202 {
		t.Fatalf("send: %d %s", r.StatusCode, r.Body)
	}
	var out wire.T006Delivery
	r.JSON(t, &out)
	return out
}

func (d *delEnv) delivery(t *testing.T, id string) wire.T006Delivery {
	t.Helper()
	var out wire.T006Delivery
	r := d.e.Do("GET", "/deliveries/"+id, d.userA, nil)
	if r.StatusCode != 200 {
		t.Fatalf("get delivery: %d %s", r.StatusCode, r.Body)
	}
	r.JSON(t, &out)
	return out
}

type attachment struct {
	Name, Type string
	Data       []byte
}

// parseMail independently decodes what the sink received.
func parseMail(t *testing.T, raw []byte) (mail.Header, string, []attachment) {
	t.Helper()
	m, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("message: %v", err)
	}
	mt, params, err := mime.ParseMediaType(m.Header.Get("Content-Type"))
	if err != nil || mt != "multipart/mixed" {
		t.Fatalf("content type %q: %v", m.Header.Get("Content-Type"), err)
	}
	mr := multipart.NewReader(m.Body, params["boundary"])
	var text string
	var atts []attachment
	for {
		p, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(p)
		disp, dp, _ := mime.ParseMediaType(p.Header.Get("Content-Disposition"))
		if disp == "attachment" {
			dec, err := base64.StdEncoding.DecodeString(strings.NewReplacer("\r", "", "\n", "").Replace(string(body)))
			if err != nil {
				t.Fatalf("base64: %v", err)
			}
			ct, _, _ := mime.ParseMediaType(p.Header.Get("Content-Type"))
			atts = append(atts, attachment{Name: dp["filename"], Type: ct, Data: dec})
		} else {
			text += string(body)
		}
	}
	return m.Header, text, atts
}

// ---- configuration, ownership and secrets -----------------------------------

func TestSMTPConfigurationOwnershipAndSecrets(t *testing.T) {
	d := newDelEnv(t)
	e := d.e
	pw := "p4ss-w0rd-SECRET-tail-9876"
	// Ownership: only the administrator edits the server transport.
	if r := e.Do("PUT", "/admin/delivery/smtp", d.userA, smtpBody("0", true, "smtp.example.com", 587, "starttls", "", "keep", nil)); r.StatusCode != 403 {
		t.Fatalf("non-admin server write: %d", r.StatusCode)
	}
	if r := e.Do("GET", "/admin/delivery/smtp", d.userA, nil); r.StatusCode != 403 {
		t.Fatalf("non-admin server read: %d", r.StatusCode)
	}
	// Unconfigured transports report revision zero and harmless defaults, not 404.
	var rep wire.T006SmtpReport
	e.Do("GET", "/delivery/smtp", d.userA, nil).JSON(t, &rep)
	if rep.Revision != "0" || rep.Configured || rep.HasPassword || rep.Port != 587 || rep.TLSMode != "starttls" || !rep.KeyAvailable {
		t.Fatalf("defaults: %+v", rep)
	}
	// Validation: nothing is stored on a 422.
	bad := map[string]map[string]any{
		"replace needs password": smtpBody("0", true, "smtp.example.com", 587, "starttls", "u", "replace", nil),
		"keep with password":     smtpBody("0", true, "smtp.example.com", 587, "starttls", "", "keep", str("x")),
		"username w/o password":  smtpBody("0", true, "smtp.example.com", 587, "starttls", "someone", "keep", nil),
		"password w/o username":  smtpBody("0", true, "smtp.example.com", 587, "starttls", "", "replace", str("x")),
		"crlf host":              smtpBody("0", true, "smtp.example.com\r\nRCPT", 587, "starttls", "", "keep", nil),
		"crlf username":          smtpBody("0", true, "smtp.example.com", 587, "starttls", "u\r\nx", "replace", str("x")),
		"plaintext remote":       smtpBody("0", true, "smtp.example.com", 25, "local_test_plain", "", "keep", nil),
		"private literal":        smtpBody("0", true, "10.1.2.3", 587, "starttls", "", "keep", nil),
		"metadata address":       smtpBody("0", true, "169.254.169.254", 25, "starttls", "", "keep", nil),
		"bad tls mode":           smtpBody("0", true, "smtp.example.com", 587, "none", "", "keep", nil),
	}
	for name, b := range bad {
		if r := e.Do("PUT", "/delivery/smtp", d.userA, b); r.StatusCode != 422 {
			t.Fatalf("%s: %d %s", name, r.StatusCode, r.Body)
		}
	}
	// Personal configuration with a stored password.
	body := smtpBody("0", true, "smtp.example.com", 587, "starttls", "someone", "replace", &pw)
	r := e.Do("PUT", "/delivery/smtp", d.userA, body)
	var saved wire.T006SmtpReport
	r.JSON(t, &saved)
	if r.StatusCode != 200 || saved.Revision != "1" || !saved.Configured || !saved.HasPassword || strings.Contains(string(r.Body), "SECRET") || strings.Contains(string(r.Body), "9876") {
		t.Fatalf("personal put: %d %s", r.StatusCode, r.Body)
	}
	if rp := e.Do("PUT", "/delivery/smtp", d.userA, body); rp.StatusCode != 200 || !bytes.Equal(rp.Body, r.Body) {
		t.Fatalf("replay: %d", rp.StatusCode)
	}
	changed := map[string]any{}
	for k, v := range body {
		changed[k] = v
	}
	changed["password"] = str(pw + "x")
	if rp := e.Do("PUT", "/delivery/smtp", d.userA, changed); rp.StatusCode != 409 || rp.Code() != "operation_id_reused" {
		t.Fatalf("changed secret under same operation: %d %s", rp.StatusCode, rp.Body)
	}
	if rp := e.Do("PUT", "/delivery/smtp", d.userA, smtpBody("0", true, "smtp.example.com", 587, "starttls", "someone", "keep", nil)); rp.StatusCode != 409 || rp.Code() != "stale_revision" {
		t.Fatalf("stale: %d %s", rp.StatusCode, rp.Body)
	}
	// Persisted record: authenticated ciphertext with a nonce, never the plaintext or any fragment.
	var nonce, ct []byte
	var keyID string
	if err := e.Pool.QueryRow(t.Context(), "SELECT key_id, nonce, ciphertext FROM smtp_configs WHERE owner_kind = 'personal' AND user_id = $1", e.Fix.UserAID).Scan(&keyID, &nonce, &ct); err != nil {
		t.Fatal(err)
	}
	if keyID != "test-key" || len(nonce) != 12 || len(ct) <= len(pw) || bytes.Contains(ct, []byte(pw)) || bytes.Contains(ct, []byte("SECRET")) {
		t.Fatalf("stored secret: key=%s nonce=%d ct=%d", keyID, len(nonce), len(ct))
	}
	// Each account sees only its own transport; administrators gain nothing.
	e.Do("GET", "/delivery/smtp", d.userB, nil).JSON(t, &rep)
	if rep.Configured || rep.Host != "" {
		t.Fatalf("another account sees the transport: %+v", rep)
	}
	e.Do("GET", "/delivery/smtp", d.admin, nil).JSON(t, &rep)
	if rep.Configured || rep.Host != "" {
		t.Fatalf("administrator sees a personal transport: %+v", rep)
	}
	// keep preserves the secret; clear removes it (and the username must go with it).
	keep := e.Do("PUT", "/delivery/smtp", d.userA, smtpBody("1", true, "smtp.example.com", 2525, "starttls", "someone", "keep", nil))
	e.Do("GET", "/delivery/smtp", d.userA, nil).JSON(t, &rep)
	if keep.StatusCode != 200 || !rep.HasPassword || rep.Port != 2525 {
		t.Fatalf("keep: %d %+v", keep.StatusCode, rep)
	}
	if r := e.Do("PUT", "/delivery/smtp", d.userA, smtpBody("2", true, "smtp.example.com", 2525, "starttls", "someone", "clear", nil)); r.StatusCode != 422 {
		t.Fatalf("clear with a username: %d", r.StatusCode)
	}
	// Key removed: settings survive, are reported unavailable, and writes/sends fail closed.
	good := e.Delivery
	e.Delivery.SetKeys(&delivery.KeyRing{})
	e.Do("GET", "/delivery/smtp", d.userA, nil).JSON(t, &rep)
	if rep.KeyAvailable || !rep.HasPassword || rep.Host != "smtp.example.com" {
		t.Fatalf("with no key: %+v", rep)
	}
	if r := e.Do("PUT", "/delivery/smtp", d.userA, smtpBody("2", true, "smtp.example.com", 2525, "starttls", "someone", "replace", &pw)); r.StatusCode != 503 || r.Code() != "configuration_unavailable" {
		t.Fatalf("replace with no key: %d %s", r.StatusCode, r.Body)
	}
	var tr wire.T006TransportList
	e.Do("GET", "/delivery/transports", d.userA, nil).JSON(t, &tr)
	if tr.Personal.Available {
		t.Fatal("a transport whose secret cannot be opened must not be available")
	}
	_ = good
	raw := bytes.Repeat([]byte{7}, 32)
	wrong, _ := delivery.ParseKeyRing("test-key:"+base64.StdEncoding.EncodeToString(raw), "test-key")
	e.Delivery.SetKeys(wrong) // same ID, different bytes: authentication of the ciphertext fails
	var count int
	_ = e.Pool.QueryRow(t.Context(), "SELECT count(*) FROM smtp_configs WHERE ciphertext IS NOT NULL").Scan(&count)
	if count != 1 {
		t.Fatalf("stored configuration was altered: %d", count)
	}

	// Transports list: availability and revision only; the server's details never appear.
	srv := smtptest.Start(t, smtptest.StartTLS, e.CA, smtptest.Behavior{})
	d.putServer(t, srv, "starttls")
	body2 := e.Do("GET", "/delivery/transports", d.userB, nil)
	var tl wire.T006TransportList
	body2.JSON(t, &tl)
	if !tl.Server.Available || tl.Server.Revision != "1" || tl.Personal.Available || strings.Contains(string(body2.Body), "127.0.0.1") {
		t.Fatalf("transports: %s", body2.Body)
	}
	var settings wire.T006IntegrationSettings
	e.Do("GET", "/integrations/settings", d.userB, nil).JSON(t, &settings)
	if !settings.ServerSmtpAvailable {
		t.Fatalf("serverSmtpAvailable: %+v", settings)
	}
}

// ---- connection tests --------------------------------------------------------

func TestSMTPConnectionTestsSendNothingAndNeverDowngrade(t *testing.T) {
	d := newDelEnv(t)
	e := d.e
	test := func(srv *smtptest.Server, mode, user, action string, pw *string) wire.T006ConnectionTest {
		t.Helper()
		var cur wire.T006SmtpReport
		e.Do("GET", "/admin/delivery/smtp", d.admin, nil).JSON(t, &cur)
		if r := e.Do("PUT", "/admin/delivery/smtp", d.admin, smtpBody(cur.Revision, true, srv.Host, srv.Port, mode, user, action, pw)); r.StatusCode != 200 {
			t.Fatalf("configure: %d %s", r.StatusCode, r.Body)
		}
		e.Do("GET", "/admin/delivery/smtp", d.admin, nil).JSON(t, &cur)
		r := e.Do("POST", "/admin/delivery/smtp/test", d.admin, map[string]any{"operationId": uuid.NewString(), "baseRevision": cur.Revision})
		if r.StatusCode != 200 {
			t.Fatalf("test: %d %s", r.StatusCode, r.Body)
		}
		var out wire.T006ConnectionTest
		r.JSON(t, &out)
		return out
	}
	other := smtptest.NewCA(t)
	cases := []struct {
		name string
		srv  *smtptest.Server
		mode string
		user string
		pw   *string
		want string
	}{
		{"starttls ok", smtptest.Start(t, smtptest.StartTLS, e.CA, smtptest.Behavior{}), "starttls", "", nil, "ok"},
		{"implicit ok", smtptest.Start(t, smtptest.Implicit, e.CA, smtptest.Behavior{}), "implicit", "", nil, "ok"},
		{"untrusted starttls certificate", smtptest.Start(t, smtptest.StartTLS, other, smtptest.Behavior{}), "starttls", "", nil, "tls_verification_failed"},
		{"untrusted implicit certificate", smtptest.Start(t, smtptest.Implicit, other, smtptest.Behavior{}), "implicit", "", nil, "tls_verification_failed"},
		{"required STARTTLS absent (no plaintext fallback)", smtptest.Start(t, smtptest.Plain, nil, smtptest.Behavior{}), "starttls", "", nil, "starttls_unavailable"},
		{"explicit local plaintext", smtptest.Start(t, smtptest.Plain, nil, smtptest.Behavior{}), "local_test_plain", "", nil, "ok"},
		{"auth ok", smtptest.Start(t, smtptest.StartTLS, e.CA, smtptest.Behavior{AuthUser: "u", AuthPass: "pw-ok"}), "starttls", "u", str("pw-ok"), "ok"},
		{"auth refused", smtptest.Start(t, smtptest.StartTLS, e.CA, smtptest.Behavior{AuthUser: "u", AuthPass: "pw-ok"}), "starttls", "u", str("pw-bad"), "authentication_failed"},
	}
	for _, c := range cases {
		action := "keep"
		if c.pw != nil {
			action = "replace"
		}
		got := test(c.srv, c.mode, c.user, action, c.pw)
		if got.Code != c.want || got.Success != (c.want == "ok") || got.Detail == "" || strings.Contains(got.Detail, "pw-") {
			t.Fatalf("%s: %+v", c.name, got)
		}
		if msgs := c.srv.Received(); len(msgs) != 0 {
			t.Fatalf("%s: a connection test sent mail", c.name)
		}
		if _, data := c.srv.Counts(); data != 0 {
			t.Fatalf("%s: a connection test reached DATA", c.name)
		}
	}
	// Stale revision and replay.
	var cur wire.T006SmtpReport
	e.Do("GET", "/admin/delivery/smtp", d.admin, nil).JSON(t, &cur)
	if r := e.Do("POST", "/admin/delivery/smtp/test", d.admin, map[string]any{"operationId": uuid.NewString(), "baseRevision": "0"}); r.StatusCode != 409 || r.Code() != "stale_revision" {
		t.Fatalf("stale test: %d %s", r.StatusCode, r.Body)
	}
	op := map[string]any{"operationId": uuid.NewString(), "baseRevision": cur.Revision}
	a, b := e.Do("POST", "/admin/delivery/smtp/test", d.admin, op), e.Do("POST", "/admin/delivery/smtp/test", d.admin, op)
	if a.StatusCode != 200 || !bytes.Equal(a.Body, b.Body) {
		t.Fatalf("test replay: %d %d", a.StatusCode, b.StatusCode)
	}
	// Personal tests are permitted only against permitted targets and never expose another transport.
	if r := e.Do("POST", "/delivery/smtp/test", d.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": "0"}); r.StatusCode != 409 {
		t.Fatalf("unconfigured personal test: %d %s", r.StatusCode, r.Body)
	}
}

// ---- recipients --------------------------------------------------------------

func TestRecipientLifecycleIsPrivateAndInjectionSafe(t *testing.T) {
	d := newDelEnv(t)
	e := d.e
	id := uuid.NewString()
	put := func(token, rid, base, name, addr string) apitest.Response {
		return e.Do("PUT", "/delivery/recipients/"+rid, token, map[string]any{"operationId": uuid.NewString(), "baseRevision": base,
			"data": map[string]any{"name": name, "address": addr}})
	}
	// Concurrent creates with the same client UUID: one wins, one is stale.
	var wg sync.WaitGroup
	codes := make([]int, 2)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes[i] = put(d.userA, id, "0", "Reader "+strconv.Itoa(i), "r"+strconv.Itoa(i)+"@example.invalid").StatusCode
		}(i)
	}
	wg.Wait()
	if !((codes[0] == 200 && codes[1] == 409) || (codes[0] == 409 && codes[1] == 200)) {
		t.Fatalf("concurrent create: %v", codes)
	}
	var cur wire.T006Recipient
	for _, x := range func() []wire.T006Recipient {
		var l wire.T006RecipientList
		e.Do("GET", "/delivery/recipients", d.userA, nil).JSON(t, &l)
		return l.Items
	}() {
		if x.ID == id {
			cur = x
		}
	}
	if cur.Revision != "1" || cur.Data.Value == nil {
		t.Fatalf("recipient: %+v", cur)
	}
	// Update at the right revision, stale update, and a foreign UUID.
	if r := put(d.userA, id, "1", "Renamed", "renamed@example.invalid"); r.StatusCode != 200 {
		t.Fatalf("update: %d %s", r.StatusCode, r.Body)
	}
	if r := put(d.userA, id, "1", "Again", "again@example.invalid"); r.StatusCode != 409 || r.Code() != "stale_revision" {
		t.Fatalf("stale update: %d %s", r.StatusCode, r.Body)
	}
	if r := put(d.userB, id, "2", "Hijack", "x@example.invalid"); r.StatusCode != 404 {
		t.Fatalf("foreign update: %d %s", r.StatusCode, r.Body)
	}
	if r := e.Do("DELETE", "/delivery/recipients/"+id, d.userB, map[string]any{"operationId": uuid.NewString(), "baseRevision": "2"}); r.StatusCode != 404 {
		t.Fatalf("foreign delete: %d", r.StatusCode)
	}
	var lb wire.T006RecipientList
	e.Do("GET", "/delivery/recipients", d.userB, nil).JSON(t, &lb)
	if len(lb.Items) != 0 {
		t.Fatalf("recipients leaked: %+v", lb.Items)
	}
	// Header and address injection never reach storage (422).
	for name, p := range map[string][2]string{"crlf name": {"Bob\r\nBcc: evil@example.invalid", "bob@example.invalid"}, "crlf address": {"Bob", "bob@example.invalid\r\nBcc: e@e.invalid"},
		"display form": {"Bob", "Bob <bob@example.invalid>"}, "two addresses": {"Bob", "a@example.invalid, b@example.invalid"}, "empty": {"", "bob@example.invalid"}, "not mail": {"Bob", "nope"}} {
		if r := put(d.userA, uuid.NewString(), "0", p[0], p[1]); r.StatusCode != 422 {
			t.Fatalf("%s: %d %s", name, r.StatusCode, r.Body)
		}
	}
	// Delete: tombstone, stable replay, retained but unlisted, cannot be revived.
	del := map[string]any{"operationId": uuid.NewString(), "baseRevision": "2"}
	r1 := e.Do("DELETE", "/delivery/recipients/"+id, d.userA, del)
	var tomb wire.T006Recipient
	r1.JSON(t, &tomb)
	if r1.StatusCode != 200 || !tomb.Deleted || tomb.Revision != "3" || tomb.Data.Value != nil {
		t.Fatalf("delete: %d %s", r1.StatusCode, r1.Body)
	}
	if r2 := e.Do("DELETE", "/delivery/recipients/"+id, d.userA, del); r2.StatusCode != 200 || !bytes.Equal(r1.Body, r2.Body) {
		t.Fatalf("delete replay: %d", r2.StatusCode)
	}
	if r := put(d.userA, id, "3", "Back", "back@example.invalid"); r.StatusCode != 409 {
		t.Fatalf("revive: %d %s", r.StatusCode, r.Body)
	}
	var la wire.T006RecipientList
	e.Do("GET", "/delivery/recipients", d.userA, nil).JSON(t, &la)
	for _, x := range la.Items {
		if x.ID == id {
			t.Fatal("a deleted recipient is listed")
		}
	}
	var n int
	_ = e.Pool.QueryRow(t.Context(), "SELECT count(*) FROM delivery_recipients WHERE id = $1 AND deleted", id).Scan(&n)
	if n != 1 {
		t.Fatal("tombstone not retained")
	}
}

// ---- sending -----------------------------------------------------------------

func TestDeliverySendsOriginalsByExactBytes(t *testing.T) {
	d := newDelEnv(t)
	e := d.e
	sink := smtptest.Start(t, smtptest.StartTLS, e.CA, smtptest.Behavior{})
	d.putServer(t, sink, "starttls")
	audio := e.Fix.Files["r1-f1"]
	audioPath := audio.Path
	targets := []struct {
		name, file, version, path string
		mime                      string
	}{
		{"ebook", d.ebook.File.ID, d.ebook.File.ContentVersion, "", "application/epub+zip"},
		{"comic", d.cbz.File.ID, d.cbz.File.ContentVersion, d.cbzPath, "application/vnd.comicbook+zip"},
		{"audio", audio.ID.String(), audio.Version.String(), audioPath, "audio/mpeg"},
	}
	sent := map[string]wire.T006Delivery{}
	for _, tg := range targets {
		r := e.Do("POST", "/deliveries", d.userA, d.sendBody(tg.file, tg.version, d.rec, "server", d.serverRev))
		var dv wire.T006Delivery
		r.JSON(t, &dv)
		if r.StatusCode != 202 || dv.State != "queued" || dv.Attempts != 0 || dv.RecipientAddress != toAddr || dv.Transport != "server" || dv.ResendOf != nil {
			t.Fatalf("%s create: %d %s", tg.name, r.StatusCode, r.Body)
		}
		sent[tg.name] = dv
	}
	if n := e.RunDeliveries(); n != 3 {
		t.Fatalf("ran %d jobs", n)
	}
	msgs := sink.Received()
	if len(msgs) != 3 {
		t.Fatalf("sink received %d messages", len(msgs))
	}
	want := map[string][]byte{}
	want[filepath.Base(d.epubPath)], _ = os.ReadFile(d.epubPath)
	want[filepath.Base(d.cbzPath)], _ = os.ReadFile(d.cbzPath)
	want[filepath.Base(audioPath)], _ = os.ReadFile(audioPath)
	types := map[string]bool{}
	for _, m := range msgs {
		hdr, text, atts := parseMail(t, m.Raw)
		if len(atts) != 1 || m.From != fromAddr || len(m.To) != 1 || m.To[0] != toAddr {
			t.Fatalf("envelope/attachments: %+v from=%s to=%v", atts, m.From, m.To)
		}
		a := atts[0]
		if exp, ok := want[a.Name]; !ok || sha256.Sum256(exp) != sha256.Sum256(a.Data) {
			t.Fatalf("attachment %s (%s) differs from the original bytes", a.Name, a.Type)
		}
		types[a.Type] = true
		if strings.ContainsAny(a.Name, "/\\\r\n") || a.Name == "" || !strings.Contains(text, "No conversion") {
			t.Fatalf("name %q text %q", a.Name, text)
		}
		if got := hdr.Get("To"); !strings.Contains(got, toAddr) || hdr.Get("Bcc") != "" || hdr.Get("Cc") != "" || hdr.Get("MIME-Version") != "1.0" {
			t.Fatalf("headers: to=%q bcc=%q", got, hdr.Get("Bcc"))
		}
	}
	if len(types) != 3 {
		t.Fatalf("expected an ebook, a comic and an audio file, got %v", types)
	}
	for name, dv := range sent {
		got := d.delivery(t, dv.ID)
		if got.State != "accepted" || got.Attempts != 1 || got.Code == nil || *got.Code != "smtp_accepted" {
			t.Fatalf("%s state: %+v", name, got)
		}
	}
	// History is the owner's alone.
	var lst wire.T006DeliveryList
	e.Do("GET", "/deliveries", d.userA, nil).JSON(t, &lst)
	if lst.Total != 3 || len(lst.Items) != 3 {
		t.Fatalf("list: %+v", lst)
	}
	e.Do("GET", "/deliveries", d.userB, nil).JSON(t, &lst)
	if lst.Total != 0 {
		t.Fatal("another account sees deliveries")
	}
	if r := e.Do("GET", "/deliveries/"+sent["ebook"].ID, d.userB, nil); r.StatusCode != 404 {
		t.Fatalf("foreign get: %d", r.StatusCode)
	}
	// A processed delivery is never sent again by a redelivered job.
	_ = e.Delivery.Process(t.Context(), uuid.MustParse(sent["ebook"].ID))
	if len(sink.Received()) != 3 {
		t.Fatal("an accepted delivery was submitted again")
	}
	// The original bytes in the catalog are untouched.
	after, _ := os.ReadFile(d.epubPath)
	if !bytes.Equal(after, want[filepath.Base(d.epubPath)]) {
		t.Fatal("original changed")
	}
}

func TestDeliveryCreateIsAtomicAndIdempotent(t *testing.T) {
	d := newDelEnv(t)
	e := d.e
	sink := smtptest.Start(t, smtptest.StartTLS, e.CA, smtptest.Behavior{})
	d.putServer(t, sink, "starttls")
	body := d.sendBody(d.ebook.File.ID, d.ebook.File.ContentVersion, d.rec, "server", d.serverRev)
	first := e.Do("POST", "/deliveries", d.userA, body)
	if first.StatusCode != 202 {
		t.Fatalf("create: %d %s", first.StatusCode, first.Body)
	}
	var dv wire.T006Delivery
	first.JSON(t, &dv)
	// Concurrent and later identical requests return the original response.
	var wg sync.WaitGroup
	bodies := make([][]byte, 6)
	for i := range bodies {
		wg.Add(1)
		go func(i int) { defer wg.Done(); r := e.Do("POST", "/deliveries", d.userA, body); bodies[i] = r.Body }(i)
	}
	wg.Wait()
	for _, b := range bodies {
		if !bytes.Equal(b, first.Body) {
			t.Fatalf("replay differs:\n%s\n%s", first.Body, b)
		}
	}
	if n := e.DQ.Count(uuid.MustParse(dv.ID)); n != 1 {
		t.Fatalf("%d jobs for one delivery", n)
	}
	e.RunDeliveries()
	// The replay body is the original 202 even after the state advanced; GET is current.
	if again := e.Do("POST", "/deliveries", d.userA, body); again.StatusCode != 202 || !bytes.Equal(again.Body, first.Body) {
		t.Fatalf("replay after progress: %d %s", again.StatusCode, again.Body)
	}
	if d.delivery(t, dv.ID).State != "accepted" {
		t.Fatal("GET must show the current state")
	}
	// A changed request under the same operation is refused.
	body["transportRevision"] = "9"
	if r := e.Do("POST", "/deliveries", d.userA, body); r.StatusCode != 409 || r.Code() != "operation_id_reused" {
		t.Fatalf("changed payload: %d %s", r.StatusCode, r.Body)
	}
	if len(sink.Received()) != 1 {
		t.Fatalf("%d messages", len(sink.Received()))
	}
	var rows int
	_ = e.Pool.QueryRow(t.Context(), "SELECT count(*) FROM deliveries").Scan(&rows)
	if rows != 1 {
		t.Fatalf("%d delivery rows", rows)
	}
}

func TestDeliveryRechecksAuthorityAndInputsBeforeSubmission(t *testing.T) {
	type tc struct {
		name, want string
		prepare    func(t *testing.T, d *delEnv, sink *smtptest.Server)
		mutate     func(t *testing.T, d *delEnv)
	}
	cases := []tc{
		{"grant revoked", "access_revoked", nil, func(t *testing.T, d *delEnv) {
			if r := d.e.Do("DELETE", "/admin/users/"+d.e.Fix.UserAID.String()+"/libraries/"+d.lib, d.admin, nil); r.StatusCode != 204 {
				t.Fatalf("revoke: %d", r.StatusCode)
			}
		}},
		{"account disabled", "account_disabled", nil, func(t *testing.T, d *delEnv) {
			if r := d.e.Do("PATCH", "/admin/users/"+d.e.Fix.UserAID.String(), d.admin, map[string]any{"active": false}); r.StatusCode != 200 {
				t.Fatalf("disable: %d", r.StatusCode)
			}
		}},
		{"file replaced", "content_changed", nil, func(t *testing.T, d *delEnv) {
			raw, _ := os.ReadFile(d.epubPath)
			_ = os.WriteFile(d.epubPath, append(raw, []byte("CHANGED")...), 0o644)
			scanTwice(t, d.e, d.admin, d.lib)
		}},
		{"recipient edited", "recipient_changed", nil, func(t *testing.T, d *delEnv) {
			if r := d.e.Do("PUT", "/delivery/recipients/"+d.rec.ID, d.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": d.rec.Revision,
				"data": map[string]any{"name": "Other", "address": "other@example.invalid"}}); r.StatusCode != 200 {
				t.Fatalf("edit: %d", r.StatusCode)
			}
		}},
		{"recipient deleted", "recipient_changed", nil, func(t *testing.T, d *delEnv) {
			if r := d.e.Do("DELETE", "/delivery/recipients/"+d.rec.ID, d.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": d.rec.Revision}); r.StatusCode != 200 {
				t.Fatalf("delete: %d", r.StatusCode)
			}
		}},
		{"transport reconfigured", "transport_changed", nil, func(t *testing.T, d *delEnv) {
			if r := d.e.Do("PUT", "/admin/delivery/smtp", d.admin, smtpBody(d.serverRev, true, "127.0.0.1", 1, "starttls", "", "keep", nil)); r.StatusCode != 200 {
				t.Fatalf("reconfigure: %d %s", r.StatusCode, r.Body)
			}
		}},
		{"transport disabled", "transport_changed", nil, func(t *testing.T, d *delEnv) {
			if r := d.e.Do("PUT", "/admin/delivery/smtp", d.admin, smtpBody(d.serverRev, false, "127.0.0.1", 1, "starttls", "", "keep", nil)); r.StatusCode != 200 {
				t.Fatalf("disable transport: %d", r.StatusCode)
			}
		}},
		{"email integration disabled", "integration_disabled", nil, func(t *testing.T, d *delEnv) {
			if r := d.e.Do("PUT", "/admin/integrations/settings", d.admin, settingsBody("2", true, false, false, 26214400, 10)); r.StatusCode != 200 {
				t.Fatalf("disable email: %d %s", r.StatusCode, r.Body)
			}
		}},
		{"attachment limit lowered", "attachment_too_large", nil, func(t *testing.T, d *delEnv) {
			if r := d.e.Do("PUT", "/admin/integrations/settings", d.admin, settingsBody("2", true, true, false, 10, 10)); r.StatusCode != 200 {
				t.Fatalf("limit: %d %s", r.StatusCode, r.Body)
			}
		}},
		{"encryption key unavailable", "configuration_unavailable", func(t *testing.T, d *delEnv, sink *smtptest.Server) {
			// The transport authenticates with a stored secret that is sealed under the current key.
			var cur wire.T006SmtpReport
			d.e.Do("GET", "/admin/delivery/smtp", d.admin, nil).JSON(t, &cur)
			r := d.e.Do("PUT", "/admin/delivery/smtp", d.admin, smtpBody(cur.Revision, true, sink.Host, sink.Port, "starttls", "u", "replace", str("pw")))
			if r.StatusCode != 200 {
				t.Fatalf("secret: %d %s", r.StatusCode, r.Body)
			}
			var out wire.T006SmtpReport
			r.JSON(t, &out)
			d.serverRev = out.Revision
		}, func(t *testing.T, d *delEnv) {
			d.e.Delivery.SetKeys(&delivery.KeyRing{}) // the key disappears while the request is queued
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := newDelEnv(t)
			sink := smtptest.Start(t, smtptest.StartTLS, d.e.CA, smtptest.Behavior{})
			d.putServer(t, sink, "starttls")
			if c.prepare != nil {
				c.prepare(t, d, sink)
			}
			dv := d.send(t, d.ebook)
			c.mutate(t, d)
			d.e.RunDeliveries()
			got := d.e.Pool
			var state, code string
			if err := got.QueryRow(t.Context(), "SELECT state, coalesce(code, '') FROM deliveries WHERE id = $1", dv.ID).Scan(&state, &code); err != nil {
				t.Fatal(err)
			}
			if state != "failed" || code != c.want {
				t.Fatalf("state=%s code=%s want failed/%s", state, code, c.want)
			}
			if conns, _ := sink.Counts(); conns != 0 || len(sink.Received()) != 0 {
				t.Fatalf("a stale request reached an SMTP server (%d connections)", conns)
			}
			if d.e.RunDeliveries() != 0 {
				t.Fatal("a failed delivery was scheduled again")
			}
		})
	}
}

func TestDeliveryRetriesFailuresUnknownOutcomeAndExplicitResend(t *testing.T) {
	t.Run("transient failures retry on the contract schedule then succeed", func(t *testing.T) {
		d := newDelEnv(t)
		var rejects atomic.Int32
		sink := smtptest.Start(t, smtptest.StartTLS, d.e.CA, smtptest.Behavior{RejectRcpt: func(string) (int, string) {
			if rejects.Add(1) <= 2 {
				return 451, "try later"
			}
			return 0, ""
		}})
		d.putServer(t, sink, "starttls")
		dv := d.send(t, d.ebook)
		d.e.RunDeliveries()
		got := d.delivery(t, dv.ID)
		if got.State != "retry_wait" || got.Attempts != 1 || got.Code == nil || *got.Code != "smtp_temporary_451" {
			t.Fatalf("after attempt 1: %+v", got)
		}
		d.e.Clock.Advance(4 * time.Second)
		if d.e.RunDeliveries() != 0 {
			t.Fatal("retried before the 5 s delay")
		}
		d.e.Clock.Advance(1 * time.Second)
		d.e.RunDeliveries()
		got = d.delivery(t, dv.ID)
		if got.State != "retry_wait" || got.Attempts != 2 {
			t.Fatalf("after attempt 2: %+v", got)
		}
		d.e.Clock.Advance(29 * time.Second)
		if d.e.RunDeliveries() != 0 {
			t.Fatal("retried before the 30 s delay")
		}
		d.e.Clock.Advance(1 * time.Second)
		d.e.RunDeliveries()
		got = d.delivery(t, dv.ID)
		if got.State != "accepted" || got.Attempts != 3 || len(sink.Received()) != 1 {
			t.Fatalf("after attempt 3: %+v messages=%d", got, len(sink.Received()))
		}
	})
	t.Run("retries are bounded", func(t *testing.T) {
		d := newDelEnv(t)
		sink := smtptest.Start(t, smtptest.StartTLS, d.e.CA, smtptest.Behavior{RejectRcpt: func(string) (int, string) { return 450, "busy" }})
		d.putServer(t, sink, "starttls")
		dv := d.send(t, d.ebook)
		for i := 0; i < 6; i++ {
			d.e.Clock.Advance(time.Minute)
			d.e.RunDeliveries()
		}
		got := d.delivery(t, dv.ID)
		if got.State != "failed" || got.Attempts != 3 || got.Code == nil || !strings.HasPrefix(*got.Code, "retries_exhausted") || len(sink.Received()) != 0 {
			t.Fatalf("exhausted: %+v", got)
		}
		if _, data := sink.Counts(); data != 0 {
			t.Fatal("DATA reached despite recipient refusals")
		}
	})
	t.Run("a permanent refusal fails once with a sanitized code", func(t *testing.T) {
		d := newDelEnv(t)
		sink := smtptest.Start(t, smtptest.StartTLS, d.e.CA, smtptest.Behavior{RejectRcpt: func(a string) (int, string) { return 550, "no such user " + a }})
		d.putServer(t, sink, "starttls")
		dv := d.send(t, d.ebook)
		d.e.RunDeliveries()
		d.e.Clock.Advance(2 * time.Minute)
		if d.e.RunDeliveries() != 0 {
			t.Fatal("a permanent failure was retried")
		}
		got := d.delivery(t, dv.ID)
		raw := d.e.Do("GET", "/deliveries/"+dv.ID, d.userA, nil).Body
		if got.State != "failed" || got.Code == nil || *got.Code != "smtp_rejected_550" || got.Attempts != 1 || strings.Contains(string(raw), "no such user") {
			t.Fatalf("permanent: %+v %s", got, raw)
		}
	})
	t.Run("a lost acknowledgement is outcome_unknown, never resent, and resend is explicit", func(t *testing.T) {
		d := newDelEnv(t)
		drop := smtptest.Start(t, smtptest.StartTLS, d.e.CA, smtptest.Behavior{DropAfterData: true})
		d.putServer(t, drop, "starttls")
		dv := d.send(t, d.ebook)
		d.e.RunDeliveries()
		got := d.delivery(t, dv.ID)
		if got.State != "outcome_unknown" || got.Attempts != 1 || len(drop.Received()) != 1 {
			t.Fatalf("unknown: %+v messages=%d", got, len(drop.Received()))
		}
		for i := 0; i < 5; i++ {
			d.e.Clock.Advance(2 * time.Minute)
			d.e.RunDeliveries()
			_ = d.e.Delivery.Process(t.Context(), uuid.MustParse(dv.ID)) // even a redelivered job
		}
		if len(drop.Received()) != 1 {
			t.Fatalf("an uncertain delivery was submitted again: %d", len(drop.Received()))
		}
		// Explicit resend needs the acknowledgement; the old result stays unchanged.
		good := smtptest.Start(t, smtptest.StartTLS, d.e.CA, smtptest.Behavior{})
		d.putServer(t, good, "starttls")
		body := d.sendBody(d.ebook.File.ID, d.ebook.File.ContentVersion, d.rec, "server", d.serverRev)
		body["resendOf"] = dv.ID
		if r := d.e.Do("POST", "/deliveries", d.userA, body); r.StatusCode != 422 || r.Code() != "duplicate_acknowledgement_required" {
			t.Fatalf("resend without acknowledgement: %d %s", r.StatusCode, r.Body)
		}
		body["acknowledgePossibleDuplicate"] = true
		body["operationId"] = uuid.NewString()
		r := d.e.Do("POST", "/deliveries", d.userA, body)
		var re wire.T006Delivery
		r.JSON(t, &re)
		if r.StatusCode != 202 || re.ResendOf == nil || *re.ResendOf != dv.ID || re.ID == dv.ID {
			t.Fatalf("resend: %d %s", r.StatusCode, r.Body)
		}
		d.e.RunDeliveries()
		if d.delivery(t, re.ID).State != "accepted" || len(good.Received()) != 1 {
			t.Fatalf("resend result: %+v", d.delivery(t, re.ID))
		}
		old := d.delivery(t, dv.ID)
		if old.State != "outcome_unknown" || old.Attempts != 1 {
			t.Fatalf("the original result was changed: %+v", old)
		}
		// A resend of someone else's delivery is a 404.
		body["operationId"] = uuid.NewString()
		if r := d.e.Do("POST", "/deliveries", d.userB, body); r.StatusCode == 202 {
			t.Fatalf("foreign resend: %d", r.StatusCode)
		}
	})
}

func TestDeliveryCrashAtSubmissionBoundaryRecoversAsUnknown(t *testing.T) {
	var crash atomic.Bool
	crash.Store(true)
	d := newDelEnv(t, apitest.Options{DeliveryHooks: delivery.SendHooks{AfterBoundary: func() error {
		if crash.Load() {
			return errors.New("simulated crash")
		}
		return nil
	}}})
	sink := smtptest.Start(t, smtptest.StartTLS, d.e.CA, smtptest.Behavior{})
	d.putServer(t, sink, "starttls")
	dv := d.send(t, d.ebook)
	d.e.RunDeliveries()
	// The attempt was claimed and the boundary persisted, but no outcome was recorded.
	var state string
	var open bool
	_ = d.e.Pool.QueryRow(t.Context(), "SELECT state, attempt_open FROM deliveries WHERE id = $1", dv.ID).Scan(&state, &open)
	if state != "sending" || !open {
		t.Fatalf("crash state: %s open=%v", state, open)
	}
	crash.Store(false)
	// A redelivered job while the lease is live must neither submit nor declare an outcome.
	_ = d.e.Delivery.Process(t.Context(), uuid.MustParse(dv.ID))
	if got := d.delivery(t, dv.ID); got.State != "sending" || len(sink.Received()) != 0 {
		t.Fatalf("a live lease was disturbed: %+v", got)
	}
	// Once the lease has expired the crashed attempt is recovered as outcome_unknown, still without a resend.
	d.e.Clock.Advance(2 * time.Minute)
	d.e.RunDeliveries()
	got := d.delivery(t, dv.ID)
	if got.State != "outcome_unknown" || got.Code == nil || *got.Code != "attempt_interrupted" || len(sink.Received()) != 0 {
		t.Fatalf("recovery: %+v messages=%d", got, len(sink.Received()))
	}
	for i := 0; i < 3; i++ {
		d.e.Clock.Advance(2 * time.Minute)
		d.e.RunDeliveries()
	}
	if len(sink.Received()) != 0 {
		t.Fatal("recovery submitted a message")
	}
}

func TestDeliveryCancelAndClaimRace(t *testing.T) {
	d := newDelEnv(t)
	e := d.e
	e.Do("PUT", "/admin/integrations/settings", d.admin, settingsBody("2", true, true, false, 26214400, 100))
	sink := smtptest.Start(t, smtptest.StartTLS, e.CA, smtptest.Behavior{})
	d.putServer(t, sink, "starttls")
	dv := d.send(t, d.ebook)
	cancel := func(id, base string) apitest.Response {
		return e.Do("POST", "/deliveries/"+id+"/cancel", d.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": base})
	}
	if r := cancel(dv.ID, "7"); r.StatusCode != 409 || r.Code() != "stale_revision" {
		t.Fatalf("stale cancel: %d %s", r.StatusCode, r.Body)
	}
	if r := e.Do("POST", "/deliveries/"+dv.ID+"/cancel", d.userB, map[string]any{"operationId": uuid.NewString(), "baseRevision": "0"}); r.StatusCode != 404 {
		t.Fatalf("foreign cancel: %d", r.StatusCode)
	}
	op := map[string]any{"operationId": uuid.NewString(), "baseRevision": dv.Revision}
	r := e.Do("POST", "/deliveries/"+dv.ID+"/cancel", d.userA, op)
	var c wire.T006Delivery
	r.JSON(t, &c)
	if r.StatusCode != 200 || c.State != "cancelled" {
		t.Fatalf("cancel: %d %s", r.StatusCode, r.Body)
	}
	if rp := e.Do("POST", "/deliveries/"+dv.ID+"/cancel", d.userA, op); rp.StatusCode != 200 || !bytes.Equal(rp.Body, r.Body) {
		t.Fatalf("cancel replay: %d", rp.StatusCode)
	}
	e.RunDeliveries()
	if conns, _ := sink.Counts(); conns != 0 {
		t.Fatal("a cancelled request was submitted")
	}
	// A request that already finished cannot be cancelled as if recalled.
	done := d.send(t, d.ebook)
	e.RunDeliveries()
	if r := cancel(done.ID, "0"); r.StatusCode != 409 || r.Code() != "delivery_not_cancellable" {
		t.Fatalf("cancel accepted: %d %s", r.StatusCode, r.Body)
	}
	// Cancellation and the worker's claim race on one row lock: exactly one wins, never both.
	for i := 0; i < 8; i++ {
		dv := d.send(t, d.ebook)
		before := len(sink.Received())
		var wg sync.WaitGroup
		var cancelStatus int
		wg.Add(2)
		go func() { defer wg.Done(); cancelStatus = cancel(dv.ID, dv.Revision).StatusCode }()
		go func() { defer wg.Done(); _ = e.Delivery.Process(t.Context(), uuid.MustParse(dv.ID)) }()
		wg.Wait()
		got := d.delivery(t, dv.ID)
		sentNow := len(sink.Received()) - before
		switch got.State {
		case "cancelled":
			if cancelStatus != 200 || sentNow != 0 {
				t.Fatalf("iteration %d: cancelled but status=%d sent=%d", i, cancelStatus, sentNow)
			}
		case "accepted":
			if cancelStatus != 409 || sentNow != 1 {
				t.Fatalf("iteration %d: accepted but cancel=%d sent=%d", i, cancelStatus, sentNow)
			}
		default:
			t.Fatalf("iteration %d: unexpected state %s", i, got.State)
		}
	}
}

func TestDeliveryLimitsAndInputBounds(t *testing.T) {
	d := newDelEnv(t)
	e := d.e
	sink := smtptest.Start(t, smtptest.StartTLS, e.CA, smtptest.Behavior{})
	d.putServer(t, sink, "starttls")
	// Oversized attachment: refused before any job or network.
	if r := e.Do("PUT", "/admin/integrations/settings", d.admin, settingsBody("2", true, true, false, 100, 10)); r.StatusCode != 200 {
		t.Fatalf("limit: %d %s", r.StatusCode, r.Body)
	}
	r := e.Do("POST", "/deliveries", d.userA, d.sendBody(d.ebook.File.ID, d.ebook.File.ContentVersion, d.rec, "server", d.serverRev))
	if r.StatusCode != 422 || r.Code() != "attachment_too_large" {
		t.Fatalf("large: %d %s", r.StatusCode, r.Body)
	}
	var n int
	_ = e.Pool.QueryRow(t.Context(), "SELECT count(*) FROM deliveries").Scan(&n)
	if n != 0 || e.DQ.Len() != 0 || func() int { c, _ := sink.Counts(); return c }() != 0 {
		t.Fatal("a refused request left state or touched the network")
	}
	// Invalid inputs.
	if r := e.Do("PUT", "/admin/integrations/settings", d.admin, settingsBody("3", true, true, false, 26214400, 10)); r.StatusCode != 200 {
		t.Fatalf("restore: %d", r.StatusCode)
	}
	good := d.sendBody(d.ebook.File.ID, d.ebook.File.ContentVersion, d.rec, "server", d.serverRev)
	mut := func(k string, v any) map[string]any {
		m := map[string]any{}
		for a, b := range good {
			m[a] = b
		}
		m["operationId"] = uuid.NewString()
		m[k] = v
		return m
	}
	for name, b := range map[string]map[string]any{
		"bad transport": mut("transport", "fallback"), "bad file id": mut("fileId", "x"), "bad recipient revision": mut("recipientRevision", "01"),
		"unknown file": mut("fileId", uuid.NewString()), "unknown recipient": mut("recipientId", uuid.NewString()),
		"stale recipient": mut("recipientRevision", "5"), "stale transport": mut("transportRevision", "9"),
		"personal not configured": mut("transport", "personal"),
	} {
		if r := e.Do("POST", "/deliveries", d.userA, b); r.StatusCode == 202 {
			t.Fatalf("%s accepted", name)
		}
	}
	// A foreign user's file or someone else's recipient is not usable.
	if r := e.Do("POST", "/deliveries", d.userB, good); r.StatusCode == 202 {
		t.Fatalf("another account used this account's recipient and file: %d", r.StatusCode)
	}
	// Per-user hourly rate: ten distinct intents succeed concurrently, the rest are 429; replays do not count.
	e.Do("PUT", "/admin/integrations/settings", d.admin, settingsBody("4", true, true, false, 26214400, 10))
	var wg sync.WaitGroup
	statuses := make([]int, 14)
	for i := range statuses {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			statuses[i] = e.Do("POST", "/deliveries", d.userA, mut("operationId", uuid.NewString())).StatusCode
		}(i)
	}
	wg.Wait()
	ok, limited := 0, 0
	for _, s := range statuses {
		switch s {
		case 202:
			ok++
		case 429:
			limited++
		default:
			t.Fatalf("unexpected status %d in %v", s, statuses)
		}
	}
	if ok != 10 || limited != 4 {
		t.Fatalf("rate limit: %d accepted, %d limited", ok, limited)
	}
	replay := mut("operationId", uuid.NewString())
	if x := e.Do("POST", "/deliveries", d.userA, replay); x.StatusCode != 429 {
		t.Fatalf("over the limit: %d", x.StatusCode)
	}
	r429 := e.Do("POST", "/deliveries", d.userA, mut("operationId", uuid.NewString()))
	if r429.Header.Get("Retry-After") == "" {
		t.Fatal("429 without Retry-After")
	}
	// An hour later the window has moved on.
	e.Clock.Advance(61 * time.Minute)
	d.userA = e.Login(seed.UserAName, "phone-again").AccessToken
	if x := e.Do("POST", "/deliveries", d.userA, mut("operationId", uuid.NewString())); x.StatusCode != 202 {
		t.Fatalf("after the window: %d %s", x.StatusCode, x.Body)
	}
}

func TestPersonalTransportUsesItsOwnCredentialsAndNeverFallsBack(t *testing.T) {
	d := newDelEnv(t)
	e := d.e
	serverSink := smtptest.Start(t, smtptest.StartTLS, e.CA, smtptest.Behavior{})
	d.putServer(t, serverSink, "starttls")
	personal := smtptest.Start(t, smtptest.StartTLS, e.CA, smtptest.Behavior{AuthUser: "alice", AuthPass: "alice-secret"})
	put := func(base, pw string) wire.T006SmtpReport {
		r := e.Do("PUT", "/delivery/smtp", d.userA, smtpBody(base, true, personal.Host, personal.Port, "starttls", "alice", "replace", &pw))
		if r.StatusCode != 200 {
			t.Fatalf("personal put: %d %s", r.StatusCode, r.Body)
		}
		var out wire.T006SmtpReport
		r.JSON(t, &out)
		return out
	}
	rep := put("0", "alice-secret")
	if tl := func() wire.T006TransportList {
		var l wire.T006TransportList
		e.Do("GET", "/delivery/transports", d.userA, nil).JSON(t, &l)
		return l
	}(); !tl.Personal.Available || tl.Personal.Revision != rep.Revision {
		t.Fatalf("transports: %+v", tl)
	}
	if r := e.Do("POST", "/delivery/smtp/test", d.userA, map[string]any{"operationId": uuid.NewString(), "baseRevision": rep.Revision}); !strings.Contains(string(r.Body), `"success":true`) {
		t.Fatalf("personal test: %s", r.Body)
	}
	r := e.Do("POST", "/deliveries", d.userA, d.sendBody(d.ebook.File.ID, d.ebook.File.ContentVersion, d.rec, "personal", rep.Revision))
	var dv wire.T006Delivery
	r.JSON(t, &dv)
	if r.StatusCode != 202 || dv.Transport != "personal" {
		t.Fatalf("personal send: %d %s", r.StatusCode, r.Body)
	}
	e.RunDeliveries()
	if got := d.delivery(t, dv.ID); got.State != "accepted" || len(personal.Received()) != 1 || len(serverSink.Received()) != 0 {
		t.Fatalf("personal delivery: %+v personal=%d server=%d", got, len(personal.Received()), len(serverSink.Received()))
	}
	// Wrong credentials fail with a sanitized code and are never retried through the server transport.
	rep = put(rep.Revision, "wrong-secret")
	r = e.Do("POST", "/deliveries", d.userA, d.sendBody(d.ebook.File.ID, d.ebook.File.ContentVersion, d.rec, "personal", rep.Revision))
	r.JSON(t, &dv)
	e.RunDeliveries()
	e.Clock.Advance(2 * time.Minute)
	e.RunDeliveries()
	got := d.delivery(t, dv.ID)
	if got.State != "failed" || got.Code == nil || *got.Code != "authentication_failed" || got.Attempts != 1 || len(serverSink.Received()) != 0 {
		t.Fatalf("auth failure: %+v server=%d", got, len(serverSink.Received()))
	}
	if strings.Contains(string(e.Do("GET", "/deliveries/"+dv.ID, d.userA, nil).Body), "wrong-secret") {
		t.Fatal("secret in delivery record")
	}
	// Another account cannot send through it, and its own unconfigured transport is not a fallback.
	other := d.recipient(d.userB, "B Reader", "b@example.invalid")
	body := d.sendBody(d.ebook.File.ID, d.ebook.File.ContentVersion, other, "personal", rep.Revision)
	if x := e.Do("POST", "/deliveries", d.userB, body); x.StatusCode == 202 {
		t.Fatalf("another account used a personal transport: %d", x.StatusCode)
	}
}
