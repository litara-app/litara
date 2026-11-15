package comics

import (
	"archive/zip"
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/bodgit/sevenzip"
	"github.com/nwaples/rardecode/v2"
)

// member is one archive entry as declared by its header. Declared sizes are
// only used for early refusal; real decompressed bytes are always counted.
type member struct {
	Name      string
	Size      int64
	Dir       bool
	Link      bool // symbolic/hard link, redirection or special file
	Encrypted bool
}

// archive gives the extractor format-independent access. Open must be called
// with strictly increasing indexes (archive order); sequential formats rely on it.
type archive interface {
	Members(ctx context.Context, lim Limits) ([]member, error)
	Open(i int) (io.ReadCloser, error)
	Close() error
}

// Magic numbers decide the format; extensions are never trusted.
func detect(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	var b [8]byte
	n, _ := io.ReadFull(f, b[:])
	switch {
	case n >= 7 && string(b[:6]) == "Rar!\x1a\x07":
		return "rar", nil
	case n >= 6 && string(b[:6]) == "7z\xbc\xaf\x27\x1c":
		return "7z", nil
	}
	return "zip", nil
}

func openArchive(p string, lim Limits) (archive, *Error) {
	kind, err := detect(p)
	if err != nil {
		return nil, reject(CodeUnsupported, "the file could not be read")
	}
	switch kind {
	case "rar":
		return &rarArchive{path: p, lim: lim}, nil
	case "7z":
		sz, serr := openSevenZip(p, lim)
		if serr != nil {
			return nil, serr
		}
		return sz, nil
	}
	zr, err := zip.OpenReader(p)
	if err != nil {
		return nil, reject(CodeUnsupported, "the file is not a readable ZIP, RAR or 7z archive")
	}
	return &zipArchive{zr: zr}, nil
}

// ---- ZIP ----------------------------------------------------------------------

type zipArchive struct{ zr *zip.ReadCloser }

func (z *zipArchive) Members(_ context.Context, lim Limits) ([]member, error) {
	if len(z.zr.File) > lim.MaxEntries {
		return nil, reject(CodeLimit, "the archive has too many entries")
	}
	out := make([]member, len(z.zr.File))
	for i, f := range z.zr.File {
		mode := f.Mode()
		out[i] = member{Name: f.Name, Size: int64(f.UncompressedSize64), Dir: f.FileInfo().IsDir(),
			Link: mode&os.ModeSymlink != 0 || (!f.FileInfo().IsDir() && !mode.IsRegular()), Encrypted: f.Flags&0x1 != 0}
	}
	return out, nil
}
func (z *zipArchive) Open(i int) (io.ReadCloser, error) { return z.zr.File[i].Open() }
func (z *zipArchive) Close() error                      { return z.zr.Close() }

// ---- RAR ----------------------------------------------------------------------

// onlyFile exposes exactly one file to the RAR reader, so a multi-volume archive
// can never wander into neighbouring files (continuations are refused).
type onlyFile struct{ dir, name string }

func (o onlyFile) Open(name string) (fs.File, error) {
	if name != o.name {
		return nil, fs.ErrNotExist
	}
	return os.Open(filepath.Join(o.dir, o.name))
}

type rarArchive struct {
	path string
	lim  Limits
	rc   *rardecode.ReadCloser
	pos  int // index of the entry the reader is positioned on, -1 before the first
}

func (r *rarArchive) options() []rardecode.Option {
	return []rardecode.Option{
		rardecode.FileSystem(onlyFile{dir: filepath.Dir(r.path), name: filepath.Base(r.path)}),
		rardecode.MaxDictionarySize(r.lim.MaxDictionary), // ADR-0072: the library default is 4 GiB
	}
}

func rarFault(err error) *Error {
	switch {
	case errors.Is(err, rardecode.ErrBadPassword):
		return reject(CodeUnsupported, "the archive is encrypted")
	case errors.Is(err, rardecode.ErrDictionaryTooLarge):
		return reject(CodeLimit, "the archive needs a larger decompression dictionary than the ceiling")
	}
	return reject(CodeUnsupported, "the file is not a readable RAR archive, or it spans several volumes")
}

