// Package ingest discovers files under a library root, keeps stable file
// identities across moves and replacements, and groups audio files into
// recordings (T004; ADR-0044/0045/0050/0055/0058/0059/0061). Nothing here
// deletes catalog rows or touches source bytes.
package ingest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// mediaTypes lists recognized, cataloged file types (ADR-0025). Recognition is
// not full support; capability states live elsewhere.
var mediaTypes = map[string]string{
	".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".m4b": "audio/mp4", ".aac": "audio/aac",
	".flac": "audio/flac", ".ogg": "audio/ogg", ".opus": "audio/opus", ".wav": "audio/wav",
	".epub": "application/epub+zip", ".pdf": "application/pdf", ".cbz": "application/vnd.comicbook+zip",
}

// sidecarExts are associated, not cataloged as media (ADR-0055).
var sidecarExts = map[string]string{".cue": "cue", ".json": "json", ".opf": "opf"}

// Entry is one regular file found under the root.
type Entry struct {
	Rel   string // slash-separated, relative to the canonical root
	Abs   string
	Size  int64
	Mtime time.Time
	Mime  string // empty for sidecars
	Side  string // cue/json/opf for sidecars
}

// Listing is the result of walking a root.
type Listing struct {
	Root    string // canonical root
	Media   []Entry
	Sidecar []Entry
	// Complete is false when any directory could not be read; absence must not
	// be inferred from an incomplete listing.
	Complete bool
	Skipped  int // symlinks and unsupported entries ignored
}

// CanonicalRoot resolves symlinks in the configured root so containment checks
// compare real paths (ADR-0059).
func CanonicalRoot(root string) (string, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(abs)
}

// within reports whether p is root or beneath it.
func within(root, p string) bool {
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func micro(t time.Time) time.Time { return t.UTC().Truncate(time.Microsecond) }

// Walk lists supported files beneath the canonical root. Symlinks are ignored
// unless follow is set, and a followed file link must resolve inside the root.
// Linked directories are never traversed.
func Walk(ctx context.Context, root string, follow bool) (*Listing, error) {
	canon, err := CanonicalRoot(root)
	if err != nil {
		return nil, err
	}
	l := &Listing{Root: canon, Complete: true}
	err = filepath.WalkDir(canon, func(p string, d fs.DirEntry, werr error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if werr != nil {
			if p == canon {
				return werr
			}
			l.Complete = false // unreadable subtree: do not infer absence
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		target := p
		if d.Type()&fs.ModeSymlink != 0 {
			if !follow {
				l.Skipped++
				return nil
			}
			resolved, rerr := filepath.EvalSymlinks(p)
			if rerr != nil || !within(canon, resolved) {
				l.Skipped++
				return nil
			}
			target = resolved
		}
		info, serr := os.Stat(target)
		if serr != nil || !info.Mode().IsRegular() {
			if serr != nil {
				l.Complete = false
			}
			l.Skipped++
			return nil
		}
		rel, rerr := filepath.Rel(canon, p)
		if rerr != nil {
			return rerr
		}
		e := Entry{Rel: filepath.ToSlash(rel), Abs: p, Size: info.Size(), Mtime: micro(info.ModTime())}
		ext := strings.ToLower(filepath.Ext(p))
		if m, ok := mediaTypes[ext]; ok {
			e.Mime = m
			l.Media = append(l.Media, e)
		} else if k, ok := sidecarExts[ext]; ok {
			e.Side = k
			l.Sidecar = append(l.Sidecar, e)
		} else {
			l.Skipped++
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return l, nil
}

// HashFile streams a SHA-256 of the whole file and returns the size read.
func HashFile(ctx context.Context, path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	buf := make([]byte, 1<<20)
	var n int64
	for {
		if err := ctx.Err(); err != nil {
			return "", 0, err
		}
		k, rerr := f.Read(buf)
		if k > 0 {
			h.Write(buf[:k])
			n += int64(k)
		}
		if errors.Is(rerr, io.EOF) {
			break
		}
		if rerr != nil {
			return "", 0, rerr
		}
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

// Root health states (ADR-0050/0059).
const (
	HealthHealthy          = "healthy"
	HealthUnavailable      = "unavailable"
	HealthIdentityMismatch = "identity_mismatch"
)

// CheckRoot validates the root directory and, when configured, the
// operator-supplied identity sentinel. It never creates a marker file.
func CheckRoot(root string, sentinelPath, sentinelSHA *string) (state, detail string) {
	info, err := os.Stat(root)
	if err != nil {
		return HealthUnavailable, "root is not accessible"
	}
	if !info.IsDir() {
		return HealthUnavailable, "root is not a directory"
	}
	if sentinelPath == nil {
		return HealthHealthy, ""
	}
	canon, err := CanonicalRoot(root)
	if err != nil {
		return HealthUnavailable, "root is not accessible"
	}
	full := filepath.Join(canon, filepath.FromSlash(*sentinelPath))
	if !within(canon, full) {
		return HealthIdentityMismatch, "sentinel path escapes the root"
	}
	sum, _, err := HashFile(context.Background(), full)
	if err != nil {
		return HealthIdentityMismatch, "identity sentinel not found"
	}
	if sentinelSHA == nil || !strings.EqualFold(sum, *sentinelSHA) {
		return HealthIdentityMismatch, "identity sentinel does not match"
	}
	return HealthHealthy, ""
}

func (e Entry) String() string { return fmt.Sprintf("%s(%d)", e.Rel, e.Size) }
