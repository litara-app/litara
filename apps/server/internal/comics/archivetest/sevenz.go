package archivetest

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"os"
	"unicode/utf16"

	"github.com/ulikunitz/xz/lzma"
)

// SevenEntry describes one 7z file. All non-empty files share one folder.
type SevenEntry struct {
	Name       string
	Data       []byte
	Dir        bool
	Attributes uint32 // 0 = none written; the high 16 bits carry a UNIX mode when bit 0x8000 is set
}

// SevenOpts adjusts the single folder's coder and header claims for hostile cases.
type SevenOpts struct {
	CoderID    []byte // default {0x00} (copy)
	CoderProps []byte
	// FilesClaim overrides the number of files declared in FilesInfo (header-bomb test).
	FilesClaim uint64
	// EncodeHeader stores the header LZMA-compressed behind an EncodedHeader record, as 7-Zip does by default.
	EncodeHeader bool
}

func num(v uint64) []byte { // 7z variable-length number
	switch {
	case v < 0x80:
		return []byte{byte(v)}
	case v < 0x4000:
		return []byte{0x80 | byte(v>>8), byte(v)}
	case v < 0x200000:
		return []byte{0xC0 | byte(v>>16), byte(v), byte(v >> 8)}
	}
	b := make([]byte, 9)
	b[0] = 0xFF
	binary.LittleEndian.PutUint64(b[1:], v)
	return b
}

