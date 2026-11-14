package httpapi_test

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/accounts"
	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/httpapi"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func status(t *testing.T, r apitest.Response, want int, code string) {
	t.Helper()
	if r.StatusCode != want || (code != "" && r.Code() != code) {
		t.Fatalf("%s %s: got %d code=%q, want %d code=%q\n%s", r.Request.Method, r.Request.URL.Path, r.StatusCode, r.Code(), want, code, r.Body)
	}
}

func TestBootstrapIsAtomicAndHasNoDefaultCredentials(t *testing.T) {
	e := apitest.New(t, apitest.Options{NoSeed: true})
	ctx := context.Background()

	// Nothing is usable before bootstrap: no default account, no public registration.
	status(t, e.Do("POST", "/auth/native/login", "", wire.Login{Username: "admin", Password: "admin", DeviceName: "x"}), 401, "invalid_credentials")
	status(t, e.Do("POST", "/admin/users", "", wire.CreateUser{Username: "u", Password: "long-enough-password", IsAdmin: true}), 401, "")

	var wg sync.WaitGroup
	var mu sync.Mutex
	ok, refused := 0, 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := e.Accounts.Bootstrap(ctx, "root", "Root", "synthetic-fixture-password")
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				ok++
			} else if err == accounts.ErrAlreadyInitialized {
				refused++
			} else {
				t.Errorf("unexpected: %v", err)
			}
		}()
	}
	wg.Wait()
	if ok != 1 || refused != 7 {
		t.Fatalf("bootstrap: %d succeeded, %d refused", ok, refused)
	}
	if _, err := e.Accounts.Bootstrap(ctx, "second", "Second", "synthetic-fixture-password"); err != accounts.ErrAlreadyInitialized {
		t.Fatalf("second bootstrap: %v", err)
	}
	tp := e.Login("ROOT", "cli") // username lookup is case-insensitive
	status(t, e.Do("GET", "/me", tp.AccessToken, nil), 200, "")
	// Server identity is persisted once and stable.
	var d1, d2 wire.Discovery
	e.Do("GET", "/discovery", "", nil).JSON(t, &d1)
	e.Do("GET", "/discovery", "", nil).JSON(t, &d2)
	if d1.ServerID == "" || d1.ServerID != d2.ServerID || d1.APIBasePath != "/api/v1" || d1.Registration != "admin-only" {
		t.Fatalf("discovery: %+v %+v", d1, d2)
	}
}

func refresh(e *apitest.Env, token, id string) apitest.Response {
	return e.Do("POST", "/auth/native/refresh", "", wire.Refresh{RefreshToken: token, RequestID: id})
}

func TestRefreshExchangeRules(t *testing.T) {
	e := apitest.New(t)
	tp := e.Login("fixture-user-a", "Phone A")
	other := e.Login("fixture-user-a", "Tablet") // a second device that must never be affected
	req1 := "00000000-0000-4000-8000-000000000011"

	r1 := refresh(e, tp.RefreshToken, req1)
	status(t, r1, 200, "")
	var tp2 wire.TokenPair
	r1.JSON(t, &tp2)
	if tp2.AccessToken == tp.AccessToken || tp2.RefreshToken == tp.RefreshToken || tp2.Session.ID != tp.Session.ID {
		t.Fatal("refresh must rotate both credentials and keep the session")
	}
	if tp2.Session.AbsoluteExpiresAt != tp.Session.AbsoluteExpiresAt {
		t.Fatal("refresh must not move the absolute deadline")
	}

	// Lost response: the identical exchange within 60s returns the identical result, no second rotation.
	e.Clock.Advance(59 * time.Second)
	r2 := refresh(e, tp.RefreshToken, req1)
	status(t, r2, 200, "")
	if string(r2.Body) != string(r1.Body) {
		t.Fatalf("retry body differs:\n%s\n%s", r1.Body, r2.Body)
	}
	var gen int
	if err := e.Pool.QueryRow(context.Background(), `SELECT refresh_generation FROM sessions WHERE id = $1`, tp.Session.ID).Scan(&gen); err != nil || gen != 2 {
		t.Fatalf("generation %d %v", gen, err)
	}

	// At 60s the protected response is gone and the same exchange is a typed failure; the session survives.
	e.Clock.Advance(time.Second)
	status(t, refresh(e, tp.RefreshToken, req1), 401, "refresh_retry_expired")
	status(t, e.Do("GET", "/me", tp2.AccessToken, nil), 200, "")
	if n, _ := e.Accounts.PurgeExpiredExchanges(context.Background()); n < 0 {
		t.Fatal("purge failed")
	}
	var sealed int
	_ = e.Pool.QueryRow(context.Background(), `SELECT count(*) FROM refresh_exchanges WHERE response_ciphertext IS NOT NULL AND session_id = $1`, tp.Session.ID).Scan(&sealed)
	if sealed != 0 {
		t.Fatalf("%d protected responses remain after the recovery window", sealed)
	}

	// Different request ID with the old token: reuse. Revokes this device session only.
	status(t, refresh(e, tp.RefreshToken, "00000000-0000-4000-8000-000000000012"), 401, "refresh_reuse")
	status(t, e.Do("GET", "/me", tp2.AccessToken, nil), 401, "session_revoked")
	status(t, refresh(e, tp2.RefreshToken, "00000000-0000-4000-8000-000000000013"), 401, "session_revoked")
	status(t, refresh(e, tp.RefreshToken, req1), 401, "session_revoked")
	status(t, e.Do("GET", "/me", other.AccessToken, nil), 200, "")
}

