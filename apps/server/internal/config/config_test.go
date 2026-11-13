package config

import (
	"strings"
	"testing"
	"time"
)

func env(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
}

func TestDefaultsAndRequiredDatabase(t *testing.T) {
	_, err := loadFrom(env(nil))
	if err == nil || !strings.Contains(err.Error(), "LITARA_DATABASE_URL is required") {
		t.Fatalf("want actionable missing-url error, got %v", err)
	}
	c, err := loadFrom(env(map[string]string{"LITARA_DATABASE_URL": "postgres://u:secret@h/db"}))
	if err != nil {
		t.Fatal(err)
	}
	if c.InspectWorkers != 2 || c.InspectTimeout != time.Minute || c.HTTPAddr != "127.0.0.1:8080" {
		t.Fatalf("%+v", c)
	}
}

func TestAllErrorsReportedAndNoSecretLeak(t *testing.T) {
	_, err := loadFrom(env(map[string]string{
		"LITARA_DATABASE_URL":       "mysql://u:hunter2@h/db",
		"LITARA_INSPECT_WORKERS":    "many",
		"LITARA_INSPECT_TIMEOUT":    "soon",
		"LITARA_LOG_LEVEL":          "loud",
		"LITARA_RESCUE_STUCK_AFTER": "1s",
	}))
	if err == nil {
		t.Fatal("expected errors")
	}
	msg := err.Error()
	for _, want := range []string{"DATABASE_URL must be a postgres", "INSPECT_WORKERS must be an integer", "INSPECT_TIMEOUT must be a duration", "LOG_LEVEL"} {
		if !strings.Contains(msg, want) {
			t.Errorf("missing %q in:\n%s", want, msg)
		}
	}
	if strings.Contains(msg, "hunter2") {
		t.Fatal("error leaks the database password")
	}
}

func TestRescueMustExceedTimeout(t *testing.T) {
	_, err := loadFrom(env(map[string]string{
		"LITARA_DATABASE_URL": "postgres://h/db", "LITARA_INSPECT_TIMEOUT": "10m", "LITARA_RESCUE_STUCK_AFTER": "5m",
	}))
	if err == nil || !strings.Contains(err.Error(), "RESCUE_STUCK_AFTER") {
		t.Fatalf("got %v", err)
	}
}
