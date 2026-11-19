package ebookmeta

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"encoding/binary"
	"encoding/xml"
	"errors"
	"io"
	"net/url"
	"path"
	"strings"
)

const (
	StructureChecked = "checked"
	StructureDamaged = "damaged"
)

// InspectEPUB checks only the archive directory and required package documents.
// An empty result means the file could not be assessed within these limits.
func InspectEPUB(r io.ReaderAt, size int64) string {
	if size < 4 {
		return ""
	}
	var signature [4]byte
	if _, err := r.ReadAt(signature[:], 0); err != nil {
		return ""
	}
	switch string(signature[:]) {
	case "PK\x03\x04", "PK\x05\x06":
	default:
		return ""
	}
	if state := inspectZIPDirectory(r, size); state != StructureChecked {
		return state
	}
	bounded := &limitedArchiveReader{ReaderAt: r, remaining: 8 << 20}
	z, err := zip.NewReader(bounded, size)
	if err != nil {
		if !bounded.inconclusive && zipDamage(err) {
			return StructureDamaged
		}
		return ""
	}
	if len(z.File) > maxEntries {
		return ""
	}
	files := make(map[string]*zip.File, len(z.File))
	for _, f := range z.File {
		if _, exists := files[f.Name]; exists {
			return "" // alternate duplicate entries make the result ambiguous
		}
		files[f.Name] = f
	}
	var c struct {
		XMLName xml.Name `xml:"container"`
		container
	}
	state := inspectEPUBDocument(files["META-INF/container.xml"], &c)
	if state == StructureChecked {
		switch len(c.Rootfiles) {
		case 0:
			state = StructureDamaged
		case 1:
			root, err := url.PathUnescape(c.Rootfiles[0].FullPath)
			if err != nil {
				return ""
			}
			root = path.Clean(root)
			if root == "." || root == ".." || path.IsAbs(root) || strings.HasPrefix(root, "../") || strings.Contains(root, "\\") {
				state = StructureDamaged
			} else {
				entry := files[root]
				if entry == nil {
					entry = files[path.Clean(c.Rootfiles[0].FullPath)]
				}
				var pkg struct {
					XMLName xml.Name `xml:"package"`
				}
				state = inspectEPUBDocument(entry, &pkg)
			}
		default:
			return "" // multiple renditions need a separate check
		}
	}
	if state == StructureDamaged && files["META-INF/encryption.xml"] != nil {
		return "" // unreadable package documents may be protected
	}
	if bounded.inconclusive {
		return ""
	}
	return state
}

// Bound archive/zip's directory allocation before it trusts the declared
// record count. ZIP64 and split volumes are outside this lightweight check.
func inspectZIPDirectory(r io.ReaderAt, size int64) string {
	const endLength = 22
	tail := make([]byte, min(size, 65535+endLength))
	if _, err := r.ReadAt(tail, size-int64(len(tail))); err != nil {
		return ""
	}
	for i := len(tail) - endLength; i >= 0; i-- {
		if !bytes.Equal(tail[i:i+4], []byte("PK\x05\x06")) {
			continue
		}
		end := tail[i:]
		if int(binary.LittleEndian.Uint16(end[20:])) > len(end)-endLength {
			continue
		}
		disk, directoryDisk := binary.LittleEndian.Uint16(end[4:]), binary.LittleEndian.Uint16(end[6:])
		count := binary.LittleEndian.Uint16(end[10:])
		directorySize, offset := binary.LittleEndian.Uint32(end[12:]), binary.LittleEndian.Uint32(end[16:])
		if disk != 0 || directoryDisk != 0 || binary.LittleEndian.Uint16(end[8:]) != count ||
			count > maxEntries || directorySize == 0xffff || directorySize > 8<<20 || offset == 0xffffffff ||
			(i >= 20 && bytes.Equal(tail[i-20:i-16], []byte("PK\x06\x07"))) {
			return ""
		}
		return StructureChecked
	}
	return StructureDamaged
}

func inspectEPUBDocument(f *zip.File, out any) string {
	if f == nil {
		return StructureDamaged
	}
	if f.Flags&1 != 0 || f.UncompressedSize64 > maxXMLBytes || f.CompressedSize64 > maxXMLBytes {
		return ""
	}
	rc, err := f.Open()
	if err != nil {
		if zipDamage(err) {
			return StructureDamaged
		}
		return ""
	}
	defer rc.Close()
	body, err := io.ReadAll(io.LimitReader(rc, maxXMLBytes+1))
	if err != nil {
		if zipDamage(err) {
			return StructureDamaged
		}
		return ""
	}
	if len(body) > maxXMLBytes {
		return ""
	}
	if err := xml.Unmarshal(body, out); err != nil {
		var syntax *xml.SyntaxError
		var wrongRoot xml.UnmarshalError
		if errors.As(err, &syntax) || errors.As(err, &wrongRoot) || errors.Is(err, io.EOF) {
			return StructureDamaged
		}
		return "" // for example, an encoding the XML decoder cannot assess
	}
	return StructureChecked
}

func zipDamage(err error) bool {
	var corrupt flate.CorruptInputError
	return errors.Is(err, zip.ErrFormat) || errors.Is(err, zip.ErrChecksum) || errors.Is(err, io.ErrUnexpectedEOF) || errors.As(err, &corrupt)
}

type limitedArchiveReader struct {
	io.ReaderAt
	remaining    int
	inconclusive bool
}

func (r *limitedArchiveReader) ReadAt(p []byte, offset int64) (int, error) {
	if len(p) > r.remaining {
		r.inconclusive = true
		return 0, errors.New("EPUB inspection read limit")
	}
	n, err := r.ReaderAt.ReadAt(p, offset)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		r.inconclusive = true
	}
	r.remaining -= n
	return n, err
}
