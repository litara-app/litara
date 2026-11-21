package apicompat

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

//go:embed snapshots
var embedded embed.FS

// Snapshots is the committed API record (state, baseline, released snapshots, ledger, waivers) built into the binary.
func Snapshots() fs.FS {
	sub, err := fs.Sub(embedded, "snapshots")
	if err != nil {
		panic(err)
	}
	return sub
}

// State is the one record of where the API stands. The OpenAPI info.version, the version discovery reports and the release
// ledger must all agree with it.
type State struct {
	// Stability is "development" until the first release, then "stable".
	Stability string `json:"stability"`
	// Version is the full API version: "1.0.0-development" while in development, "1.2.0" after a release.
	Version string `json:"version"`
}

// Release is one frozen API version in the ledger.
type Release struct {
	Version string `json:"version"`
	File    string `json:"file"`
	SHA256  string `json:"sha256"`
}

// Ledger lists every released snapshot, oldest first. A snapshot file is never edited or removed.
type Ledger struct {
	Releases []Release `json:"releases"`
}

// Waiver permits one named breaking change while the API is still in development. It is consumed when the baseline is updated.
type Waiver struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

type waivers struct {
	Waivers []Waiver `json:"waivers"`
}

const (
	stateFile    = "state.json"
	baselineFile = "baseline.openapi.json"
	ledgerFile   = "ledger.json"
	waiversFile  = "waivers.json"
	historyDir   = "history"
)

var (
	devVersionRe = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)-development$`)
	relVersionRe = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)$`)
)

// ParseState reads the state from a snapshot directory.
func ReadState(fsys fs.FS) (State, error) {
	var s State
	b, err := fs.ReadFile(fsys, stateFile)
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(b, &s); err != nil {
		return s, fmt.Errorf("%s: %w", stateFile, err)
	}
	return s, nil
}

// Current is the state built into this binary.
func Current() State {
	s, err := ReadState(Snapshots())
	if err != nil {
		panic("apicompat: " + err.Error())
	}
	return s
}

func readJSON(fsys fs.FS, name string, into any) error {
	b, err := fs.ReadFile(fsys, name)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, into)
}

