package writeback

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"strings"
	"unicode/utf16"
)

func synchsafe(b []byte) (int, bool) {
	for _, v := range b {
		if v >= 128 {
			return 0, false
		}
	}
	return int(b[0])<<21 | int(b[1])<<14 | int(b[2])<<7 | int(b[3]), true
}

func putSynchsafe(b []byte, size int) {
	for i := 3; i >= 0; i-- {
		b[i] = byte(size & 127)
		size >>= 7
	}
}

// id3Spec is one tag the writer owns: a frame ID, and for TXXX the descriptor that names it.
type id3Spec struct {
	id, desc string
	text     string
	write    bool
	seen     bool
	image    []byte // APIC only: the JPEG of the front cover
}

func id3Specs(ch audioChanges, version byte) []*id3Spec {
	var out []*id3Spec
	if ch.title != nil {
		out = append(out, &id3Spec{id: "TIT2", text: *ch.title, write: true})
	}
	add := func(sg single, id, desc string, conv func(string) string) {
		v, w, touched := sg.patch()
		if !touched {
			return
		}
		if w && conv != nil {
			v = conv(v)
		}
		out = append(out, &id3Spec{id: id, desc: desc, text: v, write: w})
	}
	add(ch.publisher, "TPUB", "", nil)
	if version == 3 {
		add(ch.published, "TYER", "", func(s string) string { return s[:4] }) // ID3v2.3 has only a year frame
	} else {
		add(ch.published, "TDRC", "", nil)
	}
	add(ch.descr, "TXXX", "DESCRIPTION", nil)
	add(ch.isbn, "TXXX", "ISBN", nil)
	if ch.cover != nil {
		out = append(out, &id3Spec{id: "APIC", image: ch.cover, write: true})
	}
	return out
}

func utf16le(s string) []byte {
	b := []byte{0xff, 0xfe}
	for _, c := range utf16.Encode([]rune(s)) {
		b = binary.LittleEndian.AppendUint16(b, c)
	}
	return b
}

// id3Frame renders one text frame (or a TXXX user text frame) in the tag's version: UTF-16 with a byte-order mark for
// v2.3, UTF-8 for v2.4, and ISO-8859-1 for the digits of a v2.3 year.
func id3Frame(version byte, sp *id3Spec) []byte {
	frame := make([]byte, 10)
	copy(frame, sp.id)
	switch {
	case sp.id == "APIC":
		// Text encoding 0 (ISO-8859-1), the MIME type, picture type 3 (front cover), an empty description, then the picture.
		frame = append(frame, 0)
		frame = append(frame, "image/jpeg"...)
		frame = append(frame, 0, 3, 0)
		frame = append(frame, sp.image...)
	case sp.id == "TYER":
		frame = append(append(frame, 0), sp.text...)
	case version == 3 && sp.id == "TXXX":
		frame = append(frame, 1)
		frame = append(frame, utf16le(sp.desc)...)
		frame = append(frame, 0, 0)
		frame = append(frame, utf16le(sp.text)...)
	case version == 3:
		frame = append(append(frame, 1), utf16le(sp.text)...)
	case sp.id == "TXXX":
		frame = append(frame, 3)
		frame = append(frame, sp.desc...)
		frame = append(frame, 0)
		frame = append(frame, sp.text...)
	default:
		frame = append(append(frame, 3), sp.text...)
	}
	if version == 3 {
		binary.BigEndian.PutUint32(frame[4:8], uint32(len(frame)-10))
	} else {
		putSynchsafe(frame[4:8], len(frame)-10)
	}
	return frame
}

// id3Descriptor reads the descriptor of a TXXX frame body in any of the four ID3 text encodings.
func id3Descriptor(body []byte) string {
	if len(body) < 1 {
		return ""
	}
	enc, b := body[0], body[1:]
	switch enc {
	case 0, 3:
		if i := bytes.IndexByte(b, 0); i >= 0 {
			return string(b[:i])
		}
	case 1, 2:
		order := binary.ByteOrder(binary.BigEndian)
		if enc == 1 && len(b) >= 2 {
			switch {
			case b[0] == 0xff && b[1] == 0xfe:
				order, b = binary.LittleEndian, b[2:]
			case b[0] == 0xfe && b[1] == 0xff:
				b = b[2:]
			}
		}
		var units []uint16
		for i := 0; i+1 < len(b); i += 2 {
			u := order.Uint16(b[i:])
			if u == 0 {
				return string(utf16.Decode(units))
			}
			units = append(units, u)
		}
	}
	return ""
}

// apicIsFrontCover reports whether an APIC frame body holds a picture of type 3 (front cover). The writer replaces only
// that picture; other embedded pictures (back cover, artist photo) are kept as they are.
func apicIsFrontCover(body []byte) bool {
	if len(body) < 4 {
		return false
	}
	i := bytes.IndexByte(body[1:], 0)
	if i < 0 || 1+i+1 >= len(body) {
		return false
	}
	return body[1+i+1] == 3
}

