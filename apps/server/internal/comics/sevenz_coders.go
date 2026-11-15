package comics

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sync/atomic"

	"github.com/bodgit/sevenzip"
	"github.com/ulikunitz/xz/lzma"
)

// ADR-0072: a 7z names the decompression dictionary in its own header, and the
// library would allocate whatever it asks for. These replacements bound that
// memory before any allocation and refuse coders whose memory cannot be bounded
// here. Everything else the library registers (copy, delta, BCJ filters, deflate,
// bzip2) has fixed, small memory use. Encrypted streams (AES) cannot be read
// without a password and are refused by the extractor.

// sevenDictCeiling is the largest dictionary, in bytes, a 7z coder may request.
// It is set from Limits.MaxDictionary when an archive is opened; all extraction
// jobs of one server share the same operator-configured limits.
var sevenDictCeiling atomic.Int64

func init() {
	sevenDictCeiling.Store(DefaultLimits().MaxDictionary)
	sevenzip.RegisterDecompressor([]byte{0x03, 0x01, 0x01}, newBoundedLZMA)
	sevenzip.RegisterDecompressor([]byte{0x21}, newBoundedLZMA2)
	for _, id := range [][]byte{{0x03, 0x04, 0x01}, {0x04, 0xf7, 0x11, 0x01}, {0x04, 0xf7, 0x11, 0x02}, {0x04, 0xf7, 0x11, 0x04}} {
		sevenzip.RegisterDecompressor(id, refuseCoder)
	}
}

var errCoderRefused = errors.New("7z: this compression method is not accepted (its memory use cannot be bounded)")
var errDictTooLarge = errors.New("7z: the archive needs a larger decompression dictionary than the ceiling")

func refuseCoder(_ []byte, _ uint64, _ []io.ReadCloser) (io.ReadCloser, error) {
	return nil, errCoderRefused
}

type readCloser struct {
	io.Reader
	c io.Closer
}

func (r *readCloser) Close() error { return r.c.Close() }

func newBoundedLZMA(props []byte, size uint64, readers []io.ReadCloser) (io.ReadCloser, error) {
	if len(readers) != 1 {
		return nil, errors.New("7z lzma: need exactly one input")
	}
	if len(props) != 5 {
		return nil, errors.New("7z lzma: bad properties")
	}
	if dict := int64(binary.LittleEndian.Uint32(props[1:5])); dict > sevenDictCeiling.Load() {
		return nil, errDictTooLarge
	}
	hdr := bytes.NewBuffer(append([]byte{}, props...))
	_ = binary.Write(hdr, binary.LittleEndian, size)
	lr, err := lzma.NewReader(io.MultiReader(hdr, readers[0]))
	if err != nil {
		return nil, fmt.Errorf("7z lzma: %w", err)
	}
	return &readCloser{lr, readers[0]}, nil
}

func newBoundedLZMA2(props []byte, _ uint64, readers []io.ReadCloser) (io.ReadCloser, error) {
	if len(readers) != 1 {
		return nil, errors.New("7z lzma2: need exactly one input")
	}
	if len(props) != 1 || props[0] > 40 {
		return nil, errors.New("7z lzma2: bad properties")
	}
	dict := int64(2|int(props[0]&1)) << (props[0]/2 + 11) // as in the reference decoder
	if props[0] == 40 {
		dict = 0xFFFFFFFF
	}
	if dict > sevenDictCeiling.Load() {
		return nil, errDictTooLarge
	}
	cfg := lzma.Reader2Config{DictCap: int(dict)}
	if err := cfg.Verify(); err != nil {
		return nil, fmt.Errorf("7z lzma2: %w", err)
	}
	lr, err := cfg.NewReader2(readers[0])
	if err != nil {
		return nil, fmt.Errorf("7z lzma2: %w", err)
	}
	return &readCloser{lr, readers[0]}, nil
}
