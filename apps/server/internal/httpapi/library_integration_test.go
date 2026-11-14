package httpapi_test

import (
	"context"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func validConfig(root string) wire.LibraryConfig {
	return wire.LibraryConfig{Mode: "index", RootPath: root, ScanIntervalSecs: 900, VerifyIntervalSecs: 86400, StabilitySecs: 30, ProviderOrder: []string{}}
}

// ADR-0056: administrator status plus an explicit library grant.
func TestLibraryManagementNeedsAdminAndGrant(t *testing.T) {
	e := apitest.New(t)
	ctx := context.Background()
	root, _ := filepath.Abs(t.TempDir())
	admin := e.Login(seed.AdminName, "cli").AccessToken
	user := e.Login("fixture-user-a", "phone").AccessToken

	// Non-admin cannot create.
	r := e.Do("POST", "/admin/libraries", user, wire.CreateLibrary{Name: "L", Config: validConfig(root)})
	if r.StatusCode != http.StatusForbidden || r.Code() != "admin_required" {
		t.Fatalf("non-admin create: %d %s", r.StatusCode, r.Body)
	}

	r = e.Do("POST", "/admin/libraries", admin, map[string]any{"name": "Managed shelf", "config": map[string]any{"mode": "index", "rootPath": root, "followSymlinks": false, "writebackBackups": false, "providerOrder": []string{}}})
	if r.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %s", r.StatusCode, r.Body)
	}
	var d wire.LibraryDetail
	r.JSON(t, &d)
	c := d.Config
	if c.ScanIntervalSecs != 900 || c.VerifyIntervalSecs != 86400 || c.StabilitySecs != 30 || c.WritebackBackups || c.FollowSymlinks {
		t.Fatalf("accepted defaults not applied: %+v", c)
	}
	if d.Health.State != "unknown" {
		t.Fatalf("health: %+v", d.Health)
	}

	// Creating grants nobody: the creating administrator still cannot read it.
	r = e.Do("GET", "/admin/libraries/"+d.Library.ID, admin, nil)
	if r.StatusCode != http.StatusForbidden || r.Code() != "library_access_denied" {
		t.Fatalf("admin without grant: %d %s", r.StatusCode, r.Body)
	}
	r = e.Do("PUT", "/admin/libraries/"+d.Library.ID+"/config", admin, validConfig(root))
	if r.StatusCode != http.StatusForbidden {
		t.Fatalf("admin without grant PUT: %d %s", r.StatusCode, r.Body)
	}

	// After an explicit grant it works.
	if r = e.Do("PUT", "/admin/users/"+e.Fix.AdminID.String()+"/libraries/"+d.Library.ID, admin, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("grant: %d %s", r.StatusCode, r.Body)
	}
	if r = e.Do("GET", "/admin/libraries/"+d.Library.ID, admin, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("granted admin read: %d %s", r.StatusCode, r.Body)
	}
	cfg := validConfig(root)
	cfg.WritebackBackups = true
	bk, _ := filepath.Abs(t.TempDir())
	cfg.BackupRoot = &bk
	if r = e.Do("PUT", "/admin/libraries/"+d.Library.ID+"/config", admin, cfg); r.StatusCode != http.StatusOK {
		t.Fatalf("put: %d %s", r.StatusCode, r.Body)
	}
	_ = ctx
}

func TestLibraryConfigValidation(t *testing.T) {
	e := apitest.New(t)
	root, _ := filepath.Abs(t.TempDir())
	admin := e.Login(seed.AdminName, "cli").AccessToken
	sha := "0000000000000000000000000000000000000000000000000000000000000000"
	esc, abs, rel := "../outside", root, "sentinel.txt"
	cases := map[string]func(*wire.LibraryConfig){
		"relative root":           func(c *wire.LibraryConfig) { c.RootPath = "relative/dir" },
		"sentinel without hash":   func(c *wire.LibraryConfig) { c.SentinelPath = &rel },
		"sentinel escapes root":   func(c *wire.LibraryConfig) { c.SentinelPath, c.SentinelSHA256 = &esc, &sha },
		"absolute sentinel":       func(c *wire.LibraryConfig) { c.SentinelPath, c.SentinelSHA256 = &abs, &sha },
		"backups without root":    func(c *wire.LibraryConfig) { c.WritebackBackups = true },
		"unknown provider":        func(c *wire.LibraryConfig) { c.ProviderOrder = []string{"nope"} },
		"template on index":       func(c *wire.LibraryConfig) { c.ImportTemplate = &rel },
		"scan interval too short": func(c *wire.LibraryConfig) { c.ScanIntervalSecs = 5 },
	}
	for name, mutate := range cases {
		cfg := validConfig(root)
		mutate(&cfg)
		r := e.Do("POST", "/admin/libraries", admin, wire.CreateLibrary{Name: "v-" + name, Config: cfg})
		if r.StatusCode != http.StatusUnprocessableEntity && r.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: want 4xx validation, got %d %s", name, r.StatusCode, r.Body)
		}
	}
	// Duplicate library name is a typed conflict.
	ok := wire.CreateLibrary{Name: "dup", Config: validConfig(root)}
	if r := e.Do("POST", "/admin/libraries", admin, ok); r.StatusCode != http.StatusCreated {
		t.Fatalf("first: %d %s", r.StatusCode, r.Body)
	}
	if r := e.Do("POST", "/admin/libraries", admin, ok); r.StatusCode != http.StatusConflict || r.Code() != "library_name_taken" {
		t.Fatalf("dup: %d %s", r.StatusCode, r.Body)
	}
}