func TestConcurrentIdenticalRefreshRotatesOnce(t *testing.T) {
	e := apitest.New(t)
	tp := e.Login("fixture-user-a", "Phone A")
	id := uuid.NewString()
	var wg sync.WaitGroup
	bodies := make([]string, 8)
	codes := make([]int, 8)
	for i := range bodies {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := refresh(e, tp.RefreshToken, id)
			bodies[i], codes[i] = string(r.Body), r.StatusCode
		}()
	}
	wg.Wait()
	for i := range bodies {
		if codes[i] != 200 || bodies[i] != bodies[0] {
			t.Fatalf("attempt %d: %d\n%s\nvs\n%s", i, codes[i], bodies[i], bodies[0])
		}
	}
	var gen int
	_ = e.Pool.QueryRow(context.Background(), `SELECT refresh_generation FROM sessions WHERE id = $1`, tp.Session.ID).Scan(&gen)
	if gen != 2 {
		t.Fatalf("rotated %d times", gen-1)
	}
}

func TestSessionLifetimes(t *testing.T) {
	e := apitest.New(t)
	tp := e.Login("fixture-user-a", "Phone A")
	status(t, e.Do("GET", "/me", tp.AccessToken, nil), 200, "")

	// Access expires after 900 seconds (not at 899); refresh issues a fresh pair.
	e.Clock.Advance(899 * time.Second)
	status(t, e.Do("GET", "/me", tp.AccessToken, nil), 200, "")
	e.Clock.Advance(2 * time.Second)
	status(t, e.Do("GET", "/me", tp.AccessToken, nil), 401, "token_expired")
	var cur wire.TokenPair
	r := refresh(e, tp.RefreshToken, uuid.NewString())
	status(t, r, 200, "")
	r.JSON(t, &cur)
	status(t, e.Do("GET", "/me", cur.AccessToken, nil), 200, "")

	// Idle expiry is 30 days; each fresh refresh renews idle use but never the 90-day absolute deadline.
	abs, _ := time.Parse(time.RFC3339Nano, tp.Session.AbsoluteExpiresAt)
	for i := 0; i < 3; i++ {
		e.Clock.Advance(29 * 24 * time.Hour)
		r = refresh(e, cur.RefreshToken, uuid.NewString())
		status(t, r, 200, "")
		r.JSON(t, &cur)
		if cur.Session.AbsoluteExpiresAt != tp.Session.AbsoluteExpiresAt {
			t.Fatal("absolute deadline moved")
		}
		if idle, _ := time.Parse(time.RFC3339Nano, cur.Session.IdleExpiresAt); idle.After(abs) {
			t.Fatalf("idle deadline %s passes absolute %s", idle, abs)
		}
	}
	e.Clock.Advance(29 * 24 * time.Hour) // day ~89+: still inside idle, past absolute soon
	e.Clock.Advance(5 * 24 * time.Hour)
	status(t, refresh(e, cur.RefreshToken, uuid.NewString()), 401, "session_expired")

	// A separate session untouched for 31 days is idle-expired.
	late := e.Login("fixture-user-b", "Phone B")
	e.Clock.Advance(31 * 24 * time.Hour)
	status(t, e.Do("GET", "/me", late.AccessToken, nil), 401, "")
}

