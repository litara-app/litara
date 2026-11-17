package comics

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"os"
)

// ADR-0072 audit finding: bodgit/sevenzip allocates one FileHeader (about 130 bytes) per file
// the header *claims*, before checking the claim against anything. A 100-byte archive can claim
// four billion files and take the whole server down. This pre-check reads the signature header and
// the (possibly LZMA-encoded) header with bounded memory, walks only as far as the file count, and
// refuses oversized claims before the library sees the archive. Anything it cannot parse is
// refused (fail closed); the library never parses a header this code has not accepted.

const (
	sevenSigSize     = 32
	sevenMaxHeader   = 16 << 20 // largest header (packed or decoded) the pre-check will read
	sevenMaxNesting  = 2
	sevenMaxCoders   = 32
	sevenMaxStreamIn = 64
	// maxCodersPerFile bounds all coders in an archive to this many per permitted entry; real
	// archives use one to three (compressor plus filters) per folder.
	maxCodersPerFile = 4
)

var errSevenHeader = errors.New("7z: header cannot be validated")

type sevenReader struct {
	b []byte
	i int
}

func (r *sevenReader) left() int { return len(r.b) - r.i }

func (r *sevenReader) byte() (byte, error) {
	if r.i >= len(r.b) {
		return 0, errSevenHeader
	}
	c := r.b[r.i]
	r.i++
	return c, nil
}

func (r *sevenReader) take(n uint64) ([]byte, error) {
	if n > uint64(r.left()) {
		return nil, errSevenHeader
	}
	out := r.b[r.i : r.i+int(n)]
	r.i += int(n)
	return out, nil
}

// number reads a 7z variable-length NUMBER.
func (r *sevenReader) number() (uint64, error) {
	first, err := r.byte()
	if err != nil {
		return 0, err
	}
	mask := byte(0x80)
	var v uint64
	for i := 0; i < 8; i++ {
		if first&mask == 0 {
			high := uint64(first & (mask - 1))
			return v | high<<(8*uint(i)), nil
		}
		c, err := r.byte()
		if err != nil {
			return 0, err
		}
		v |= uint64(c) << (8 * uint(i))
		mask >>= 1
	}
	return v, nil
}

// count reads a NUMBER that counts items each needing at least one more header byte (so it can
// never exceed what is left), refusing anything larger.
func (r *sevenReader) count() (int, error) {
	n, err := r.number()
	if err != nil || n > uint64(r.left()) {
		return 0, errSevenHeader
	}
	return int(n), nil
}

type sevenFolder struct {
	coderID    []byte
	coderProps []byte
	nCoders    int
	outSizes   []uint64
}

type sevenStreams struct {
	coders    int // coders across every folder
	packPos   uint64
	packSizes []uint64
	folders   []sevenFolder
}

func (r *sevenReader) digests(n int) error {
	all, err := r.byte()
	if err != nil {
		return err
	}
	defined := n
	if all == 0 {
		bits, err := r.take(uint64((n + 7) / 8))
		if err != nil {
			return err
		}
		defined = 0
		for i := 0; i < n; i++ {
			if bits[i/8]&(0x80>>uint(i%8)) != 0 {
				defined++
			}
		}
	}
	_, err = r.take(uint64(defined) * 4)
	return err
}