func sum(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

type semver struct{ major, minor, patch int }

func parseVersion(v string) (semver, bool) {
	m := relVersionRe.FindStringSubmatch(v)
	if m == nil {
		m = devVersionRe.FindStringSubmatch(v)
	}
	if m == nil {
		return semver{}, false
	}
	n := func(s string) int { i, _ := strconv.Atoi(s); return i }
	return semver{n(m[1]), n(m[2]), n(m[3])}, true
}

func (a semver) less(b semver) bool {
	if a.major != b.major {
		return a.major < b.major
	}
	if a.minor != b.minor {
		return a.minor < b.minor
	}
	return a.patch < b.patch
}

// Verify checks the current OpenAPI document against everything the repository has promised, and returns every problem. An
// empty result means the API is compatible with its baseline and with every released snapshot, and that the record is
// consistent. It never writes.
func Verify(fsys fs.FS, current []byte) []string {
	var problems []string
	bad := func(format string, a ...any) { problems = append(problems, fmt.Sprintf(format, a...)) }

	st, err := ReadState(fsys)
	if err != nil {
		return []string{"cannot read the API state: " + err.Error()}
	}
	var led Ledger
	if err := readJSON(fsys, ledgerFile, &led); err != nil {
		return []string{"cannot read the release ledger: " + err.Error()}
	}
	var wv waivers
	if err := readJSON(fsys, waiversFile, &wv); err != nil {
		return []string{"cannot read the waivers: " + err.Error()}
	}

	// The record itself.
	switch st.Stability {
	case "development":
		if _, ok := parseVersion(st.Version); !ok || !devVersionRe.MatchString(st.Version) {
			bad("state version %q must look like 1.0.0-development while the API is in development", st.Version)
		}
		if len(led.Releases) > 0 {
			bad("the API is marked development but %d release(s) are in the ledger", len(led.Releases))
		}
	case "stable":
		if len(led.Releases) == 0 {
			bad("the API is marked stable but nothing has been released")
		} else if last := led.Releases[len(led.Releases)-1]; last.Version != st.Version {
			bad("state version %q is not the latest released version %q", st.Version, last.Version)
		}
		if len(wv.Waivers) > 0 {
			bad("waivers are not allowed once the API is stable (%d present)", len(wv.Waivers))
		}
	default:
		bad("state stability %q must be development or stable", st.Stability)
	}

	var cur struct {
		Info struct {
			Version string `json:"version"`
		} `json:"info"`
	}
	if err := json.Unmarshal(current, &cur); err != nil {
		return append(problems, "the generated OpenAPI is not valid JSON: "+err.Error())
	}
	if cur.Info.Version != st.Version {
		bad("the generated OpenAPI info.version %q does not match the recorded API version %q", cur.Info.Version, st.Version)
	}

	// Every released snapshot is immutable and must still be honoured.
	prev := semver{}
	snapshots := map[string][]byte{}
	for _, r := range led.Releases {
		v, ok := parseVersion(r.Version)
		if !ok || !relVersionRe.MatchString(r.Version) {
			bad("ledger version %q is not a release version", r.Version)
			continue
		}
		if v.major != 1 {
			bad("ledger version %q: only major version 1 is served at /api/v1", r.Version)
		}
		if !prev.less(v) {
			bad("ledger versions must increase: %q", r.Version)
		}
		prev = v
		b, err := fs.ReadFile(fsys, r.File)
		if err != nil {
			bad("released snapshot %s is missing: %v", r.File, err)
			continue
		}
		if sum(b) != r.SHA256 {
			bad("released snapshot %s was changed after release (its hash no longer matches the ledger)", r.File)
			continue
		}
		snapshots[r.Version] = b
		changes, err := Diff(b, current)
		if err != nil {
			bad("compare with %s: %v", r.File, err)
			continue
		}
		for _, c := range Breaks(changes) {
			bad("BREAKS released API %s: %s", r.Version, c)
		}
	}

	// Development: the working baseline. Stable: the latest released snapshot, which the surface must equal.
	switch st.Stability {
	case "development":
		base, err := fs.ReadFile(fsys, baselineFile)
		if err != nil {
			bad("cannot read %s: %v", baselineFile, err)
			break
		}
		changes, err := Diff(base, current)
		if err != nil {
			bad("compare with the baseline: %v", err)
			break
		}
		waived := map[string]bool{}
		for _, w := range wv.Waivers {
			waived[w.ID] = true
		}
		used := map[string]bool{}
		for _, c := range Breaks(changes) {
			if waived[c.ID()] {
				used[c.ID()] = true
				continue
			}
			bad("BREAKING API change: %s. Revert it, or (development only) record a waiver with a reason in %s", c, waiversFile)
		}
		for _, w := range wv.Waivers {
			if strings.TrimSpace(w.Reason) == "" {
				bad("waiver %q has no reason", w.ID)
			}
			if !used[w.ID] {
				bad("waiver %q does not match any current breaking change; remove it", w.ID)
			}
		}
		if len(changes) > 0 && len(problems) == 0 {
			bad("the API surface changed since the baseline (%d change(s), e.g. %s). Run: go run ./cmd/ctl api-baseline update", len(changes), changes[0])
		}
	case "stable":
		if len(led.Releases) > 0 {
			last := led.Releases[len(led.Releases)-1]
			if b, ok := snapshots[last.Version]; ok {
				changes, err := Diff(b, current)
				if err == nil && len(changes) > 0 && len(Breaks(changes)) == 0 {
					bad("the API surface grew after release %s (e.g. %s). Release the addition as a new minor version: go run ./cmd/ctl api-baseline release <version>", last.Version, changes[0])
				}
			}
		}
	}
	return problems
}

// ---- writing: used by the ctl command, never by the server ---------------------------------------------------------------

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0o644)
}

func pretty(doc []byte) ([]byte, error) {
	var buf bytes.Buffer
	if err := json.Indent(&buf, doc, "", "  "); err != nil {
		return nil, err
	}
	buf.WriteByte('\n')
	return buf.Bytes(), nil
}

// Update accepts the current API as the new development baseline. It refuses a breaking change unless a waiver names it, and
// records each consumed waiver in history/waived.json so there is a lasting audit trail.
func Update(dir string, current []byte) ([]Change, error) {
	fsys := os.DirFS(dir)
	st, err := ReadState(fsys)
	if err != nil {
		return nil, err
	}
	if st.Stability != "development" {
		return nil, errors.New("the API is stable: its baseline is the latest release and cannot be updated; use `release` for an additive change")
	}
	base, err := os.ReadFile(filepath.Join(dir, baselineFile))
	if err != nil {
		return nil, err
	}
	var wv waivers
	if err := readJSON(fsys, waiversFile, &wv); err != nil {
		return nil, err
	}
	changes, err := Diff(base, current)
	if err != nil {
		return nil, err
	}
	waived := map[string]Waiver{}
	for _, w := range wv.Waivers {
		if strings.TrimSpace(w.Reason) == "" {
			return nil, fmt.Errorf("waiver %q has no reason", w.ID)
		}
		waived[w.ID] = w
	}
	var consumed []Waiver
	for _, c := range Breaks(changes) {
		w, ok := waived[c.ID()]
		if !ok {
			return changes, fmt.Errorf("refusing: %s is a breaking change. Third-party clients depend on the current shape; add a waiver with a reason to %s only if nothing has been released", c, waiversFile)
		}
		consumed = append(consumed, w)
	}
	out, err := pretty(current)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, baselineFile), out, 0o644); err != nil {
		return nil, err
	}
	if len(consumed) > 0 {
		var hist struct {
			Waived []Waiver `json:"waived"`
		}
		p := filepath.Join(dir, historyDir, "waived.json")
		if b, err := os.ReadFile(p); err == nil {
			_ = json.Unmarshal(b, &hist)
		}
		hist.Waived = append(hist.Waived, consumed...)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return nil, err
		}
		if err := writeJSON(p, hist); err != nil {
			return nil, err
		}
	}
	return changes, writeJSON(filepath.Join(dir, waiversFile), waivers{Waivers: []Waiver{}})
}