// countAPIC counts the pictures in a tag body and how many are front covers; a damaged frame ends the count early (the
// main loop reports the damage).
func countAPIC(tags []byte, version byte) (total, front int) {
	for len(tags) >= 10 && tags[0] != 0 {
		n := int(binary.BigEndian.Uint32(tags[4:8]))
		if version == 4 {
			var ok bool
			if n, ok = synchsafe(tags[4:8]); !ok {
				return
			}
		}
		if n <= 0 || n > len(tags)-10 {
			return
		}
		if string(tags[:4]) == "APIC" {
			total++
			if apicIsFrontCover(tags[10 : 10+n]) {
				front++
			}
		}
		tags = tags[10+n:]
	}
	return
}

// apicReplaces says whether an existing picture is the one a cover write replaces: the front cover if the tag has one,
// otherwise the only picture there is. With several pictures and no front cover, a new front cover is added and the others
// are kept.
func apicReplaces(body []byte, total, front int) bool {
	if front > 0 {
		return apicIsFrontCover(body)
	}
	return total == 1
}

func editID3(r io.ReaderAt, size int64, ch audioChanges) (audioEdit, error) {
	var header [10]byte
	if _, err := r.ReadAt(header[:], 0); err != nil {
		return audioEdit{}, err
	}
	version := byte(4)
	var end int64
	var tags []byte
	if string(header[:3]) == "ID3" {
		version = header[3]
		n, valid := synchsafe(header[6:])
		if !valid || (version != 3 && version != 4) || header[4] != 0 || header[5] != 0 ||
			n > maxAudioMetadata || int64(n)+10 >= size {
			return audioEdit{}, errors.New("unsupported or damaged ID3 header")
		}
		end = int64(n) + 10
		tags = make([]byte, n)
		if _, err := r.ReadAt(tags, 10); err != nil {
			return audioEdit{}, err
		}
	}
	var audio [4]byte
	if _, err := r.ReadAt(audio[:], end); err != nil || audio[0] != 0xff || audio[1]&0xe6 != 0xe2 {
		return audioEdit{}, errors.New("missing MPEG Layer III frame after ID3")
	}
	specs := id3Specs(ch, version)
	apicTotal, apicFront := 0, 0
	if ch.cover != nil {
		apicTotal, apicFront = countAPIC(tags, version)
	}
	updated := make([]byte, 10, 10+len(tags)+256)
	copy(updated, "ID3")
	updated[3] = version
	for len(tags) > 0 && tags[0] != 0 {
		if len(tags) < 10 {
			return audioEdit{}, errors.New("truncated ID3 frame")
		}
		for _, c := range tags[:4] {
			if !(c >= 'A' && c <= 'Z' || c >= '0' && c <= '9') {
				return audioEdit{}, errors.New("invalid ID3 frame identifier")
			}
		}
		n := int(binary.BigEndian.Uint32(tags[4:8]))
		if version == 4 {
			var valid bool
			n, valid = synchsafe(tags[4:8])
			if !valid {
				return audioEdit{}, errors.New("invalid ID3v2.4 frame size")
			}
		}
		if n <= 0 || n > len(tags)-10 {
			return audioEdit{}, errors.New("invalid ID3 frame size")
		}
		oldFrame := tags[:10+n]
		id, body := string(tags[:4]), tags[10:10+n]
		var hit *id3Spec
		for _, sp := range specs {
			if sp.id == id && (id != "TXXX" || strings.EqualFold(id3Descriptor(body), sp.desc)) && (id != "APIC" || apicReplaces(body, apicTotal, apicFront)) {
				hit = sp
				break
			}
		}
		switch {
		case hit == nil:
			updated = append(updated, oldFrame...)
		case hit.seen || tags[8] != 0 || tags[9] != 0:
			return audioEdit{}, errors.New("ambiguous or protected ID3 frame " + id)
		default:
			hit.seen = true
			if hit.write {
				updated = append(updated, id3Frame(version, hit)...)
			}
		}
		tags = tags[len(oldFrame):]
	}
	if len(bytes.Trim(tags, "\x00")) != 0 {
		return audioEdit{}, errors.New("invalid ID3 padding")
	}
	for _, sp := range specs {
		if !sp.seen && sp.write {
			updated = append(updated, id3Frame(version, sp)...)
		}
	}
	updated = append(updated, tags...)
	putSynchsafe(updated[6:10], len(updated)-10)
	return audioEdit{end: end, replacement: updated}, nil
}

// flacUpdate is one Vorbis comment the writer owns; write=false removes it.
type flacUpdate struct {
	key, value string
	write      bool
}

func flacUpdates(ch audioChanges) []flacUpdate {
	var out []flacUpdate
	if ch.title != nil {
		out = append(out, flacUpdate{"TITLE", *ch.title, true})
	}
	for _, f := range []struct {
		key string
		sg  single
	}{{"PUBLISHER", ch.publisher}, {"DATE", ch.published}, {"DESCRIPTION", ch.descr}, {"ISBN", ch.isbn}} {
		if v, w, touched := f.sg.patch(); touched {
			out = append(out, flacUpdate{f.key, v, w})
		}
	}
	return out
}

