// Package config loads typed, validated configuration from the environment.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the complete runtime configuration. It deliberately has no
// String method that prints the database URL, because that contains a password.
type Config struct {
	DatabaseURL string
	HTTPAddr    string
	LogLevel    slog.Level

	FFprobePath string
	FFmpegPath  string
	// MediaRoot restricts which files may be inspected. Empty means any
	// absolute local path (development only).
	MediaRoot string

	InspectWorkers     int
	InspectTimeout     time.Duration
	InspectMaxAttempts int
	MaxProbeOutput     int
	// RescueStuckAfter is how long a job may stay "running" before River
	// reclaims it (covers a crashed process).
	RescueStuckAfter time.Duration
	ShutdownTimeout  time.Duration

	// SecretKey (base64, 32 bytes) protects the 60-second recoverable refresh
	// response. Required by the server, not by migrations.
	SecretKey string
	// PublicPrefix is the reverse-proxy mount prefix, for example /litara.
	PublicPrefix string
	// AllowedOrigins are extra exact browser origins for cookie sessions.
	AllowedOrigins []string
	// DevInsecureHTTP is the explicit development-only plain-HTTP cookie mode.
	DevInsecureHTTP bool
	// Argon2id work factors for password hashing.
	ArgonMemoryKiB uint32
	ArgonTime      uint32
	ArgonThreads   uint8
	// GoogleBooksAPIKey is optional and local; it is only sent to Google Books for libraries that enable it.
	GoogleBooksAPIKey string
	// ScanWorkers bounds concurrent library scans.
	ScanWorkers int
}

const prefix = "LITARA_"

// ToolPaths returns the configured ffprobe and ffmpeg paths without requiring
// the rest of the configuration (used by `ctl tools`).
func ToolPaths() (ffprobe, ffmpeg string) {
	ffprobe, ffmpeg = "ffprobe", "ffmpeg"
	if v := strings.TrimSpace(os.Getenv(prefix + "FFPROBE_PATH")); v != "" {
		ffprobe = v
	}
	if v := strings.TrimSpace(os.Getenv(prefix + "FFMPEG_PATH")); v != "" {
		ffmpeg = v
	}
	return ffprobe, ffmpeg
}

// Load reads configuration from the process environment.
func Load() (*Config, error) { return loadFrom(os.LookupEnv) }

func loadFrom(lookup func(string) (string, bool)) (*Config, error) {
	var errs []error
	get := func(key, def string) string {
		if v, ok := lookup(prefix + key); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
		return def
	}
	getInt := func(key string, def int) int {
		v := get(key, "")
		if v == "" {
			return def
		}
		n, err := strconv.Atoi(v)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s%s must be an integer, got %q", prefix, key, v))
			return def
		}
		return n
	}
	getDur := func(key string, def time.Duration) time.Duration {
		v := get(key, "")
		if v == "" {
			return def
		}
		d, err := time.ParseDuration(v)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s%s must be a duration such as 30s, got %q", prefix, key, v))
			return def
		}
		return d
	}

	c := &Config{
		DatabaseURL:        get("DATABASE_URL", ""),
		HTTPAddr:           get("HTTP_ADDR", "127.0.0.1:8080"),
		FFprobePath:        get("FFPROBE_PATH", "ffprobe"),
		FFmpegPath:         get("FFMPEG_PATH", "ffmpeg"),
		MediaRoot:          get("MEDIA_ROOT", ""),
		InspectWorkers:     getInt("INSPECT_WORKERS", 2),
		InspectTimeout:     getDur("INSPECT_TIMEOUT", 60*time.Second),
		InspectMaxAttempts: getInt("INSPECT_MAX_ATTEMPTS", 4),
		MaxProbeOutput:     getInt("MAX_PROBE_OUTPUT_BYTES", 8<<20),
		RescueStuckAfter:   getDur("RESCUE_STUCK_AFTER", 5*time.Minute),
		ShutdownTimeout:    getDur("SHUTDOWN_TIMEOUT", 30*time.Second),
		SecretKey:          get("SECRET_KEY", ""),
		PublicPrefix:       strings.TrimRight(get("PUBLIC_PATH_PREFIX", ""), "/"),
		DevInsecureHTTP:    get("DEV_INSECURE_HTTP", "") == "1",
		ArgonMemoryKiB:     uint32(getInt("ARGON2_MEMORY_KIB", 64*1024)),
		ArgonTime:          uint32(getInt("ARGON2_TIME", 3)),
		ArgonThreads:       uint8(getInt("ARGON2_THREADS", 2)),
		GoogleBooksAPIKey:  get("GOOGLE_BOOKS_API_KEY", ""),
		ScanWorkers:        getInt("SCAN_WORKERS", 2),
	}
	for _, o := range strings.Split(get("ALLOWED_ORIGINS", ""), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.AllowedOrigins = append(c.AllowedOrigins, o)
		}
	}
	if c.PublicPrefix != "" && !strings.HasPrefix(c.PublicPrefix, "/") {
		errs = append(errs, fmt.Errorf("%sPUBLIC_PATH_PREFIX must start with /", prefix))
	}
	if c.ArgonMemoryKiB < 8 || c.ArgonTime < 1 || c.ArgonThreads < 1 {
		errs = append(errs, fmt.Errorf("%sARGON2_* values must be positive (memory at least 8 KiB)", prefix))
	}

	if err := c.LogLevel.UnmarshalText([]byte(get("LOG_LEVEL", "info"))); err != nil {
		errs = append(errs, fmt.Errorf("%sLOG_LEVEL must be debug, info, warn or error", prefix))
	}
	if c.DatabaseURL == "" {
		errs = append(errs, fmt.Errorf("%sDATABASE_URL is required (for example postgres://user:pass@host:5432/db?sslmode=disable)", prefix))
	} else if u, err := url.Parse(c.DatabaseURL); err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		errs = append(errs, fmt.Errorf("%sDATABASE_URL must be a postgres:// URL", prefix))
	}
	if c.InspectWorkers < 1 || c.InspectWorkers > 64 {
		errs = append(errs, fmt.Errorf("%sINSPECT_WORKERS must be between 1 and 64", prefix))
	}
	if c.InspectMaxAttempts < 1 {
		errs = append(errs, fmt.Errorf("%sINSPECT_MAX_ATTEMPTS must be at least 1", prefix))
	}
	if c.InspectTimeout <= 0 {
		errs = append(errs, fmt.Errorf("%sINSPECT_TIMEOUT must be positive", prefix))
	}
	if c.RescueStuckAfter < c.InspectTimeout+30*time.Second {
		errs = append(errs, fmt.Errorf("%sRESCUE_STUCK_AFTER (%s) must be at least INSPECT_TIMEOUT + 30s so live jobs are never rescued", prefix, c.RescueStuckAfter))
	}
	if c.MaxProbeOutput < 1024 {
		errs = append(errs, fmt.Errorf("%sMAX_PROBE_OUTPUT_BYTES must be at least 1024", prefix))
	}
	return c, errors.Join(errs...)
}
