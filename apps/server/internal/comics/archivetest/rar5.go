// Package archivetest writes tiny RAR5 and 7z archives for tests, so hostile and
// edge-case inputs can be made deterministically without a proprietary RAR
// compressor (ADR-0072). RAR5 uses the "store" method only; the 7z writer uses
// the "copy" coder with plain headers. It is test support, never used by the server.
package archivetest

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"os"
)

// RarEntry describes one RAR5 file header. Zero values give an ordinary stored file.
type RarEntry struct {
	Name         string
	Data         []byte
	Dir          bool
	Symlink      string  // non-empty: a UNIX symlink redirection record
	Encrypted    bool    // adds a file-encryption extra record (data is not encrypted)
	UnknownSize  bool    // sets the "unpacked size unknown" flag
	DeclaredSize *uint64 // overrides the declared unpacked size
	Method       uint64  // compression method 0..5 (0 = store)
	DictLog      uint64  // dictionary size = 128 KiB << DictLog (0..15)
	Solid        bool
}

func vint(v uint64) []byte {
	var out []byte
	for v >= 0x80 {
		out = append(out, byte(v)|0x80)
		v >>= 7
	}
	return append(out, byte(v))
}

// block builds one header: CRC32 of (size + fields), size, then the fields.
func block(fields []byte) []byte {
	var b bytes.Buffer
	size := vint(uint64(len(fields)))
	crc := crc32.ChecksumIEEE(append(append([]byte{}, size...), fields...))
	_ = binary.Write(&b, binary.LittleEndian, crc)
	b.Write(size)
	b.Write(fields)
	return b.Bytes()
}

// WriteRAR5 writes entries to path.
func WriteRAR5(path string, entries []RarEntry) error {
	var out bytes.Buffer
	out.Write([]byte{'R', 'a', 'r', '!', 0x1a, 0x07, 0x01, 0x00})
	out.Write(block(append(append(vint(1), vint(0)...), vint(0)...))) // main header: type 1, flags 0, archive flags 0
	for _, e := range entries {
		var f bytes.Buffer
		f.Write(vint(2)) // file header
		var extra bytes.Buffer
		if e.Encrypted {
			var rec bytes.Buffer
			rec.Write(vint(1)) // file encryption record
			rec.Write(vint(0)) // version
			rec.Write(vint(0)) // flags (no password check value)
			rec.WriteByte(15)  // KDF count
			rec.Write(make([]byte, 16))
			rec.Write(make([]byte, 16))
			extra.Write(vint(uint64(rec.Len())))
			extra.Write(rec.Bytes())
		}
		if e.Symlink != "" {
			var rec bytes.Buffer
			rec.Write(vint(5)) // file system redirection
			rec.Write(vint(2)) // UNIX symlink
			rec.Write(vint(0)) // flags
			rec.Write(vint(uint64(len(e.Symlink))))
			rec.WriteString(e.Symlink)
			extra.Write(vint(uint64(rec.Len())))
			extra.Write(rec.Bytes())
		}
		hflags := uint64(0)
		if extra.Len() > 0 {
			hflags |= 0x01
		}
		data := e.Data
		if e.Dir {
			data = nil
		}
		if len(data) > 0 {
			hflags |= 0x02
		}
		f.Write(vint(hflags))
		if extra.Len() > 0 {
			f.Write(vint(uint64(extra.Len())))
		}
		if len(data) > 0 {
			f.Write(vint(uint64(len(data))))
		}
		fflags := uint64(0x04) // CRC32 present
		if e.Dir {
			fflags |= 0x01
		}
		if e.UnknownSize {
			fflags |= 0x08
		}
		f.Write(vint(fflags))
		size := uint64(len(data))
		if e.DeclaredSize != nil {
			size = *e.DeclaredSize
		}
		f.Write(vint(size))
		f.Write(vint(0o644)) // attributes
		_ = binary.Write(&f, binary.LittleEndian, crc32.ChecksumIEEE(data))
		comp := e.Method<<7 | e.DictLog<<10
		if e.Solid {
			comp |= 1 << 6
		}
		f.Write(vint(comp))
		f.Write(vint(1)) // host OS: Unix
		f.Write(vint(uint64(len(e.Name))))
		f.WriteString(e.Name)
		f.Write(extra.Bytes())
		out.Write(block(f.Bytes()))
		out.Write(data)
	}
	out.Write(block(append(vint(5), append(vint(0), vint(0)...)...))) // end of archive
	return os.WriteFile(path, out.Bytes(), 0o600)
}
