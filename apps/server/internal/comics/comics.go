// Package comics extracts comic page images from CBZ archives into a private
// cache under the bounded, streaming rules of ADR-0067. Nothing is published
// until the whole archive validated; originals are never touched. CBR and CB7
// are not handled here (no vetted Go dependency is approved yet) and are
// reported as unsupported by the caller.
package comics

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Profile names the extraction rules a manifest was produced under.
const Profile = "cbz-go-zip/1"

// Limits are the ADR-0067 ceilings. Operators may only lower them.
type Limits struct {
	MaxCompressed int64
	MaxEntries    int
	MaxPages      int
	MaxExpanded   int64
	MaxEntryBytes int64
	MaxPixels     int64
	MaxRatio      int64
	Timeout       time.Duration
}

func DefaultLimits() Limits {
	return Limits{MaxCompressed: 2 << 30, MaxEntries: 10000, MaxPages: 10000, MaxExpanded: 8 << 30, MaxEntryBytes: 100 << 20,
		MaxPixels: 100_000_000, MaxRatio: 200, Timeout: 120 * time.Second}
}

// Lowered returns l with every nonzero field of o that is smaller applied.
func (l Limits) Lowered(o Limits) Limits {
	lowI := func(cur, v int64) int64 {
		if v > 0 && v < cur {
			return v
		}
		return cur
	}
	l.MaxCompressed = lowI(l.MaxCompressed, o.MaxCompressed)
	l.MaxEntries = int(lowI(int64(l.MaxEntries), int64(o.MaxEntries)))
	l.MaxPages = int(lowI(int64(l.MaxPages), int64(o.MaxPages)))
	l.MaxExpanded = lowI(l.MaxExpanded, o.MaxExpanded)
	l.MaxEntryBytes = lowI(l.MaxEntryBytes, o.MaxEntryBytes)
	l.MaxPixels = lowI(l.MaxPixels, o.MaxPixels)
	l.MaxRatio = lowI(l.MaxRatio, o.MaxRatio)
	if o.Timeout > 0 && o.Timeout < l.Timeout {
		l.Timeout = o.Timeout
	}
	return l
}

// Error codes surfaced as typed issues.
const (
	CodeLimit       = "archive_limit"
	CodeUnsupported = "unsupported_archive"
)

// Error is a deterministic, user-visible rejection (not an I/O fault).
type Error struct{ Code, Detail string }

func (e *Error) Error() string { return e.Code + ": " + e.Detail }

func reject(code, format string, a ...any) *Error {
	return &Error{Code: code, Detail: fmt.Sprintf(format, a...)}
}

// Page is one published page; File is relative to the output directory.
type Page struct {
	Index   int
	EntryID string
	Mime    string
	Width   int
	Height  int
	File    string
	Bytes   int64
}

type Result struct {
	Pages []Page
	Bytes int64
	// Skipped lists entry kinds that were ignored, for evidence (never paths).
	Skipped []string
}

// Hooks lets the caller veto work before bytes are written (cache reservation).
type Hooks struct {
	// Reserve is called once with the total declared expanded image bytes.
	Reserve func(bytes int64) error
}

var imageExt = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true}
var nestedArchive = map[string]bool{".zip": true, ".cbz": true, ".rar": true, ".cbr": true, ".7z": true, ".cb7": true, ".tar": true, ".gz": true}

