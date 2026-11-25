package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadEnvFileReadsValuesAndNeverOverridesTheRealEnvironment(t *testing.T) {
	t.Setenv("DOTENV_TEST_KEPT", "from-environment")
	for _, n := range []string{"DOTENV_TEST_PLAIN", "DOTENV_TEST_QUOTED", "DOTENV_TEST_SINGLE", "DOTENV_TEST_EXPORT", "DOTENV_TEST_COMMENT", "DOTENV_TEST_EMPTY"} {
		t.Setenv(n, "")
		os.Unsetenv(n)
	}
	path := filepath.Join(t.TempDir(), ".env")
	body := string(rune(0xFEFF)) + "# a comment\n\nDOTENV_TEST_PLAIN=abc123\nDOTENV_TEST_QUOTED=\"two words # not a comment\"\nDOTENV_TEST_SINGLE='x y'\n" +
		"export DOTENV_TEST_EXPORT = spaced \nDOTENV_TEST_COMMENT=value # trailing\nDOTENV_TEST_KEPT=from-file\nDOTENV_TEST_EMPTY=\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	set, err := LoadEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"DOTENV_TEST_PLAIN": "abc123", "DOTENV_TEST_QUOTED": "two words # not a comment", "DOTENV_TEST_SINGLE": "x y",
		"DOTENV_TEST_EXPORT": "spaced", "DOTENV_TEST_COMMENT": "value", "DOTENV_TEST_KEPT": "from-environment", "DOTENV_TEST_EMPTY": "",
	}
	for k, v := range want {
		if got := os.Getenv(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
	if len(set) == 0 || contains(set, "DOTENV_TEST_KEPT") {
		t.Fatalf("a variable already set must not be reported or replaced: %v", set)
	}
}

func TestLoadEnvFileMissingIsFineAndBadLinesAreRefusedWithoutEchoingValues(t *testing.T) {
	if set, err := LoadEnvFile(filepath.Join(t.TempDir(), "absent")); err != nil || set != nil {
		t.Fatalf("a missing file is not an error: %v %v", set, err)
	}
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte("this is not valid secret-value\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadEnvFile(path)
	if err == nil {
		t.Fatal("a line without NAME=value must be refused")
	}
	if msg := err.Error(); indexOf(msg, "secret-value") >= 0 {
		t.Fatalf("the error must not echo file content: %q", msg)
	}
}

func contains(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