func (r *rarArchive) start() error {
	if r.rc != nil {
		_ = r.rc.Close()
	}
	rc, err := rardecode.OpenReader(filepath.Base(r.path), r.options()...)
	if err != nil {
		return rarFault(err)
	}
	r.rc, r.pos = rc, -1
	return nil
}

// Members reads every header once (streaming; memory stays bounded by the entry cap).
func (r *rarArchive) Members(ctx context.Context, lim Limits) ([]member, error) {
	if err := r.start(); err != nil {
		return nil, err
	}
	var out []member
	var declared int64
	for {
		if err := ctx.Err(); err != nil {
			return nil, reject(CodeLimit, "extraction exceeded the time ceiling")
		}
		h, err := r.rc.Next()
		if errors.Is(err, io.EOF) {
			_ = r.rc.Close() // the header pass consumed the reader; Open starts a fresh one
			r.rc = nil
			return out, nil
		}
		if err != nil {
			return nil, rarFault(err)
		}
		if len(out) >= lim.MaxEntries {
			return nil, reject(CodeLimit, "the archive has too many entries")
		}
		m := member{Name: h.Name, Size: h.UnPackedSize, Dir: h.IsDir, Encrypted: h.Encrypted || h.HeaderEncrypted, Link: h.LinkType != 0}
		if h.UnKnownSize && !h.IsDir {
			return nil, reject(CodeUnsupported, "an entry has an unknown size")
		}
		// Refuse before Next has to decode (solid archives) a huge entry to skip it.
		if !h.IsDir && (m.Size > lim.MaxEntryBytes || declared+m.Size > lim.MaxExpanded) {
			return nil, reject(CodeLimit, "an entry or the expanded size exceeds a ceiling")
		}
		declared += m.Size
		out = append(out, m)
	}
}

func (r *rarArchive) Open(i int) (io.ReadCloser, error) {
	if r.rc == nil || i <= r.pos {
		if err := r.start(); err != nil {
			return nil, err
		}
	}
	for r.pos < i {
		if _, err := r.rc.Next(); err != nil {
			return nil, rarFault(err)
		}
		r.pos++
	}
	return io.NopCloser(r.rc), nil
}

func (r *rarArchive) Close() error {
	if r.rc == nil {
		return nil
	}
	return r.rc.Close()
}

// ---- 7z -----------------------------------------------------------------------

type sevenArchive struct{ rc *sevenzip.ReadCloser }

func (s *sevenArchive) Members(_ context.Context, lim Limits) ([]member, error) {
	if len(s.rc.File) > lim.MaxEntries {
		return nil, reject(CodeLimit, "the archive has too many entries")
	}
	out := make([]member, len(s.rc.File))
	for i, f := range s.rc.File {
		mode := f.Mode()
		out[i] = member{Name: f.Name, Size: int64(f.UncompressedSize), Dir: mode.IsDir(), Link: mode&os.ModeSymlink != 0 || (!mode.IsDir() && !mode.IsRegular())}
	}
	return out, nil
}
func (s *sevenArchive) Open(i int) (io.ReadCloser, error) {
	rc, err := s.rc.File[i].Open()
	if err != nil {
		return nil, sevenFault(err)
	}
	return rc, nil
}

// sevenFault maps decoder errors to the typed rejections the API reports.
func sevenFault(err error) error {
	switch {
	case errors.Is(err, errDictTooLarge):
		return reject(CodeLimit, "the archive needs a larger decompression dictionary than the ceiling")
	case errors.Is(err, errCoderRefused):
		return reject(CodeUnsupported, "the archive uses a compression method that is not accepted")
	}
	return err
}
func (s *sevenArchive) Close() error { return s.rc.Close() }

func openSevenZip(p string, lim Limits) (*sevenArchive, *Error) {
	sevenDictCeiling.Store(lim.MaxDictionary)
	if perr := precheckSevenZip(p, lim.MaxEntries); perr != nil { // before the library allocates anything from the header
		return nil, perr
	}
	rc, err := sevenzip.OpenReader(p)
	if err != nil {
		return nil, reject(CodeUnsupported, "the file is not a readable 7z archive, or it is encrypted")
	}
	return &sevenArchive{rc: rc}, nil
}