func editFLAC(r io.ReaderAt, size int64, ch audioChanges) (audioEdit, error) {
	updates := flacUpdates(ch)
	var magic [4]byte
	if _, err := r.ReadAt(magic[:], 0); err != nil || string(magic[:]) != "fLaC" {
		return audioEdit{}, errors.New("expected native FLAC")
	}
	var blocks [][]byte
	var offset int64 = 4
	commentFound := false
	for {
		var h [4]byte
		if _, err := r.ReadAt(h[:], offset); err != nil {
			return audioEdit{}, err
		}
		kind := h[0] & 127
		n := int(h[1])<<16 | int(h[2])<<8 | int(h[3])
		end := offset + 4 + int64(n)
		if end > maxAudioMetadata || end >= size || kind == 127 ||
			(len(blocks) == 0 && (kind != 0 || n != 34)) || (len(blocks) != 0 && kind == 0) {
			return audioEdit{}, errors.New("invalid or oversized FLAC metadata")
		}
		if len(blocks) >= 10000 {
			return audioEdit{}, errors.New("too many FLAC metadata blocks")
		}
		data := make([]byte, n)
		if _, err := r.ReadAt(data, offset+4); err != nil {
			return audioEdit{}, err
		}
		if kind == 4 {
			if commentFound {
				return audioEdit{}, errors.New("multiple FLAC comment blocks")
			}
			var err error
			data, err = flacSet(data, updates)
			if err != nil {
				return audioEdit{}, err
			}
			commentFound = true
		}
		blocks = append(blocks, append([]byte{kind, byte(len(data) >> 16), byte(len(data) >> 8), byte(len(data))}, data...))
		offset = end
		if h[0]&128 != 0 {
			break
		}
	}
	var frame [2]byte
	if _, err := r.ReadAt(frame[:], offset); err != nil || frame[0] != 0xff || frame[1]&0xfe != 0xf8 {
		return audioEdit{}, errors.New("missing native FLAC frame")
	}
	if !commentFound {
		data, err := flacSet([]byte{0, 0, 0, 0, 0, 0, 0, 0}, updates)
		if err != nil {
			return audioEdit{}, err
		}
		if count := binary.LittleEndian.Uint32(data[4:8]); count > 0 { // a clear on a file with no comments writes nothing
			blocks = append(blocks, append([]byte{4, byte(len(data) >> 16), byte(len(data) >> 8), byte(len(data))}, data...))
		}
	}
	blocks[len(blocks)-1][0] |= 128
	return audioEdit{start: 4, end: offset, replacement: bytes.Join(blocks, nil)}, nil
}

func flacSet(data []byte, updates []flacUpdate) ([]byte, error) {
	next := func() ([]byte, bool) {
		if len(data) < 4 {
			return nil, false
		}
		n := int(binary.LittleEndian.Uint32(data))
		if n < 0 || n > len(data)-4 {
			return nil, false
		}
		field := data[:4+n]
		data = data[4+n:]
		return field, true
	}
	vendor, ok := next()
	if !ok || len(data) < 4 {
		return nil, errors.New("invalid FLAC comment header")
	}
	count := binary.LittleEndian.Uint32(data)
	data = data[4:]
	updated := append(bytes.Clone(vendor), 0, 0, 0, 0)
	seen := make([]bool, len(updates))
	kept := uint32(0)
	for i := uint32(0); i < count; i++ {
		field, ok := next()
		if !ok {
			return nil, errors.New("truncated FLAC comment")
		}
		key, _, ok := strings.Cut(string(field[4:]), "=")
		if !ok || key == "" {
			return nil, errors.New("invalid FLAC comment field")
		}
		hit := -1
		for j, u := range updates {
			if strings.EqualFold(key, u.key) {
				hit = j
				break
			}
		}
		if hit < 0 {
			updated = append(updated, field...)
			kept++
			continue
		}
		if seen[hit] {
			return nil, errors.New("ambiguous FLAC comment " + updates[hit].key)
		}
		seen[hit] = true
		if updates[hit].write {
			value := key + "=" + updates[hit].value
			updated = append(binary.LittleEndian.AppendUint32(updated, uint32(len(value))), value...)
			kept++
		}
	}
	for j, u := range updates {
		if !seen[j] && u.write {
			value := u.key + "=" + u.value
			updated = append(binary.LittleEndian.AppendUint32(updated, uint32(len(value))), value...)
			kept++
		}
	}
	if len(data) != 0 || len(updated) > 0xffffff {
		return nil, errors.New("invalid or oversized FLAC comment")
	}
	binary.LittleEndian.PutUint32(updated[len(vendor):], kept)
	return updated, nil
}