func TestLogoutDisableAndPasswordReset(t *testing.T) {
	e := apitest.New(t)
	ctx := context.Background()
	a1, a2 := e.Login("fixture-user-a", "one"), e.Login("fixture-user-a", "two")
	status(t, e.Do("POST", "/auth/native/logout", a1.AccessToken, nil), 204, "")
	status(t, e.Do("GET", "/me", a1.AccessToken, nil), 401, "session_revoked")
	status(t, e.Do("GET", "/me", a2.AccessToken, nil), 200, "") // other sessions remain

	// Own sessions only.
	var list wire.Sessions
	e.Do("GET", "/sessions", a2.AccessToken, nil).JSON(t, &list)
	if len(list.Items) != 1 || list.Items[0].ID != a2.Session.ID {
		t.Fatalf("sessions: %+v", list)
	}
	b := e.Login("fixture-user-b", "b")
	status(t, e.Do("DELETE", "/sessions/"+b.Session.ID, a2.AccessToken, nil), 404, "not_found")
	third := e.Login("fixture-user-a", "three")
	status(t, e.Do("DELETE", "/sessions/"+third.Session.ID, a2.AccessToken, nil), 204, "")
	status(t, e.Do("GET", "/me", third.AccessToken, nil), 401, "")
	status(t, e.Do("GET", "/me", b.AccessToken, nil), 200, "")

	// Disabling an account applies to the very next request on every device.
	admin := e.Login("fixture-admin", "admin")
	off := false
	status(t, e.Do("PATCH", "/admin/users/"+e.Fix.UserBID.String(), admin.AccessToken, wire.UpdateUser{Active: &off}), 200, "")
	status(t, e.Do("GET", "/me", b.AccessToken, nil), 401, "")
	status(t, e.Do("POST", "/auth/native/login", "", wire.Login{Username: "fixture-user-b", Password: e.Password, DeviceName: "x"}), 401, "invalid_credentials")

	// Operator password reset revokes sessions and replaces the credential.
	if err := e.Accounts.SetPassword(ctx, "fixture-user-a", "another-synthetic-password"); err != nil {
		t.Fatal(err)
	}
	status(t, e.Do("GET", "/me", a2.AccessToken, nil), 401, "")
	status(t, e.Do("POST", "/auth/native/login", "", wire.Login{Username: "fixture-user-a", Password: e.Password, DeviceName: "x"}), 401, "invalid_credentials")
	status(t, e.Do("POST", "/auth/native/login", "", wire.Login{Username: "fixture-user-a", Password: "another-synthetic-password", DeviceName: "x"}), 200, "")
}