// streamsInfo parses PackInfo, UnPackInfo and SubStreamsInfo (after the 0x04/0x03/0x17 marker).
func (r *sevenReader) streamsInfo(maxFiles int) (*sevenStreams, error) {
	s := &sevenStreams{}
	for {
		id, err := r.byte()
		if err != nil {
			return nil, err
		}
		switch id {
		case 0x00:
			return s, nil
		case 0x06: // PackInfo
			if s.packPos, err = r.number(); err != nil {
				return nil, err
			}
			n, err := r.count()
			if err != nil {
				return nil, err
			}
			// The library allocates every pack stream; real archives have about one per folder.
			if n > maxFiles {
				return nil, errSevenLimit
			}
			for {
				pid, err := r.byte()
				if err != nil {
					return nil, err
				}
				if pid == 0x00 {
					break
				}
				switch pid {
				case 0x09:
					for i := 0; i < n; i++ {
						v, err := r.number()
						if err != nil {
							return nil, err
						}
						s.packSizes = append(s.packSizes, v)
					}
				case 0x0A:
					if err := r.digests(n); err != nil {
						return nil, err
					}
				default:
					return nil, errSevenHeader
				}
			}
		case 0x07: // UnPackInfo
			if t, err := r.byte(); err != nil || t != 0x0B {
				return nil, errSevenHeader
			}
			nf, err := r.count()
			if err != nil {
				return nil, err
			}
			// The library allocates per folder before validating anything, and a folder costs only
			// a few header bytes, so header size alone is no bound. An entry needs at most one
			// folder, so more folders than the entry ceiling cannot be legitimate.
			if nf > maxFiles {
				return nil, errSevenLimit
			}
			if ext, err := r.byte(); err != nil || ext != 0 {
				return nil, errSevenHeader
			}
			outs := make([]int, nf)
			for i := 0; i < nf; i++ {
				f, nOut, err := r.folder()
				if err != nil {
					return nil, err
				}
				s.coders += f.nCoders
				if s.coders > maxCodersPerFile*maxFiles {
					return nil, errSevenLimit
				}
				s.folders = append(s.folders, f)
				outs[i] = nOut
			}
			if t, err := r.byte(); err != nil || t != 0x0C {
				return nil, errSevenHeader
			}
			for i := range s.folders {
				for k := 0; k < outs[i]; k++ {
					v, err := r.number()
					if err != nil {
						return nil, err
					}
					s.folders[i].outSizes = append(s.folders[i].outSizes, v)
				}
			}
			for {
				uid, err := r.byte()
				if err != nil {
					return nil, err
				}
				if uid == 0x00 {
					break
				}
				if uid != 0x0A {
					return nil, errSevenHeader
				}
				if err := r.digests(nf); err != nil {
					return nil, err
				}
			}
		case 0x08: // SubStreamsInfo
			total := 0
			per := make([]int, len(s.folders))
			for i := range per {
				per[i] = 1
			}
			for {
				sid, err := r.byte()
				if err != nil {
					return nil, err
				}
				if sid == 0x00 {
					break
				}
				switch sid {
				case 0x0D:
					for i := range per {
						n, err := r.count()
						if err != nil {
							return nil, err
						}
						per[i] = n
					}
				case 0x09:
					for _, n := range per {
						for k := 1; k < n; k++ {
							if _, err := r.number(); err != nil {
								return nil, err
							}
						}
					}
				case 0x0A:
					unknown := 0
					for _, n := range per {
						unknown += n
					}
					if err := r.digests(unknown); err != nil {
						return nil, err
					}
				default:
					return nil, errSevenHeader
				}
			}
			for _, n := range per {
				total += n
				if total > maxFiles {
					return nil, errSevenLimit
				}
			}
		default:
			return nil, errSevenHeader
		}
	}
}

var errSevenLimit = errors.New("7z: the header declares more entries than the ceiling")

// folder parses one Folder; it returns the first coder's identity (all that header decoding
// needs) and the number of out streams (one unpack size follows for each).
func (r *sevenReader) folder() (sevenFolder, int, error) {
	var f sevenFolder
	nc, err := r.count()
	if err != nil || nc == 0 || nc > sevenMaxCoders {
		return f, 0, errSevenHeader
	}
	f.nCoders = nc
	totalIn, totalOut := 0, 0
	for i := 0; i < nc; i++ {
		flags, err := r.byte()
		if err != nil || flags&0xC0 != 0 {
			return f, 0, errSevenHeader
		}
		id, err := r.take(uint64(flags & 0x0F))
		if err != nil {
			return f, 0, err
		}
		nIn, nOut := 1, 1
		if flags&0x10 != 0 {
			a, err1 := r.number()
			b, err2 := r.number()
			if err1 != nil || err2 != nil || a > sevenMaxStreamIn || b > sevenMaxStreamIn {
				return f, 0, errSevenHeader
			}
			nIn, nOut = int(a), int(b)
		}
		var props []byte
		if flags&0x20 != 0 {
			n, err := r.count()
			if err != nil {
				return f, 0, err
			}
			if props, err = r.take(uint64(n)); err != nil {
				return f, 0, err
			}
		}
		if i == 0 {
			f.coderID, f.coderProps = id, props
		}
		totalIn += nIn
		totalOut += nOut
	}
	if totalOut < 1 {
		return f, 0, errSevenHeader
	}
	bind := totalOut - 1
	for i := 0; i < bind*2; i++ {
		if _, err := r.number(); err != nil {
			return f, 0, err
		}
	}
	if packed := totalIn - bind; packed > 1 {
		for i := 0; i < packed; i++ {
			if _, err := r.number(); err != nil {
				return f, 0, err
			}
		}
	}
	return f, totalOut, nil
}

