package ingest_test

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/ingest"
)

func touch(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func rels(es []ingest.Entry) []string {
	var r []string
	for _, e := range es {
		r = append(r, e.Rel)
	}
	sort.Strings(r)
	return r
}

// Walk needs no database or media tools, so the symlink rules can be checked on
// any host that can create links (skipped, loudly, where it cannot).
func TestWalkSymlinkRules(t *testing.T) {
	outside, root := t.TempDir(), t.TempDir()
	touch(t, filepath.Join(outside, "secret.mp3"))
	touch(t, filepath.Join(outside, "dir", "inner.mp3"))
	touch(t, filepath.Join(root, "real.mp3"))
	touch(t, filepath.Join(root, "inside", "target.mp3"))
	touch(t, filepath.Join(root, "notes.txt")) // unsupported types are ignored
	touch(t, filepath.Join(root, "book.cue"))  // sidecars are listed separately
	links := map[string]string{
		"escape.mp3":    filepath.Join(outside, "secret.mp3"),
		"inside-ln.mp3": filepath.Join(root, "inside", "target.mp3"),
		"dirlink":       filepath.Join(outside, "dir"),
	}
	for name, target := range links {
		if err := os.Symlink(target, filepath.Join(root, name)); err != nil {
			t.Skipf("cannot create symlinks on this host (%v): symlink exclusion NOT exercised", err)
		}
	}

	l, err := ingest.Walk(context.Background(), root, false)
	if err != nil {
		t.Fatal(err)
	}
	got := rels(l.Media)
	if len(got) != 2 || got[0] != "inside/target.mp3" || got[1] != "real.mp3" {
		t.Fatalf("by default every link is ignored: %v", got)
	}
	if len(l.Sidecar) != 1 || l.Sidecar[0].Rel != "book.cue" || !l.Complete {
		t.Fatalf("sidecars/complete: %+v", l.Sidecar)
	}

	l, err = ingest.Walk(context.Background(), root, true)
	if err != nil {
		t.Fatal(err)
	}
	got = rels(l.Media)
	want := []string{"inside-ln.mp3", "inside/target.mp3", "real.mp3"}
	if len(got) != len(want) {
		t.Fatalf("following links: only a file link that stays inside the root is accepted: %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
	for _, e := range l.Media {
		if e.Rel == "escape.mp3" {
			t.Fatal("a link escaping the root must never be read")
		}
	}
}

func TestCheckRootNeverCreatesTheSentinel(t *testing.T) {
	root := t.TempDir()
	name, sum := "SENTINEL", "0000000000000000000000000000000000000000000000000000000000000000"
	state, _ := ingest.CheckRoot(root, &name, &sum)
	if state != ingest.HealthIdentityMismatch {
		t.Fatalf("missing sentinel: %s", state)
	}
	if _, err := os.Stat(filepath.Join(root, name)); err == nil {
		t.Fatal("the sentinel must never be created automatically")
	}
	esc := "../outside"
	if state, _ := ingest.CheckRoot(root, &esc, &sum); state != ingest.HealthIdentityMismatch {
		t.Fatalf("escaping sentinel: %s", state)
	}
	if state, _ := ingest.CheckRoot(filepath.Join(root, "nope"), nil, nil); state != ingest.HealthUnavailable {
		t.Fatalf("missing root: %s", state)
	}
}