func TestAdminRulesUsernamesAndThrottle(t *testing.T) {
	e := apitest.New(t)
	admin := e.Login("fixture-admin", "admin")
	user := e.Login("fixture-user-a", "a")

	status(t, e.Do("POST", "/admin/users", user.AccessToken, wire.CreateUser{Username: "x", DisplayName: "x", Password: "long-enough-password"}), 403, "admin_required")
	status(t, e.Do("GET", "/admin/users", user.AccessToken, nil), 403, "admin_required")

	// Creating a user grants nothing implicitly.
	r := e.Do("POST", "/admin/users", admin.AccessToken, wire.CreateUser{Username: "  Élise ", DisplayName: "Élise", Password: "long-enough-password"})
	status(t, r, 201, "")
	var u wire.User
	r.JSON(t, &u)
	if u.Username != "Élise" || u.IsAdmin || !u.Active {
		t.Fatalf("created user: %+v", u)
	}
	// NFC/lowercase uniqueness: decomposed é must collide with composed É.
	status(t, e.Do("POST", "/admin/users", admin.AccessToken, wire.CreateUser{Username: "élise", DisplayName: "dup", Password: "long-enough-password"}), 409, "username_taken")
	if tp := e.Do("POST", "/auth/native/login", "", wire.Login{Username: "ÉLISE", Password: "long-enough-password", DeviceName: "d"}); tp.StatusCode != 200 {
		t.Fatalf("case-insensitive login: %d %s", tp.StatusCode, tp.Body)
	}
	// Passwords are not normalized or trimmed.
	status(t, e.Do("POST", "/auth/native/login", "", wire.Login{Username: "Élise", Password: " long-enough-password", DeviceName: "d"}), 401, "invalid_credentials")
	var libs wire.LibraryList
	var tok wire.TokenPair
	e.Do("POST", "/auth/native/login", "", wire.Login{Username: "Élise", Password: "long-enough-password", DeviceName: "d"}).JSON(t, &tok)
	e.Do("GET", "/libraries", tok.AccessToken, nil).JSON(t, &libs)
	if libs.Total != 0 {
		t.Fatalf("new user sees %d libraries", libs.Total)
	}

	// The last active administrator cannot be removed or deactivated.
	off, no := false, false
	status(t, e.Do("PATCH", "/admin/users/"+e.Fix.AdminID.String(), admin.AccessToken, wire.UpdateUser{Active: &off}), 409, "last_administrator")
	status(t, e.Do("PATCH", "/admin/users/"+e.Fix.AdminID.String(), admin.AccessToken, wire.UpdateUser{IsAdmin: &no}), 409, "last_administrator")
	status(t, e.Do("PATCH", "/admin/users/"+e.Fix.AdminID.String(), admin.AccessToken, []byte(`{}`)), 422, "validation_failed")
	status(t, e.Do("PATCH", "/admin/users/"+uuid.NewString(), admin.AccessToken, wire.UpdateUser{Active: &off}), 404, "not_found")

	// Repeated failures are throttled with Retry-After.
	var last apitest.Response
	for i := 0; i < 12; i++ {
		last = e.Do("POST", "/auth/native/login", "", wire.Login{Username: "fixture-user-b", Password: "wrong-password-value", DeviceName: "d"})
	}
	status(t, last, 429, "rate_limited")
	if last.Header.Get("Retry-After") == "" {
		t.Fatal("missing Retry-After")
	}
}

