package config

import (
	"bufio"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
)

// EnvFileVariable names a different file to read instead of ".env" in the working directory.
const EnvFileVariable = "LITARA_ENV_FILE"

// LoadEnvFile reads KEY=VALUE lines from the file at path into the process environment, for local development and
// small installs where tokens live in a file the operator keeps out of Git. A variable already present in the real
// environment always wins, so a deployment's own settings are never overridden by a stray file. A missing file is not an
// error (it returns an empty list); it returns the names it set, never their values.
//
// Accepted syntax: blank lines and "#" comments are skipped; an optional leading "export "; a value may be wrapped in
// matching single or double quotes; an unquoted value ends at a " #" comment. There is no variable expansion.
func LoadEnvFile(path string) ([]string, error) {
	f, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var set []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for n := 1; sc.Scan(); n++ {
		line := strings.TrimSpace(strings.TrimPrefix(sc.Text(), string(rune(0xFEFF))))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		name, value, ok := strings.Cut(line, "=")
		name = strings.TrimSpace(name)
		if !ok || !validEnvName(name) {
			return set, fmt.Errorf("%s line %d: expected NAME=value", path, n)
		}
		value = envValue(strings.TrimSpace(value))
		if _, exists := os.LookupEnv(name); exists {
			continue
		}
		if err := os.Setenv(name, value); err != nil {
			return set, err
		}
		set = append(set, name)
	}
	return set, sc.Err()
}

func validEnvName(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		switch {
		case r == '_', r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9' && i > 0:
		default:
			return false
		}
	}
	return true
}

func envValue(v string) string {
	if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') {
		if end := strings.IndexByte(v[1:], v[0]); end >= 0 {
			return v[1 : 1+end]
		}
	}
	if i := strings.Index(v, " #"); i >= 0 {
		v = v[:i]
	}
	return strings.TrimSpace(v)
}
