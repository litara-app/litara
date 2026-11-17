package httpapi_test

import (
	"bytes"
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/integrations"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// secret returns a distinct 43-character base64url password.
func secret(tag string) string {
	s := tag + strings.Repeat("A", 43)
	return s[:43]
}

func settingsBody(base string, opds, email, ko bool, maxBytes int64, perHour int) map[string]any {
	return map[string]any{"operationId": uuid.NewString(), "baseRevision": base, "opdsEnabled": opds, "emailEnabled": email,
		"koreaderEnabled": ko, "maxAttachmentBytes": maxBytes, "maxDeliveriesPerUserPerHour": perHour}
}

func TestIntegrationSettings(t *testing.T) {
	e := apitest.New(t)
	admin := e.Login(seed.AdminName, "cli").AccessToken
	userA := e.Login(seed.UserAName, "phone").AccessToken

	// Initial state: everything disabled, contract defaults, revision zero.
	var st wire.T006IntegrationSettings
	g := e.Do("GET", "/integrations/settings", userA, nil)
	g.JSON(t, &st)
	if g.StatusCode != 200 || st.Revision != "0" || st.OpdsEnabled || st.EmailEnabled || st.KoreaderEnabled ||
		st.MaxAttachmentBytes != 26214400 || st.MaxDeliveriesPerUserPerHour != 10 || st.ServerSmtpAvailable {
		t.Fatalf("defaults: %d %s", g.StatusCode, g.Body)
	}
	if r := e.Do("GET", "/integrations/settings", "", nil); r.StatusCode != 401 {
		t.Fatalf("unauthenticated read: %d", r.StatusCode)
	}

	// A non-administrator cannot change settings.
	if r := e.Do("PUT", "/admin/integrations/settings", userA, settingsBody("0", true, true, true, 1000, 5)); r.StatusCode != 403 {
		t.Fatalf("non-admin write: %d %s", r.StatusCode, r.Body)
	}
	// Out-of-range limits are 422 and change nothing.
	for _, b := range []map[string]any{settingsBody("0", true, false, false, 104857601, 5), settingsBody("0", true, false, false, 0, 5),
		settingsBody("0", true, false, false, 100, 101), settingsBody("0", true, false, false, 100, 0)} {
		if r := e.Do("PUT", "/admin/integrations/settings", admin, b); r.StatusCode != 422 {
			t.Fatalf("limits: %d %s", r.StatusCode, r.Body)
		}
	}

	body := settingsBody("0", true, true, false, 5_000_000, 7)
	r := e.Do("PUT", "/admin/integrations/settings", admin, body)
	r.JSON(t, &st)
	if r.StatusCode != 200 || st.Revision != "1" || !st.OpdsEnabled || !st.EmailEnabled || st.KoreaderEnabled || st.MaxAttachmentBytes != 5_000_000 || st.MaxDeliveriesPerUserPerHour != 7 {
		t.Fatalf("update: %d %s", r.StatusCode, r.Body)
	}
	// An identical operation replays the original response without a second revision.
	if rp := e.Do("PUT", "/admin/integrations/settings", admin, body); rp.StatusCode != 200 || !bytes.Equal(rp.Body, r.Body) {
		t.Fatalf("replay: %d %s", rp.StatusCode, rp.Body)
	}
	// A changed payload under the same operation ID is refused.
	body2 := map[string]any{}
	for k, v := range body {
		body2[k] = v
	}
	body2["maxDeliveriesPerUserPerHour"] = 8
	if rp := e.Do("PUT", "/admin/integrations/settings", admin, body2); rp.StatusCode != 409 || rp.Code() != "operation_id_reused" {
		t.Fatalf("operation reuse: %d %s", rp.StatusCode, rp.Body)
	}
	// A stale base revision carries the current revision.
	stale := e.Do("PUT", "/admin/integrations/settings", admin, settingsBody("0", false, false, false, 100, 1))
	pm := problemMap(t, stale)
	if stale.StatusCode != 409 || stale.Code() != "stale_revision" || pm["currentRevision"] != "1" {
		t.Fatalf("stale: %d %s", stale.StatusCode, stale.Body)
	}
	// Every account reads the change; disabled services fail closed.
	e.Do("GET", "/integrations/settings", userA, nil).JSON(t, &st)
	if st.Revision != "1" || !st.OpdsEnabled {
		t.Fatalf("read after update: %+v", st)
	}
	if err := e.Integrations.Enabled(context.Background(), "koreader"); err == nil {
		t.Fatal("koreader must stay disabled")
	}
	if err := e.Integrations.Enabled(context.Background(), "opds"); err != nil {
		t.Fatalf("opds enabled: %v", err)
	}
}

func createCred(e *apitest.Env, token, kind, label, password string) apitest.Response {
	return e.Do("POST", "/integration-credentials", token, map[string]any{"operationId": uuid.NewString(), "kind": kind, "label": label, "password": password})
}

func TestCredentialLifecycleAndAuthenticationBoundaries(t *testing.T) {
	e := apitest.New(t)
	ctx := context.Background()
	admin := e.Login(seed.AdminName, "cli").AccessToken
	userA := e.Login(seed.UserAName, "phone").AccessToken
	userB := e.Login(seed.UserBName, "tablet").AccessToken
	pw := secret("opds-pw-")

	op := uuid.NewString()
	create := map[string]any{"operationId": op, "kind": "opds", "label": "My reader", "password": pw}
	r := e.Do("POST", "/integration-credentials", userA, create)
	var cred wire.T006Credential
	r.JSON(t, &cred)
	if r.StatusCode != 201 || cred.Kind != "opds" || cred.Label != "My reader" || cred.Revoked || cred.LastUsedAt != nil ||
		!strings.HasPrefix(cred.Username, "opds-") || strings.Contains(string(r.Body), pw) {
		t.Fatalf("create: %d %s", r.StatusCode, r.Body)
	}
	// Replay returns the original 201 body; the secret is nowhere in it.
	if rp := e.Do("POST", "/integration-credentials", userA, create); rp.StatusCode != 201 || !bytes.Equal(rp.Body, r.Body) {
		t.Fatalf("create replay: %d %s", rp.StatusCode, rp.Body)
	}
	// The same operation with a different secret is a changed request.
	create["password"] = secret("another-")
	if rp := e.Do("POST", "/integration-credentials", userA, create); rp.StatusCode != 409 || rp.Code() != "operation_id_reused" {
		t.Fatalf("changed secret: %d %s", rp.StatusCode, rp.Body)
	}
	// Validation failures are 422 with no side effects.
	for name, b := range map[string]map[string]any{
		"short":       {"operationId": uuid.NewString(), "kind": "opds", "label": "x", "password": "short"},
		"charset":     {"operationId": uuid.NewString(), "kind": "opds", "label": "x", "password": strings.Repeat("a", 31) + "!"},
		"kind":        {"operationId": uuid.NewString(), "kind": "other", "label": "x", "password": pw},
		"empty label": {"operationId": uuid.NewString(), "kind": "opds", "label": "  ", "password": pw},
	} {
		if x := e.Do("POST", "/integration-credentials", userA, b); x.StatusCode != 422 {
			t.Fatalf("%s: %d %s", name, x.StatusCode, x.Body)
		}
	}
	kpw := secret("koreader-pw-")
	kr := createCred(e, userA, "koreader", "Kobo", kpw)
	var kcred wire.T006Credential
	kr.JSON(t, &kcred)
	if kr.StatusCode != 201 || !strings.HasPrefix(kcred.Username, "kor-") {
		t.Fatalf("koreader create: %d %s", kr.StatusCode, kr.Body)
	}

	// Only the owner's active credentials are listed; no secret material appears.
	var list wire.T006CredentialList
	l := e.Do("GET", "/integration-credentials", userA, nil)
	l.JSON(t, &list)
	if len(list.Items) != 2 || strings.Contains(string(l.Body), pw) || strings.Contains(string(l.Body), "verifier") {
		t.Fatalf("list: %s", l.Body)
	}
	e.Do("GET", "/integration-credentials", userB, nil).JSON(t, &list)
	if len(list.Items) != 0 {
		t.Fatalf("another account sees %d credentials", len(list.Items))
	}

	// Protocol authentication: the designated kind and secret only.
	if _, err := e.Integrations.Authenticate(ctx, integrations.KindOPDS, cred.Username, pw); err != nil {
		t.Fatalf("opds auth: %v", err)
	}
	if _, err := e.Integrations.Authenticate(ctx, integrations.KindOPDS, cred.Username, "wrong"+pw); err == nil {
		t.Fatal("wrong secret accepted")
	}
	if _, err := e.Integrations.Authenticate(ctx, integrations.KindOPDS, kcred.Username, kpw); err == nil {
		t.Fatal("koreader credential accepted as OPDS")
	}
	if _, err := e.Integrations.Authenticate(ctx, integrations.KindKOReader, cred.Username, integrations.KOKey(pw)); err == nil {
		t.Fatal("opds credential accepted as KOReader")
	}
	if _, err := e.Integrations.Authenticate(ctx, integrations.KindKOReader, kcred.Username, kpw); err == nil {
		t.Fatal("raw koreader password accepted instead of its MD5 key")
	}
	if _, err := e.Integrations.Authenticate(ctx, integrations.KindKOReader, kcred.Username, integrations.KOKey(kpw)); err != nil {
		t.Fatalf("koreader auth: %v", err)
	}
	if _, err := e.Integrations.Authenticate(ctx, integrations.KindOPDS, seed.UserAName, e.Password); err == nil {
		t.Fatal("main account password accepted as a protocol secret")
	}
	// A protocol secret never authenticates the management API.
	if x := e.Do("GET", "/integration-credentials", pw, nil); x.StatusCode != 401 {
		t.Fatalf("protocol secret as bearer: %d", x.StatusCode)
	}
	e.Do("GET", "/integration-credentials", userA, nil).JSON(t, &list)
	used := false
	for _, c := range list.Items {
		used = used || c.LastUsedAt != nil
	}
	if !used {
		t.Fatal("lastUsedAt was not recorded")
	}

	// Another account cannot revoke it and learns nothing (404); neither can an administrator.
	if x := e.Do("POST", "/integration-credentials/"+cred.ID+"/revoke", userB, map[string]any{"operationId": uuid.NewString()}); x.StatusCode != 404 {
		t.Fatalf("foreign revoke: %d %s", x.StatusCode, x.Body)
	}
	if x := e.Do("POST", "/integration-credentials/"+cred.ID+"/revoke", admin, map[string]any{"operationId": uuid.NewString()}); x.StatusCode != 404 {
		t.Fatalf("admin revoke: %d %s", x.StatusCode, x.Body)
	}

	// Revoke is idempotent, keeps metadata and takes effect immediately.
	rvOp := map[string]any{"operationId": uuid.NewString()}
	rv := e.Do("POST", "/integration-credentials/"+cred.ID+"/revoke", userA, rvOp)
	var revoked wire.T006Credential
	rv.JSON(t, &revoked)
	if rv.StatusCode != 200 || !revoked.Revoked || revoked.Username != cred.Username {
		t.Fatalf("revoke: %d %s", rv.StatusCode, rv.Body)
	}
	if rp := e.Do("POST", "/integration-credentials/"+cred.ID+"/revoke", userA, rvOp); rp.StatusCode != 200 || !bytes.Equal(rp.Body, rv.Body) {
		t.Fatalf("revoke replay: %d %s", rp.StatusCode, rp.Body)
	}
	again := e.Do("POST", "/integration-credentials/"+cred.ID+"/revoke", userA, map[string]any{"operationId": uuid.NewString()})
	var r2 wire.T006Credential
	again.JSON(t, &r2)
	if again.StatusCode != 200 || !r2.Revoked {
		t.Fatalf("second revoke: %d %s", again.StatusCode, again.Body)
	}
	if _, err := e.Integrations.Authenticate(ctx, integrations.KindOPDS, cred.Username, pw); err == nil {
		t.Fatal("revoked credential still authenticates")
	}
	e.Do("GET", "/integration-credentials", userA, nil).JSON(t, &list)
	if len(list.Items) != 1 || list.Items[0].ID != kcred.ID {
		t.Fatalf("revoked credential must leave the active list: %+v", list.Items)
	}

	// Disabling the owner invalidates the remaining credential at once.
	if x := e.Do("PATCH", "/admin/users/"+e.Fix.UserAID.String(), admin, map[string]any{"active": false}); x.StatusCode != 200 {
		t.Fatalf("disable: %d %s", x.StatusCode, x.Body)
	}
	if _, err := e.Integrations.Authenticate(ctx, integrations.KindKOReader, kcred.Username, integrations.KOKey(kpw)); err == nil {
		t.Fatal("disabled account credential still authenticates")
	}
}

func TestCredentialLimitsAndThrottle(t *testing.T) {
	e := apitest.New(t)
	ctx := context.Background()
	userA := e.Login(seed.UserAName, "phone").AccessToken
	var first wire.T006Credential
	for i := 0; i < integrations.MaxActiveCredentials; i++ {
		r := createCred(e, userA, "opds", "reader", secret(string(rune('a'+i%26))+string(rune('a'+i/26))+"-"))
		if r.StatusCode != 201 {
			t.Fatalf("credential %d: %d %s", i, r.StatusCode, r.Body)
		}
		if i == 0 {
			r.JSON(t, &first)
		}
	}
	if r := createCred(e, userA, "koreader", "one too many", secret("z-")); r.StatusCode != 422 || r.Code() != "limit_exceeded" {
		t.Fatalf("limit: %d %s", r.StatusCode, r.Body)
	}
	// Repeated failures for one username throttle that username (429).
	var last error
	for i := 0; i < 20; i++ {
		_, last = e.Integrations.Authenticate(ctx, integrations.KindOPDS, first.Username, "definitely-not-the-secret-"+string(rune('a'+i)))
	}
	if ae, ok := apperr.As(last); !ok || ae.Status != http.StatusTooManyRequests {
		t.Fatalf("throttle: %v", last)
	}
}