// filesDeclared walks a plain header up to the FilesInfo count and returns it.
func filesDeclared(header []byte, maxFiles int) (uint64, error) {
	r := &sevenReader{b: header}
	if id, err := r.byte(); err != nil || id != 0x01 {
		return 0, errSevenHeader
	}
	for {
		id, err := r.byte()
		if err != nil {
			return 0, err
		}
		switch id {
		case 0x00:
			return 0, nil // no FilesInfo: nothing to claim
		case 0x02: // ArchiveProperties
			for {
				t, err := r.byte()
				if err != nil {
					return 0, err
				}
				if t == 0x00 {
					break
				}
				n, err := r.count()
				if err != nil {
					return 0, err
				}
				if _, err := r.take(uint64(n)); err != nil {
					return 0, err
				}
			}
		case 0x03, 0x04:
			if _, err := r.streamsInfo(maxFiles); err != nil {
				return 0, err
			}
		case 0x05:
			return r.number()
		default:
			return 0, errSevenHeader
		}
	}
}

// precheckSevenZip returns nil only when the file's header was fully understood and declares no
// more than maxFiles entries. A *Error is returned for limit breaches; any other failure is a
// refusal to parse.
func precheckSevenZip(path string, maxFiles int) *Error {
	f, err := os.Open(path)
	if err != nil {
		return reject(CodeUnsupported, "the file could not be read")
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return reject(CodeUnsupported, "the file could not be read")
	}
	var sig [sevenSigSize]byte
	if _, err := io.ReadFull(f, sig[:]); err != nil || !bytes.Equal(sig[:6], []byte{'7', 'z', 0xBC, 0xAF, 0x27, 0x1C}) {
		return reject(CodeUnsupported, "the file is not a readable 7z archive")
	}
	off := binary.LittleEndian.Uint64(sig[12:20])
	size := binary.LittleEndian.Uint64(sig[20:28])
	if size == 0 {
		return nil // an empty archive
	}
	read := func(at, n uint64) ([]byte, error) {
		if n > sevenMaxHeader || at > uint64(st.Size()) || n > uint64(st.Size())-at {
			return nil, errSevenHeader
		}
		b := make([]byte, n)
		_, err := f.ReadAt(b, int64(at))
		return b, err
	}
	header, err := read(sevenSigSize+off, size)
	if err != nil {
		return reject(CodeUnsupported, "the 7z header is damaged or too large to validate")
	}
	for depth := 0; ; depth++ {
		if len(header) == 0 {
			return reject(CodeUnsupported, "the 7z header is empty")
		}
		if header[0] == 0x01 {
			break
		}
		if header[0] != 0x17 || depth >= sevenMaxNesting {
			return reject(CodeUnsupported, "the 7z header is not understood")
		}
		r := &sevenReader{b: header[1:]}
		si, err := r.streamsInfo(maxFiles)
		if errors.Is(err, errSevenLimit) {
			return reject(CodeLimit, "the archive declares more streams than the ceiling")
		}
		if err != nil || len(si.folders) != 1 || len(si.packSizes) != 1 || len(si.folders[0].outSizes) != 1 {
			return reject(CodeUnsupported, "the 7z header is not understood")
		}
		fo := si.folders[0]
		if fo.nCoders != 1 || fo.outSizes[0] > sevenMaxHeader {
			return reject(CodeUnsupported, "the 7z header uses a layout that is not accepted")
		}
		packed, err := read(sevenSigSize+si.packPos, si.packSizes[0])
		if err != nil {
			return reject(CodeUnsupported, "the 7z header is damaged")
		}
		var dec io.ReadCloser
		in := []io.ReadCloser{io.NopCloser(bytes.NewReader(packed))}
		switch {
		case bytes.Equal(fo.coderID, []byte{0x00}):
			dec = in[0]
		case bytes.Equal(fo.coderID, []byte{0x03, 0x01, 0x01}):
			dec, err = newBoundedLZMA(fo.coderProps, fo.outSizes[0], in)
		case bytes.Equal(fo.coderID, []byte{0x21}):
			dec, err = newBoundedLZMA2(fo.coderProps, fo.outSizes[0], in)
		default:
			return reject(CodeUnsupported, "the 7z header is compressed with a method that is not accepted")
		}
		if err != nil {
			if errors.Is(err, errDictTooLarge) {
				return reject(CodeLimit, "the archive needs a larger decompression dictionary than the ceiling")
			}
			return reject(CodeUnsupported, "the 7z header could not be decoded")
		}
		out := make([]byte, fo.outSizes[0])
		_, err = io.ReadFull(dec, out)
		_ = dec.Close()
		if err != nil {
			return reject(CodeUnsupported, "the 7z header could not be decoded")
		}
		header = out
	}
	n, err := filesDeclared(header, maxFiles)
	switch {
	case errors.Is(err, errSevenLimit):
		return reject(CodeLimit, "the archive has too many entries")
	case err != nil:
		return reject(CodeUnsupported, "the 7z header is not understood")
	case n > uint64(maxFiles):
		return reject(CodeLimit, "the archive has too many entries")
	}
	return nil
}