// normalizeEntry validates and normalizes an archive entry name; it returns
// the cleaned relative path or an error for anything unsafe.
func normalizeEntry(name string) (string, *Error) {
	if name == "" || strings.ContainsRune(name, 0) || strings.Contains(name, `\`) {
		return "", reject(CodeUnsupported, "an entry has an invalid name")
	}
	n := norm.NFC.String(name)
	if strings.HasPrefix(n, "/") || (len(n) >= 2 && n[1] == ':' && unicode.IsLetter(rune(n[0]))) {
		return "", reject(CodeUnsupported, "an entry has an absolute path")
	}
	for _, seg := range strings.Split(strings.TrimSuffix(n, "/"), "/") {
		if seg == ".." || seg == "." || seg == "" {
			return "", reject(CodeUnsupported, "an entry path contains traversal or empty segments")
		}
	}
	return path.Clean(n), nil
}

// naturalLess orders paths by case-insensitive natural (numeric) comparison,
// breaking ties bytewise on the UTF-8 path (ADR-0067).
func naturalLess(a, b string) bool {
	if c := naturalCompare(strings.ToLower(a), strings.ToLower(b)); c != 0 {
		return c < 0
	}
	return a < b
}

func naturalCompare(a, b string) int {
	for a != "" && b != "" {
		ad, bd := isDigit(a[0]), isDigit(b[0])
		if ad && bd {
			na, ra := digits(a)
			nb, rb := digits(b)
			na, nb = strings.TrimLeft(na, "0"), strings.TrimLeft(nb, "0")
			if len(na) != len(nb) {
				if len(na) < len(nb) {
					return -1
				}
				return 1
			}
			if na != nb {
				if na < nb {
					return -1
				}
				return 1
			}
			a, b = ra, rb
			continue
		}
		if a[0] != b[0] {
			if a[0] < b[0] {
				return -1
			}
			return 1
		}
		a, b = a[1:], b[1:]
	}
	switch {
	case a == "" && b == "":
		return 0
	case a == "":
		return -1
	}
	return 1
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func digits(s string) (run, rest string) {
	i := 0
	for i < len(s) && isDigit(s[i]) {
		i++
	}
	return s[:i], s[i:]
}

// Extract validates the whole CBZ, then writes its page images into dst (created
// only when everything validated). Every failure leaves dst absent.
func Extract(ctx context.Context, src, dst string, lim Limits, hooks Hooks) (res Result, err error) {
	ctx, cancel := context.WithTimeout(ctx, lim.Timeout)
	defer cancel()
	st, err := os.Stat(src)
	if err != nil {
		return res, err
	}
	if !st.Mode().IsRegular() {
		return res, reject(CodeUnsupported, "the source is not a regular file")
	}
	if st.Size() > lim.MaxCompressed {
		return res, reject(CodeLimit, "the archive exceeds the compressed size ceiling")
	}
	zr, err := zip.OpenReader(src)
	if err != nil {
		return res, reject(CodeUnsupported, "the file is not a readable ZIP archive")
	}
	defer zr.Close()
	if len(zr.File) > lim.MaxEntries {
		return res, reject(CodeLimit, "the archive has too many entries")
	}

	type entry struct {
		f    *zip.File
		norm string
	}
	seen := map[string]bool{}
	var imgs []entry
	var expanded int64
	for _, f := range zr.File {
		n, rerr := normalizeEntry(f.Name)
		if rerr != nil {
			return res, rerr
		}
		key := strings.ToLower(n)
		if seen[key] {
			return res, reject(CodeUnsupported, "two entries share one normalized path")
		}
		seen[key] = true
		mode := f.Mode()
		if f.FileInfo().IsDir() {
			continue
		}
		if mode&os.ModeSymlink != 0 || !mode.IsRegular() {
			return res, reject(CodeUnsupported, "the archive contains a link or special file")
		}
		ext := strings.ToLower(path.Ext(n))
		if nestedArchive[ext] {
			return res, reject(CodeUnsupported, "the archive contains a nested archive")
		}
		if !imageExt[ext] {
			res.Skipped = append(res.Skipped, "non-image entry")
			continue
		}
		if int64(f.UncompressedSize64) > lim.MaxEntryBytes {
			return res, reject(CodeLimit, "an entry exceeds the per-entry size ceiling")
		}
		expanded += int64(f.UncompressedSize64)
		if expanded > lim.MaxExpanded {
			return res, reject(CodeLimit, "the expanded size exceeds the ceiling")
		}
		imgs = append(imgs, entry{f, n})
	}
	if len(imgs) == 0 {
		return res, reject(CodeUnsupported, "the archive has no page images")
	}
	if len(imgs) > lim.MaxPages {
		return res, reject(CodeLimit, "the archive has too many pages")
	}
	if expanded > 1<<20 && expanded/maxInt64(st.Size(), 1) > lim.MaxRatio {
		return res, reject(CodeLimit, "the expansion ratio exceeds the ceiling")
	}
	sort.SliceStable(imgs, func(i, j int) bool { return naturalLess(imgs[i].norm, imgs[j].norm) })
	if hooks.Reserve != nil {
		if err := hooks.Reserve(expanded); err != nil {
			return res, err
		}
	}

	tmp := dst + ".tmp"
	_ = os.RemoveAll(tmp)
	if err := os.MkdirAll(tmp, 0o700); err != nil {
		return res, err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(tmp)
		}
	}()
	var streamed int64
	for i, e := range imgs {
		if err = ctx.Err(); err != nil {
			return res, reject(CodeLimit, "extraction exceeded the time ceiling")
		}
		page, perr := writePage(ctx, e.f, tmp, i, e.norm, lim, &streamed)
		if perr != nil {
			err = perr
			return res, perr
		}
		res.Pages = append(res.Pages, page)
		res.Bytes += page.Bytes
	}
	_ = os.RemoveAll(dst)
	if err = os.Rename(tmp, dst); err != nil {
		return res, err
	}
	return res, nil
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

// limitedWriter counts real decompressed bytes; headers are never trusted.
type limitedWriter struct {
	w           io.Writer
	n, max      int64
	total, tmax *int64
	ctx         context.Context
}

func (l *limitedWriter) Write(p []byte) (int, error) {
	if err := l.ctx.Err(); err != nil {
		return 0, reject(CodeLimit, "extraction exceeded the time ceiling")
	}
	l.n += int64(len(p))
	*l.total += int64(len(p))
	if l.n > l.max || *l.total > *l.tmax {
		return 0, reject(CodeLimit, "streamed bytes exceeded a size ceiling")
	}
	return l.w.Write(p)
}

func writePage(ctx context.Context, f *zip.File, dir string, index int, normPath string, lim Limits, streamed *int64) (Page, error) {
	rc, err := f.Open()
	if err != nil {
		return Page{}, reject(CodeUnsupported, "an entry could not be read")
	}
	defer rc.Close()
	tmpName := fmt.Sprintf("%05d.part", index)
	out, err := os.OpenFile(filepath.Join(dir, tmpName), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return Page{}, err
	}
	max := lim.MaxExpanded
	lw := &limitedWriter{w: out, max: lim.MaxEntryBytes, total: streamed, tmax: &max, ctx: ctx}
	_, cerr := io.Copy(lw, io.LimitReader(rc, lim.MaxEntryBytes+1))
	if cerr == nil && lw.n > lim.MaxEntryBytes {
		cerr = reject(CodeLimit, "an entry exceeds the per-entry size ceiling")
	}
	if clerr := out.Close(); cerr == nil {
		cerr = clerr
	}
	if cerr != nil {
		var re *Error
		if errors.As(cerr, &re) {
			return Page{}, re
		}
		return Page{}, reject(CodeUnsupported, "an entry could not be decompressed")
	}
	// The decoder, not the extension, decides what the bytes are.
	p := filepath.Join(dir, tmpName)
	mime, w, h, derr := sniff(p)
	if derr != nil {
		return Page{}, reject(CodeUnsupported, "an image entry is not a valid image")
	}
	if int64(w)*int64(h) > lim.MaxPixels {
		return Page{}, reject(CodeLimit, "an image exceeds the pixel ceiling")
	}
	final := fmt.Sprintf("%05d%s", index, map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}[mime])
	if err := os.Rename(p, filepath.Join(dir, final)); err != nil {
		return Page{}, err
	}
	sum := sha256.Sum256([]byte(normPath))
	return Page{Index: index, EntryID: hex.EncodeToString(sum[:]), Mime: mime, Width: w, Height: h, File: final, Bytes: lw.n}, nil
}

// sniff identifies JPEG, PNG, GIF and WebP by decoding only their headers.
func sniff(p string) (mime string, w, h int, err error) {
	f, err := os.Open(p)
	if err != nil {
		return "", 0, 0, err
	}
	defer f.Close()
	var head [32]byte
	n, _ := io.ReadFull(f, head[:])
	if n >= 12 && string(head[0:4]) == "RIFF" && string(head[8:12]) == "WEBP" {
		w, h, err = webpSize(f)
		return "image/webp", w, h, err
	}
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return "", 0, 0, err
	}
	cfg, format, err := image.DecodeConfig(f)
	if err != nil {
		return "", 0, 0, err
	}
	switch format {
	case "jpeg":
		mime = "image/jpeg"
	case "png":
		mime = "image/png"
	case "gif":
		mime = "image/gif"
	default:
		return "", 0, 0, errors.New("unsupported image format")
	}
	if cfg.Width < 1 || cfg.Height < 1 {
		return "", 0, 0, errors.New("empty image")
	}
	return mime, cfg.Width, cfg.Height, nil
}

// webpSize reads the canvas size from a RIFF/WebP header (VP8, VP8L, VP8X).
func webpSize(f *os.File) (int, int, error) {
	if _, err := f.Seek(12, io.SeekStart); err != nil {
		return 0, 0, err
	}
	var h [30]byte
	if n, _ := io.ReadFull(f, h[:]); n < 18 {
		return 0, 0, errors.New("short webp")
	}
	switch string(h[0:4]) {
	case "VP8X":
		w := int(binary.LittleEndian.Uint32(append(h[12:15:15], 0))) + 1
		ht := int(binary.LittleEndian.Uint32(append(h[15:18:18], 0))) + 1
		return w, ht, nil
	case "VP8L":
		if h[8] != 0x2f {
			return 0, 0, errors.New("bad vp8l")
		}
		b := binary.LittleEndian.Uint32(h[9:13])
		return int(b&0x3fff) + 1, int((b>>14)&0x3fff) + 1, nil
	case "VP8 ":
		if h[11] != 0x9d || h[12] != 0x01 || h[13] != 0x2a {
			return 0, 0, errors.New("bad vp8")
		}
		return int(binary.LittleEndian.Uint16(h[14:16]) & 0x3fff), int(binary.LittleEndian.Uint16(h[16:18]) & 0x3fff), nil
	}
	return 0, 0, errors.New("unknown webp chunk")
}