// ReleaseVersion freezes the current API as an immutable snapshot at version, which must be a plain release version greater than
// the last. The first release ends the development period. After it, only additive change is possible, and only through
// another release.
func ReleaseVersion(dir string, current []byte, version string) ([]Change, error) {
	fsys := os.DirFS(dir)
	st, err := ReadState(fsys)
	if err != nil {
		return nil, err
	}
	v, ok := parseVersion(version)
	if !ok || !relVersionRe.MatchString(version) || v.major != 1 {
		return nil, fmt.Errorf("%q is not a release version of the form 1.MINOR.PATCH", version)
	}
	var led Ledger
	if err := readJSON(fsys, ledgerFile, &led); err != nil {
		return nil, err
	}
	var changes []Change
	if n := len(led.Releases); n > 0 {
		last := led.Releases[n-1]
		lv, _ := parseVersion(last.Version)
		if !lv.less(v) {
			return nil, fmt.Errorf("version %s must be greater than the last release %s", version, last.Version)
		}
		prevDoc, err := os.ReadFile(filepath.Join(dir, last.File))
		if err != nil {
			return nil, err
		}
		if changes, err = Diff(prevDoc, current); err != nil {
			return nil, err
		}
		if b := Breaks(changes); len(b) > 0 {
			return changes, fmt.Errorf("refusing: the API breaks release %s (%s); a breaking change needs a new major version served beside this one", last.Version, b[0])
		}
		if len(changes) > 0 && v.minor <= lv.minor {
			return changes, fmt.Errorf("the API gained %d addition(s) since %s, so the minor version must increase (not %s)", len(changes), last.Version, version)
		}
		if len(changes) == 0 && v.minor != lv.minor {
			return changes, errors.New("nothing was added; only the patch version may increase")
		}
	} else {
		if st.Stability != "development" {
			return nil, errors.New("inconsistent record: stable with no releases")
		}
		// Anything still waived or not yet baselined must be settled before the first freeze.
		if problems := Verify(fsys, current); len(problems) > 0 {
			return nil, fmt.Errorf("fix these before the first release:\n  %s", strings.Join(problems, "\n  "))
		}
	}

	var doc map[string]any
	if err := json.Unmarshal(current, &doc); err != nil {
		return nil, err
	}
	info, _ := doc["info"].(map[string]any)
	if info == nil {
		return nil, errors.New("the OpenAPI document has no info object")
	}
	info["version"] = version
	frozen, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	out, err := pretty(frozen)
	if err != nil {
		return nil, err
	}
	rel := historyDir + "/" + version + ".openapi.json"
	if err := os.MkdirAll(filepath.Join(dir, historyDir), 0o755); err != nil {
		return nil, err
	}
	if _, err := os.Stat(filepath.Join(dir, rel)); err == nil {
		return nil, fmt.Errorf("%s already exists; released snapshots are never overwritten", rel)
	}
	if err := os.WriteFile(filepath.Join(dir, rel), out, 0o644); err != nil {
		return nil, err
	}
	led.Releases = append(led.Releases, Release{Version: version, File: rel, SHA256: sum(out)})
	sort.SliceStable(led.Releases, func(i, j int) bool {
		a, _ := parseVersion(led.Releases[i].Version)
		b, _ := parseVersion(led.Releases[j].Version)
		return a.less(b)
	})
	if err := writeJSON(filepath.Join(dir, ledgerFile), led); err != nil {
		return nil, err
	}
	if err := writeJSON(filepath.Join(dir, stateFile), State{Stability: "stable", Version: version}); err != nil {
		return nil, err
	}
	_ = os.Remove(filepath.Join(dir, baselineFile))
	return changes, writeJSON(filepath.Join(dir, waiversFile), waivers{Waivers: []Waiver{}})
}
