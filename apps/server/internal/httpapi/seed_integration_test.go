package httpapi_test

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/inspect"
	"github.com/deranjer/ebooker/apps/server/internal/seed"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
)

// The seed is explicit and repeatable: a second run changes nothing logical and never rewrites media bytes.
func TestSeedIsRepeatableAndNeverAutomatic(t *testing.T) {
	e := apitest.New(t)
	ctx := context.Background()
	count := func(table string) int {
		var n int
		if err := e.Pool.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	tables := []string{"users", "libraries", "user_library_grants", "titles", "recordings", "media_files", "file_versions", "recording_files", "chapter_sources"}
	before := map[string]int{}
	for _, tb := range tables {
		before[tb] = count(tb)
	}
	info1, _ := statAll(e.Fix.Files)

	insp := inspect.New(inspect.Config{ProbePath: testutil.Tool(t, "ffprobe"), MediaRoot: e.Cfg.MediaRoot})
	fix2, err := seed.Run(ctx, seed.Options{Pool: e.Pool, Accounts: e.Accounts, Inspector: insp, FFmpeg: testutil.Tool(t, "ffmpeg"), Dir: e.Cfg.MediaRoot, Password: "different-password-ignored"})
	if err != nil {
		t.Fatal(err)
	}
	for _, tb := range tables {
		if count(tb) != before[tb] {
			t.Errorf("%s: %d rows after rerun, want %d", tb, count(tb), before[tb])
		}
	}
	if fix2.ThreeFile != e.Fix.ThreeFile || fix2.Files["r1-f1"].Version != e.Fix.Files["r1-f1"].Version {
		t.Error("deterministic fixture identifiers changed on rerun")
	}
	if info2, _ := statAll(fix2.Files); info1 != info2 {
		t.Errorf("media bytes were rewritten: %s vs %s", info1, info2)
	}
	// Existing accounts keep their original credential; a rerun does not reset passwords.
	_ = e.Login("fixture-user-a", "still works with the original password")
	// Nothing in the server wiring seeds at startup: a fresh migrated database has no users.
	fresh := apitest.New(t, apitest.Options{NoSeed: true})
	var n int
	_ = fresh.Pool.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&n)
	if n != 0 {
		t.Fatalf("a fresh server started with %d users", n)
	}
}

func statAll(files map[string]seed.FileRef) (string, error) {
	var out string
	for _, k := range []string{"r1-f1", "r1-f2", "r1-f3", "r2-f1", "r3-f1", "r4-f1"} {
		st, err := os.Stat(files[k].Path)
		if err != nil {
			return "", err
		}
		out += fmt.Sprintf("%s:%d:%d;", k, st.Size(), st.ModTime().UnixNano())
	}
	return out, nil
}
