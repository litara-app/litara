package httpapi_test

import (
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func TestSeededFlowSmoke(t *testing.T) {
	e := apitest.New(t)
	tp := e.Login("fixture-user-a", "Phone A")
	r := e.Do("GET", "/recordings", tp.AccessToken, nil)
	t.Logf("%d %s", r.StatusCode, r.Body)
	var list wire.Recordings
	r.JSON(t, &list)
	if r.StatusCode != 200 || list.Total == 0 {
		t.Fatalf("list: %d %s", r.StatusCode, r.Body)
	}
	snap := e.Do("GET", "/recordings/"+e.Fix.ThreeFile.String(), tp.AccessToken, nil)
	t.Logf("%d %s", snap.StatusCode, snap.Body)
	bad := e.Do("POST", "/auth/native/login", "", []byte(`{"username":`))
	t.Logf("malformed: %d %s", bad.StatusCode, bad.Body)
	inv := e.Do("POST", "/auth/native/login", "", map[string]any{"username": "x"})
	t.Logf("invalid: %d %s", inv.StatusCode, inv.Body)
}
