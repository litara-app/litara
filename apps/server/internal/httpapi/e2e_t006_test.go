package httpapi_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/integrations"
	"github.com/deranjer/ebooker/apps/server/internal/koreader"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/smtptest"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// setupIntegrationsForBrowser prepares the long-running browser-test server for the T006 flows:
// OPDS, email and KOReader are enabled, the server mail transport points at a local TLS sink (no real
// mail is ever sent), and user A already has one retained KOReader candidate from a second device.
func setupIntegrationsForBrowser(t *testing.T, e *apitest.Env, admin, bookPath, libraryID string) {
	t.Helper()
	if r := e.Do("PUT", "/admin/integrations/settings", admin, settingsBody("0", true, true, true, 26214400, 100)); r.StatusCode != 200 {
		t.Fatalf("enable integrations: %d %s", r.StatusCode, r.Body)
	}
	sink := smtptest.Start(t, smtptest.StartTLS, e.CA, smtptest.Behavior{})
	if r := e.Do("PUT", "/admin/delivery/smtp", admin, smtpBody("0", true, sink.Host, sink.Port, "starttls", "", "keep", nil)); r.StatusCode != 200 {
		t.Fatalf("server smtp: %d %s", r.StatusCode, r.Body)
	}

	userA := e.Login(seed.UserAName, "e2e-setup").AccessToken
	type dev struct {
		cred wire.Credential
		pw   string
	}
	var devs []dev
	for i, label := range []string{"Kobo A", "Kobo B"} {
		pw := secret("e2e-ko-" + string(rune('a'+i)) + "-")
		r := createCred(e, userA, "koreader", label, pw)
		if r.StatusCode != 201 {
			t.Fatalf("ko credential: %d %s", r.StatusCode, r.Body)
		}
		var c wire.Credential
		r.JSON(t, &c)
		devs = append(devs, dev{c, pw})
	}
	f, err := os.Open(bookPath)
	if err != nil {
		t.Fatal(err)
	}
	st, _ := f.Stat()
	doc, err := koreader.PartialMD5(f, st.Size())
	_ = f.Close()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Indexer.IndexPending(context.Background(), 200); err != nil {
		t.Fatal(err)
	}
	call := func(method, path string, d dev, body any) int {
		var raw []byte
		hdr := []string{"x-auth-user", d.cred.Username, "x-auth-key", integrations.KOKey(d.pw)}
		if body != nil {
			raw, _ = json.Marshal(body)
			hdr = append(hdr, "Content-Type", "application/json")
		}
		return e.Proto(method, path, raw, hdr...).StatusCode
	}
	// Kobo A saves a place; Kobo B reads it but saves another without syncing first, which is retained.
	if code := call("GET", "/1/syncs/progress/"+doc, devs[0], nil); code != 200 {
		t.Fatalf("ko read A: %d", code)
	}
	if code := call("PUT", "/1/syncs/progress", devs[0], koPut(doc, "epubcfi(/6/8)", 0.30, "Kobo A")); code != 200 {
		t.Fatalf("ko put A: %d", code)
	}
	call("GET", "/1/syncs/progress/"+doc, devs[1], nil)
	if code := call("PUT", "/1/syncs/progress", devs[1], koPut(doc, "epubcfi(/6/50)", 0.55, "Kobo B")); code != 409 {
		t.Fatalf("expected a retained candidate, got %d", code)
	}
}