// WriteSevenZip writes a 7z with one folder holding every non-empty entry's data.
func WriteSevenZip(path string, entries []SevenEntry, o SevenOpts) error {
	if o.CoderID == nil {
		o.CoderID = []byte{0x00}
	}
	var packed bytes.Buffer
	var sizes []uint64
	for _, e := range entries {
		if !e.Dir && len(e.Data) > 0 {
			packed.Write(e.Data)
			sizes = append(sizes, uint64(len(e.Data)))
		}
	}
	var h bytes.Buffer
	h.WriteByte(0x01) // Header
	if packed.Len() > 0 {
		h.WriteByte(0x04) // MainStreamsInfo
		h.WriteByte(0x06) // PackInfo
		h.Write(num(0))   // pack pos
		h.Write(num(1))   // one pack stream
		h.WriteByte(0x09) // sizes
		h.Write(num(uint64(packed.Len())))
		h.WriteByte(0x00)
		h.WriteByte(0x07) // UnPackInfo
		h.WriteByte(0x0B) // Folder
		h.Write(num(1))
		h.WriteByte(0x00) // not external
		h.Write(num(1))   // one coder
		flag := byte(len(o.CoderID))
		if len(o.CoderProps) > 0 {
			flag |= 0x20
		}
		h.WriteByte(flag)
		h.Write(o.CoderID)
		if len(o.CoderProps) > 0 {
			h.Write(num(uint64(len(o.CoderProps))))
			h.Write(o.CoderProps)
		}
		h.WriteByte(0x0C) // CodersUnPackSize
		h.Write(num(uint64(packed.Len())))
		h.WriteByte(0x00)
		h.WriteByte(0x08) // SubStreamsInfo
		h.WriteByte(0x0D) // NumUnPackStream
		h.Write(num(uint64(len(sizes))))
		if len(sizes) > 1 {
			h.WriteByte(0x09)
			for _, s := range sizes[:len(sizes)-1] {
				h.Write(num(s))
			}
		}
		h.WriteByte(0x00)
		h.WriteByte(0x00) // end of streams info
	}
	claim := uint64(len(entries))
	if o.FilesClaim != 0 {
		claim = o.FilesClaim
	}
	h.WriteByte(0x05) // FilesInfo
	h.Write(num(claim))
	var empty []byte // empty-stream bit vector (directories and empty files)
	anyEmpty := false
	for i, e := range entries {
		if i%8 == 0 {
			empty = append(empty, 0)
		}
		if e.Dir || len(e.Data) == 0 {
			empty[i/8] |= 0x80 >> (i % 8)
			anyEmpty = true
		}
	}
	if anyEmpty {
		h.WriteByte(0x0E)
		h.Write(num(uint64(len(empty))))
		h.Write(empty)
		var files []byte // among empty streams, which are empty files (the rest are directories)
		n := 0
		for _, e := range entries {
			if e.Dir || len(e.Data) == 0 {
				if n%8 == 0 {
					files = append(files, 0)
				}
				if !e.Dir {
					files[n/8] |= 0x80 >> (n % 8)
				}
				n++
			}
		}
		h.WriteByte(0x0F)
		h.Write(num(uint64(len(files))))
		h.Write(files)
	}
	var names bytes.Buffer
	names.WriteByte(0x00) // not external
	for _, e := range entries {
		for _, u := range utf16.Encode([]rune(e.Name)) {
			_ = binary.Write(&names, binary.LittleEndian, u)
		}
		names.Write([]byte{0, 0})
	}
	h.WriteByte(0x11)
	h.Write(num(uint64(names.Len())))
	h.Write(names.Bytes())
	attrs := false
	for _, e := range entries {
		if e.Attributes != 0 {
			attrs = true
		}
	}
	if attrs {
		var a bytes.Buffer
		a.WriteByte(0x01) // all defined
		a.WriteByte(0x00) // not external
		for _, e := range entries {
			_ = binary.Write(&a, binary.LittleEndian, e.Attributes)
		}
		h.WriteByte(0x15)
		h.Write(num(uint64(a.Len())))
		h.Write(a.Bytes())
	}
	h.WriteByte(0x00) // end of FilesInfo
	h.WriteByte(0x00) // end of Header

	tail := h.Bytes()
	body := packed.Bytes()
	if o.EncodeHeader {
		var c bytes.Buffer
		w, err := lzma.WriterConfig{DictCap: 1 << 20, Size: int64(h.Len())}.NewWriter(&c)
		if err != nil {
			return err
		}
		if _, err := w.Write(h.Bytes()); err != nil {
			return err
		}
		if err := w.Close(); err != nil {
			return err
		}
		raw := c.Bytes()
		props, stream := raw[:5], raw[13:] // 7z keeps the properties in the folder and the size elsewhere
		var e bytes.Buffer
		e.WriteByte(0x17) // EncodedHeader
		e.WriteByte(0x06)
		e.Write(num(uint64(packed.Len()))) // pack position, after the signature header
		e.Write(num(1))
		e.WriteByte(0x09)
		e.Write(num(uint64(len(stream))))
		e.WriteByte(0x00)
		e.WriteByte(0x07)
		e.WriteByte(0x0B)
		e.Write(num(1))
		e.WriteByte(0x00)
		e.Write(num(1))
		e.WriteByte(0x03 | 0x20)
		e.Write([]byte{0x03, 0x01, 0x01})
		e.Write(num(5))
		e.Write(props)
		e.WriteByte(0x0C)
		e.Write(num(uint64(h.Len())))
		e.WriteByte(0x00)
		e.WriteByte(0x00)
		body = append(append([]byte{}, body...), stream...)
		tail = e.Bytes()
	}
	var out, start bytes.Buffer
	_ = binary.Write(&start, binary.LittleEndian, uint64(len(body))) // next header offset
	_ = binary.Write(&start, binary.LittleEndian, uint64(len(tail)))
	_ = binary.Write(&start, binary.LittleEndian, crc32.ChecksumIEEE(tail))
	out.Write([]byte{'7', 'z', 0xBC, 0xAF, 0x27, 0x1C, 0, 4})
	_ = binary.Write(&out, binary.LittleEndian, crc32.ChecksumIEEE(start.Bytes()))
	out.Write(start.Bytes())
	out.Write(body)
	out.Write(tail)
	return os.WriteFile(path, out.Bytes(), 0o600)
}