func TestBrowserSessionCookieOriginAndCSRF(t *testing.T) {
	e := apitest.New(t, apitest.Options{Cfg: httpapi.APIConfig{DevInsecureHTTP: true}})
	origin := e.Server.URL
	login := wire.Login{Username: "fixture-user-a", Password: e.Password, DeviceName: "Browser"}

	// Cross-origin or originless login is refused and creates no session.
	status(t, e.Do("POST", "/auth/web/login", "", login, "Origin", "https://evil.example"), 403, "csrf_failed")
	status(t, e.Do("POST", "/auth/web/login", "", login), 403, "csrf_failed")
	var n int
	_ = e.Pool.QueryRow(context.Background(), `SELECT count(*) FROM sessions`).Scan(&n)
	if n != 0 {
		t.Fatalf("%d sessions created by refused logins", n)
	}

	r := e.Do("POST", "/auth/web/login", "", login, "Origin", origin)
	status(t, r, 200, "")
	sc := r.Header.Get("Set-Cookie")
	for _, want := range []string{"litara_session=", "HttpOnly", "SameSite=Lax", "Path=/api/v1"} {
		if !strings.Contains(sc, want) {
			t.Fatalf("cookie %q lacks %s", sc, want)
		}
	}
	if strings.Contains(sc, "Domain") || strings.Contains(sc, "Secure") { // Secure only absent in explicit dev-HTTP mode
		t.Fatalf("dev cookie attributes: %s", sc)
	}
	if strings.Contains(string(r.Body), "accessToken") {
		t.Fatal("browser login must not return bearer credentials")
	}
	cookie := strings.SplitN(sc, ";", 2)[0]

	var bs wire.BrowserSession
	status(t, e.Do("GET", "/auth/web/session", "", nil, "Cookie", cookie), 200, "")
	e.Do("GET", "/auth/web/session", "", nil, "Cookie", cookie).JSON(t, &bs)
	if len(bs.CSRFToken) < 32 || bs.Session.Client != "web" {
		t.Fatalf("session: %+v", bs)
	}

	// State changes need an allowed Origin and the CSRF token; failures mutate nothing.
	rec := e.Fix.ThreeFile.String()
	var snap wire.Recording
	e.Do("GET", "/recordings/"+rec, "", nil, "Cookie", cookie).JSON(t, &snap)
	write := wire.PositionWrite{OperationID: uuid.NewString(), BaseRevision: "0", LayoutRevision: snap.LayoutRevision,
		Position: wire.PositionInput{FileID: snap.Files[0].ID, ContentVersion: snap.Files[0].ContentVersion, OffsetMs: 1000, CapturedAt: "2026-11-13T12:00:00Z"}}
	status(t, e.Do("PUT", "/recordings/"+rec+"/position", "", write, "Cookie", cookie, "Origin", origin), 403, "csrf_failed")
	status(t, e.Do("PUT", "/recordings/"+rec+"/position", "", write, "Cookie", cookie, "X-CSRF-Token", bs.CSRFToken), 403, "csrf_failed")
	status(t, e.Do("PUT", "/recordings/"+rec+"/position", "", write, "Cookie", cookie, "X-CSRF-Token", bs.CSRFToken, "Origin", "https://evil.example"), 403, "csrf_failed")
	var st wire.PositionState
	e.Do("GET", "/recordings/"+rec+"/position", "", nil, "Cookie", cookie).JSON(t, &st)
	if st.Revision != "0" {
		t.Fatal("a refused request mutated state")
	}
	status(t, e.Do("PUT", "/recordings/"+rec+"/position", "", write, "Cookie", cookie, "X-CSRF-Token", bs.CSRFToken, "Origin", origin), 200, "")

	// Mixing cookie and bearer is rejected outright.
	tp := e.Login("fixture-user-a", "native")
	status(t, e.Do("GET", "/me", tp.AccessToken, nil, "Cookie", cookie), 400, "ambiguous_credentials")

	// Logout needs CSRF, clears the cookie with identical scope and revokes the session.
	status(t, e.Do("POST", "/auth/web/logout", "", nil, "Cookie", cookie, "Origin", origin), 403, "csrf_failed")
	lo := e.Do("POST", "/auth/web/logout", "", nil, "Cookie", cookie, "Origin", origin, "X-CSRF-Token", bs.CSRFToken)
	status(t, lo, 204, "")
	if c := lo.Header.Get("Set-Cookie"); !strings.Contains(c, "Path=/api/v1") || !strings.Contains(c, "Max-Age=0") && !strings.Contains(c, "Expires=Thu, 01 Jan 1970") {
		t.Fatalf("clearing cookie: %q", c)
	}
	status(t, e.Do("GET", "/me", "", nil, "Cookie", cookie), 401, "session_revoked")
}

func TestProductionCookieIsSecure(t *testing.T) {
	e := apitest.New(t, apitest.Options{Cfg: httpapi.APIConfig{PublicPrefix: "/litara"}})
	r := e.Do("POST", "/auth/web/login", "", wire.Login{Username: "fixture-user-a", Password: e.Password, DeviceName: "B"}, "Origin", e.Server.URL)
	status(t, r, 200, "")
	sc := r.Header.Get("Set-Cookie")
	if !strings.Contains(sc, "Secure") || !strings.Contains(sc, "Path=/litara/api/v1") {
		t.Fatalf("production cookie: %s", sc)
	}
	var d wire.Discovery
	e.Do("GET", "/discovery", "", nil).JSON(t, &d)
	if d.APIBasePath != "/litara/api/v1" {
		t.Fatalf("apiBasePath %s", d.APIBasePath)
	}
	var snap wire.Recording
	tp := e.Login("fixture-user-a", "n")
	e.Do("GET", "/recordings/"+e.Fix.ThreeFile.String(), tp.AccessToken, nil).JSON(t, &snap)
	if !strings.HasPrefix(snap.Files[0].ContentPath, "/litara/api/v1/files/") || !strings.HasPrefix(*snap.Artwork.ThumbnailPath, "/litara/") {
		t.Fatalf("paths ignore the mount prefix: %s", snap.Files[0].ContentPath)
	}
}

var _ = http.StatusOK
