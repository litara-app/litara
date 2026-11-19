package writeback

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

// Each writer edits its container's title tag without remuxing. The rest of
// the input is copied byte-for-byte, including opaque tags and media payloads.
type audioWriter struct{ format string }

const maxAudioMetadata = 32 << 20

func BuiltInWriters() map[string]Writer {
	return map[string]Writer{
		"epub": EPUBWriter{},
		"mp3":  audioWriter{"mp3"}, "flac": audioWriter{"flac"},
		"m4a": audioWriter{"m4a"}, "m4b": audioWriter{"m4b"},
	}
}

func (w audioWriter) Format() string { return w.format }

func audioTitle(changes metadata.Fields) (string, error) {
	var title string
	if len(changes) != 1 || json.Unmarshal(changes[metadata.FieldTitle], &title) != nil ||
		strings.TrimSpace(title) == "" || strings.ContainsRune(title, 0) || len(title) > 64<<10 {
		return "", errors.New("this audio writer accepts only a nonempty title up to 64 KiB")
	}
	return title, nil
}

func (w audioWriter) ValidateFields(changes metadata.Fields) error {
	_, err := audioTitle(changes)
	return err
}

type audioEdit struct {
	start, end  int64
	replacement []byte
	suffix      []byte
}

func (w audioWriter) rewrite(ctx context.Context, src string, out io.Writer, changes metadata.Fields) error {
	title, err := audioTitle(changes)
	if err != nil {
		return err
	}
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return err
	}
	size := stat.Size()
	var edit audioEdit
	switch w.format {
	case "mp3":
		edit, err = editID3(f, size, title)
	case "flac":
		edit, err = editFLAC(f, size, title)
	case "m4a", "m4b":
		edit, err = editMP4(f, size, title)
	default:
		return fmt.Errorf("unsupported audio format %q", w.format)
	}
	if err != nil {
		return err
	}
	if err := copyAudioSection(ctx, out, f, 0, edit.start); err != nil {
		return err
	}
	if _, err := out.Write(edit.replacement); err != nil {
		return err
	}
	if err := copyAudioSection(ctx, out, f, edit.end, size-edit.end); err != nil {
		return err
	}
	if len(edit.suffix) == 0 {
		return nil
	}
	_, err = out.Write(edit.suffix)
	return err
}

func copyAudioSection(ctx context.Context, out io.Writer, src io.ReaderAt, offset, size int64) error {
	section := io.NewSectionReader(src, offset, size)
	for size > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		n := min(size, 1<<20)
		if _, err := io.CopyN(out, section, n); err != nil {
			return err
		}
		size -= n
	}
	return ctx.Err()
}

func (w audioWriter) Write(ctx context.Context, src, dst string, changes metadata.Fields) error {
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	err = w.rewrite(ctx, src, out, changes)
	if err == nil {
		err = out.Sync()
	}
	err = errors.Join(err, out.Close())
	if err != nil {
		os.Remove(dst)
	}
	return err
}

func (w audioWriter) Validate(ctx context.Context, src, staged string, changes metadata.Fields) error {
	want := sha256.New()
	if err := w.rewrite(ctx, src, want, changes); err != nil {
		return err
	}
	f, err := os.Open(staged)
	if err != nil {
		return err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return err
	}
	got := sha256.New()
	if err := copyAudioSection(ctx, got, f, 0, stat.Size()); err != nil {
		return err
	}
	if !bytes.Equal(got.Sum(nil), want.Sum(nil)) {
		return errors.New("staged audio differs from the expected metadata-only edit")
	}
	return nil
}
