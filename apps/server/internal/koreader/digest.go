// Package koreader implements the stock KOReader progress-sync adapter
// (ADR-0075, ADR-0076): a separate position source keyed to exact catalog file
// versions, per-device baselines, immutable payload receipts and retained
// candidates. The document digest is only a lookup hint, never an identity.
package koreader

import (
	"context"
	"crypto/md5" //nolint:gosec // KOReader's document digest is MD5 by protocol definition; it is a lookup hint.
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/media"
)

const (
	sampleSize = 1024
	maxSamples = 12 // offset zero plus 1024*4^i for i = 0..10
	indexBatch = 25
)

// PartialMD5 is KOReader's binary partial-content digest: up to 1024 bytes at
// offset zero, then up to 1024 bytes at offsets 1024*4^i for i = 0..10,
// stopping at the first offset at or past EOF. Only these bounded samples are
// read, so a sparse multi-gigabyte file costs 12 small reads.
func PartialMD5(r io.ReaderAt, size int64) (string, error) {
	h := md5.New() //nolint:gosec
	offsets := make([]int64, 0, maxSamples)
	offsets = append(offsets, 0)
	for i := 0; i <= 10; i++ {
		offsets = append(offsets, int64(sampleSize)<<(2*uint(i)))
	}
	buf := make([]byte, sampleSize)
	for _, off := range offsets {
		if off >= size {
			break
		}
		n := int64(sampleSize)
		if size-off < n {
			n = size - off
		}
		got, err := r.ReadAt(buf[:n], off)
		if int64(got) != n {
			if err == nil {
				err = io.ErrUnexpectedEOF
			}
			return "", err
		}
		h.Write(buf[:n])
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Indexer computes digests for current ebook/comic file versions through a
// bounded job. It never runs on an HTTP request path.
type Indexer struct {
	Pool      *pgxpool.Pool
	MediaRoot string
	Log       *slog.Logger
}

// IndexPending indexes up to limit unindexed current files and returns how many
// were recorded. A file that cannot be read stays unindexed (an honest
// not-ready state) and is retried on a later pass; random order keeps one bad
// file from starving the rest.
func (ix *Indexer) IndexPending(ctx context.Context, limit int) (int, error) {
	if limit <= 0 || limit > 500 {
		limit = indexBatch
	}
	q := sqlcgen.New(ix.Pool)
	rows, err := q.ListUnindexedFiles(ctx, int32(limit))
	if err != nil {
		return 0, err
	}
	done := 0
	for _, r := range rows {
		if ctx.Err() != nil {
			return done, ctx.Err()
		}
		if r.SizeBytes == nil {
			continue
		}
		digest, err := ix.digestOf(r.Locator, *r.SizeBytes)
		if err != nil {
			if ix.Log != nil {
				ix.Log.Warn("koreader digest unavailable", "file_id", r.FileID, "error", errors.Unwrap(err))
			}
			continue
		}
		// The version must still be the current one; otherwise the digest would index replaced bytes.
		fv, err := q.GetFileVersion(ctx, sqlcgen.GetFileVersionParams{ContentVersion: r.ContentVersion, FileID: r.FileID})
		if err != nil || !fv.Current || !fv.Available {
			continue
		}
		if err := q.InsertDigest(ctx, sqlcgen.InsertDigestParams{FileID: r.FileID, ContentVersion: r.ContentVersion, Digest: digest}); err != nil {
			return done, err
		}
		done++
	}
	return done, nil
}

// digestOf reads the samples and confirms the file did not change underneath
// the read (size and modification time before and after).
func (ix *Indexer) digestOf(locator string, size int64) (string, error) {
	f, err := media.Open(ix.MediaRoot, locator, size)
	if err != nil {
		return "", fmt.Errorf("open: %w", err)
	}
	defer f.Close()
	before, err := f.Stat()
	if err != nil {
		return "", err
	}
	d, err := PartialMD5(f, size)
	if err != nil {
		return "", fmt.Errorf("read: %w", err)
	}
	after, err := os.Stat(f.Name())
	if err != nil || after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) {
		return "", errors.New("file changed while hashing")
	}
	return d, nil
}
