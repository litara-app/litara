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

func editID3(r io.ReaderAt, size int64, title string) (audioEdit, error) {
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
	frame := make([]byte, 10)
	copy(frame, "TIT2")
	if version == 3 {
		frame = append(frame, 1, 0xff, 0xfe) // UTF-16LE with byte-order mark
		for _, char := range utf16.Encode([]rune(title)) {
			frame = binary.LittleEndian.AppendUint16(frame, char)
		}
		binary.BigEndian.PutUint32(frame[4:8], uint32(len(frame)-10))
	} else {
		frame = append(append(frame, 3), title...) // ID3v2.4 UTF-8
		putSynchsafe(frame[4:8], len(frame)-10)
	}
	updated := make([]byte, 10, 10+len(tags)+len(frame))
	copy(updated, "ID3")
	updated[3] = version
	found := false
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
		if string(tags[:4]) == "TIT2" {
			if found || tags[8] != 0 || tags[9] != 0 {
				return audioEdit{}, errors.New("ambiguous or protected ID3 title")
			}
			updated = append(updated, frame...)
			found = true
		} else {
			updated = append(updated, oldFrame...)
		}
		tags = tags[len(oldFrame):]
	}
	if len(bytes.Trim(tags, "\x00")) != 0 {
		return audioEdit{}, errors.New("invalid ID3 padding")
	}
	if !found {
		updated = append(updated, frame...)
	}
	updated = append(updated, tags...)
	putSynchsafe(updated[6:10], len(updated)-10)
	return audioEdit{end: end, replacement: updated}, nil
}

func editFLAC(r io.ReaderAt, size int64, title string) (audioEdit, error) {
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
			data, err = flacTitle(data, title)
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
		data, err := flacTitle([]byte{0, 0, 0, 0, 0, 0, 0, 0}, title)
		if err != nil {
			return audioEdit{}, err
		}
		blocks = append(blocks, append([]byte{4, byte(len(data) >> 16), byte(len(data) >> 8), byte(len(data))}, data...))
	}
	blocks[len(blocks)-1][0] |= 128
	return audioEdit{start: 4, end: offset, replacement: bytes.Join(blocks, nil)}, nil
}

func flacTitle(data []byte, title string) ([]byte, error) {
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
	replacement := "TITLE=" + title
	found := false
	for i := uint32(0); i < count; i++ {
		field, ok := next()
		if !ok {
			return nil, errors.New("truncated FLAC comment")
		}
		key, _, ok := strings.Cut(string(field[4:]), "=")
		if !ok || key == "" {
			return nil, errors.New("invalid FLAC comment field")
		}
		if strings.EqualFold(key, "title") {
			if found {
				return nil, errors.New("ambiguous FLAC title")
			}
			value := key + "=" + title
			field = append(binary.LittleEndian.AppendUint32(nil, uint32(len(value))), value...)
			found = true
		}
		updated = append(updated, field...)
	}
	if !found {
		count++
		updated = append(binary.LittleEndian.AppendUint32(updated, uint32(len(replacement))), replacement...)
	}
	if len(data) != 0 || len(updated) > 0xffffff {
		return nil, errors.New("invalid or oversized FLAC comment")
	}
	binary.LittleEndian.PutUint32(updated[len(vendor):], count)
	return updated, nil
}
