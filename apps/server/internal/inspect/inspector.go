package inspect

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Config controls the subprocess boundary.
type Config struct {
	// ProbePath is the ffprobe executable (bundled in packaged deployments).
	ProbePath string
	// Timeout bounds a single ffprobe invocation.
	Timeout time.Duration
	// MaxOutputBytes bounds captured stdout; stderr is capped separately.
	MaxOutputBytes int
	// MediaRoot, when set, restricts inspection to paths beneath it.
	MediaRoot string
}

const maxStderrBytes = 16 * 1024

// Inspector runs ffprobe. It is safe for concurrent use; concurrency bounds
// are applied by the job workers, not here.
type Inspector struct {
	cfg Config

	mu      sync.Mutex
	version string
}

func New(cfg Config) *Inspector {
	if cfg.Timeout <= 0 {
		cfg.Timeout = 60 * time.Second
	}
	if cfg.MaxOutputBytes <= 0 {
		cfg.MaxOutputBytes = 8 << 20
	}
	return &Inspector{cfg: cfg}
}

// Version returns the first line of `ffprobe -version`, cached after success.
func (i *Inspector) Version(ctx context.Context) (string, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.version != "" {
		return i.version, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, i.cfg.ProbePath, "-version").Output()
	if err != nil {
		return "", fmt.Errorf("run %s -version: %w", i.cfg.ProbePath, err)
	}
	line, _, _ := strings.Cut(string(out), "\n")
	i.version = strings.TrimSpace(line)
	return i.version, nil
}

// CheckPath validates path and returns its file info, classifying failures.
func (i *Inspector) CheckPath(path string) (os.FileInfo, error) {
	if !filepath.IsAbs(path) {
		return nil, &Error{Outcome: OutcomeMissingInput, Message: "path must be absolute"}
	}
	path = filepath.Clean(path)
	if root := i.cfg.MediaRoot; root != "" {
		rel, err := filepath.Rel(filepath.Clean(root), path)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return nil, &Error{Outcome: OutcomeUnreadableInput, Message: "path is outside the configured media root"}
		}
	}
	fi, err := os.Stat(path)
	if err != nil {
		return nil, classifyFSError(err)
	}
	if fi.IsDir() || !fi.Mode().IsRegular() {
		return nil, &Error{Outcome: OutcomeUnreadableInput, Message: "path is not a regular file"}
	}
	f, err := os.Open(path) // read-only; proves readability, never writes.
	if err != nil {
		return nil, classifyFSError(err)
	}
	_ = f.Close()
	return fi, nil
}

func classifyFSError(err error) error {
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return &Error{Outcome: OutcomeMissingInput, Message: "input file does not exist"}
	case errors.Is(err, fs.ErrPermission):
		return &Error{Outcome: OutcomeUnreadableInput, Message: "input file is not readable"}
	default:
		// Network filesystem hiccups surface here; treat as transient.
		return &Error{Outcome: OutcomeIOError, Retryable: true, Message: "filesystem error: " + sanitize(err.Error())}
	}
}

// Inspect probes path and returns the normalized result.
func (i *Inspector) Inspect(ctx context.Context, path string) (*Result, error) {
	path = filepath.Clean(path)
	fi, err := i.CheckPath(path)
	if err != nil {
		return nil, err
	}
	if ctx.Err() != nil {
		return nil, &Error{Outcome: OutcomeCancelled, Message: "inspection cancelled"}
	}
	version, err := i.Version(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return nil, &Error{Outcome: OutcomeCancelled, Message: "inspection cancelled"}
		}
		return nil, &Error{Outcome: OutcomeToolUnavailable, Retryable: true, Message: sanitize(err.Error())}
	}

	runCtx, cancel := context.WithTimeout(ctx, i.cfg.Timeout)
	defer cancel()

	// Argument array only; no shell. -protocol_whitelist file blocks network
	// protocols, and the file: prefix stops names such as "pipe:0" or
	// "http://..." from being interpreted as URLs.
	args := []string{
		"-v", "error", "-hide_banner",
		"-protocol_whitelist", "file",
		"-print_format", "json",
		"-show_format", "-show_streams", "-show_chapters",
		"-i", "file:" + path,
	}
	cmd := exec.CommandContext(runCtx, i.cfg.ProbePath, args...)
	stdout := &limitedBuffer{max: i.cfg.MaxOutputBytes}
	stderr := &limitedBuffer{max: maxStderrBytes}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.WaitDelay = 2 * time.Second

	runErr := cmd.Run()

	switch {
	case ctx.Err() != nil:
		return nil, &Error{Outcome: OutcomeCancelled, Message: "inspection cancelled"}
	case errors.Is(runCtx.Err(), context.DeadlineExceeded):
		return nil, &Error{Outcome: OutcomeTimeout, Retryable: true, Message: fmt.Sprintf("ffprobe exceeded %s", i.cfg.Timeout)}
	}
	if stdout.truncated {
		return nil, &Error{Outcome: OutcomeOutputLimit, Message: fmt.Sprintf("ffprobe output exceeded %d bytes", i.cfg.MaxOutputBytes)}
	}
	if runErr != nil {
		var pathErr *fs.PathError
		var execErr *exec.Error
		if errors.As(runErr, &execErr) || errors.As(runErr, &pathErr) {
			return nil, &Error{Outcome: OutcomeToolUnavailable, Retryable: true, Message: sanitize(runErr.Error())}
		}
		return nil, classifyStderr(stderr.buf.String(), runErr)
	}

	res, err := Normalize(bytes.TrimSpace(stdout.buf.Bytes()))
	if err != nil {
		return nil, err
	}
	res.Tool = ToolInfo{Name: "ffprobe", Version: version}
	res.Source = SourceInfo{SizeBytes: fi.Size(), ModTimeMs: fi.ModTime().UnixMilli()}
	return res, nil
}

// classifyStderr maps ffprobe's bounded stderr to a distinguishable outcome.
func classifyStderr(stderr string, runErr error) error {
	msg := sanitize(strings.TrimSpace(stderr))
	lower := strings.ToLower(stderr)
	switch {
	case strings.Contains(lower, "invalid data found"),
		strings.Contains(lower, "moov atom not found"),
		strings.Contains(lower, "end of file"),
		strings.Contains(lower, "could not find codec"),
		strings.Contains(lower, "invalid argument"):
		return &Error{Outcome: OutcomeMalformedMedia, Message: msg}
	case strings.Contains(lower, "no such file"):
		return &Error{Outcome: OutcomeMissingInput, Message: msg}
	case strings.Contains(lower, "permission denied"):
		return &Error{Outcome: OutcomeUnreadableInput, Message: msg}
	case strings.Contains(lower, "input/output error"), strings.Contains(lower, "stale file handle"):
		return &Error{Outcome: OutcomeIOError, Retryable: true, Message: msg}
	}
	if msg == "" {
		msg = sanitize(runErr.Error())
	}
	return &Error{Outcome: OutcomeToolFailure, Retryable: true, Message: msg}
}

// sanitize bounds a message and strips control characters so persisted
// failure text stays small and log-safe.
func sanitize(s string) string {
	const max = 512
	s = strings.Map(func(r rune) rune {
		if r < 0x20 && r != ' ' {
			return ' '
		}
		return r
	}, s)
	if len(s) > max {
		s = s[:max] + "..."
	}
	return s
}
