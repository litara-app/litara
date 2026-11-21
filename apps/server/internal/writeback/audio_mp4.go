package writeback

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"strings"
)

const mp4Title = "\xa9nam"

type mp4Box struct {
	start, body, end int64
	kind             string
}

func readMP4Box(r io.ReaderAt, start, limit int64) (mp4Box, error) {
	if limit-start < 8 {
		return mp4Box{}, errors.New("truncated MP4 box")
	}
	var h [16]byte
	if _, err := r.ReadAt(h[:8], start); err != nil {
		return mp4Box{}, err
	}
	n := uint64(binary.BigEndian.Uint32(h[:4]))
	header := uint64(8)
	switch n {
	case 0:
		n = uint64(limit - start)
	case 1:
		if limit-start < 16 {
			return mp4Box{}, errors.New("truncated extended MP4 box")
		}
		if _, err := r.ReadAt(h[8:], start+8); err != nil {
			return mp4Box{}, err
		}
		n, header = binary.BigEndian.Uint64(h[8:]), 16
	}
	if n < header || n > uint64(limit-start) {
		return mp4Box{}, errors.New("invalid MP4 box length")
	}
	return mp4Box{start, start + int64(header), start + int64(n), string(h[4:8])}, nil
}

func editMP4(r io.ReaderAt, size int64, ch audioChanges) (audioEdit, error) {
	var moov mp4Box
	hasMedia := false
	for pos := int64(0); pos < size; {
		box, err := readMP4Box(r, pos, size)
		if err != nil {
			return audioEdit{}, err
		}
		if pos == 0 && (box.kind != "ftyp" || box.end-box.body < 8) {
			return audioEdit{}, errors.New("expected an ISO media file type box")
		}
		switch box.kind {
		case "moov":
			if moov.end != 0 || box.end-box.start > maxAudioMetadata {
				return audioEdit{}, errors.New("multiple or oversized MP4 movie boxes")
			}
			moov = box
		case "mdat":
			hasMedia = hasMedia || box.end > box.body
		case "ftyp", "free", "skip", "wide":
		default:
			return audioEdit{}, errors.New("unsupported MP4 top-level box: " + box.kind)
		}
		pos = box.end
	}
	if !hasMedia || moov.end == 0 {
		return audioEdit{}, errors.New("missing MP4 movie or media data")
	}
	data := make([]byte, moov.end-moov.body)
	if _, err := r.ReadAt(data, moov.body); err != nil {
		return audioEdit{}, err
	}
	if hasUnsupportedMP4Box(data) {
		return audioEdit{}, errors.New("compressed, fragmented or protected MP4 metadata is unsupported")
	}
	updated, err := editMP4Movie(data, ch)
	if err != nil {
		return audioEdit{}, err
	}
	if bytes.Equal(data, updated) {
		return audioEdit{}, nil
	}
	newMovie := mp4Atom("moov", updated)
	if moov.end == size {
		return audioEdit{start: moov.start, end: moov.end, replacement: newMovie}, nil
	}
	// Preserve all absolute media offsets in fast-start files. The old moov
	// becomes a same-length free box, and the updated moov goes at EOF.
	// A size-zero last box would otherwise swallow the appended movie.
	var topHeader [4]byte
	for pos := moov.end; pos < size; {
		if _, err := r.ReadAt(topHeader[:], pos); err != nil || binary.BigEndian.Uint32(topHeader[:]) == 0 {
			return audioEdit{}, errors.New("cannot append metadata after an open-ended MP4 box")
		}
		box, err := readMP4Box(r, pos, size)
		if err != nil {
			return audioEdit{}, err
		}
		pos = box.end
	}
	free := make([]byte, moov.end-moov.start)
	binary.BigEndian.PutUint32(free, uint32(len(free)))
	copy(free[4:], "free")
	return audioEdit{start: moov.start, end: moov.end, replacement: free, suffix: newMovie}, nil
}

// Restricted boxes can occur within sample-entry layouts, including opaque
// codec descriptors. Check the preceding box size as well as the identifier
// so ordinary text containing one of these strings remains writable.
func hasUnsupportedMP4Box(data []byte) bool {
	for _, kind := range []string{"cmov", "mvex", "enca", "encv", "sinf"} {
		for pos := 4; pos < len(data); {
			i := bytes.Index(data[pos:], []byte(kind))
			if i < 0 {
				break
			}
			start := pos + i - 4
			r := bytes.NewReader(data)
			if n := binary.BigEndian.Uint32(data[start:]); n != 0 {
				if _, err := readMP4Box(r, int64(start), int64(len(data))); err == nil {
					return true
				}
			}
			pos += i + 4
		}
	}
	return false
}

func editMP4Movie(data []byte, ch audioChanges) ([]byte, error) {
	return editMP4Child(data, "udta", func(udta []byte, _ bool) ([]byte, error) {
		return editMP4Child(udta, "meta", func(meta []byte, present bool) ([]byte, error) {
			if !present {
				handler := make([]byte, 25)
				copy(handler[8:], "mdirappl")
				meta = append(make([]byte, 4), mp4Atom("hdlr", handler)...)
			}
			if len(meta) < 4 || binary.BigEndian.Uint32(meta) != 0 {
				return nil, errors.New("unsupported MP4 metadata version or flags")
			}
			handlerFound := false
			// Find the iTunes metadata handler without changing its bytes.
			for pos := int64(4); pos < int64(len(meta)); {
				box, err := readMP4Box(bytes.NewReader(meta), pos, int64(len(meta)))
				if err != nil {
					return nil, err
				}
				if box.kind == "hdlr" {
					if handlerFound || box.end-box.body < 12 || string(meta[box.body+8:box.body+12]) != "mdir" {
						return nil, errors.New("unsupported or ambiguous MP4 metadata handler")
					}
					handlerFound = true
				}
				pos = box.end
			}
			if !handlerFound {
				return nil, errors.New("missing MP4 metadata handler")
			}
			ilst, err := editMP4Child(meta[4:], "ilst", func(ilst []byte, _ bool) ([]byte, error) {
				return editIlst(ilst, ch)
			})
			return append(make([]byte, 4), ilst...), err
		})
	})
}

func editMP4Child(data []byte, kind string, edit func([]byte, bool) ([]byte, error)) ([]byte, error) {
	var selected mp4Box
	for pos := int64(0); pos < int64(len(data)); {
		box, err := readMP4Box(bytes.NewReader(data), pos, int64(len(data)))
		if err != nil {
			return nil, err
		}
		if binary.BigEndian.Uint32(data[pos:]) == 0 {
			return nil, errors.New("unsupported open-ended MP4 metadata child")
		}
		if box.kind == kind {
			if selected.end != 0 {
				return nil, errors.New("ambiguous MP4 metadata: duplicate " + kind)
			}
			selected = box
		}
		pos = box.end
	}
	present := selected.end != 0
	if !present {
		selected.start, selected.body, selected.end = int64(len(data)), int64(len(data)), int64(len(data))
	}
	payload, err := edit(data[selected.body:selected.end], present)
	if err != nil {
		return nil, err
	}
	return bytes.Join([][]byte{data[:selected.start], mp4Atom(kind, payload), data[selected.end:]}, nil), nil
}

func mp4Atom(kind string, data []byte) []byte {
	out := make([]byte, 8, len(data)+8)
	binary.BigEndian.PutUint32(out, uint32(len(data)+8))
	copy(out[4:], kind)
	return append(out, data...)
}

// mp4Target is one item in the iTunes metadata list the writer owns: a four-character atom, or a freeform "----" atom
// named under the com.apple.iTunes namespace. write=false removes it.
type mp4Target struct {
	kind, name string
	value      string
	write      bool
	seen       bool
	image      []byte // covr only: the JPEG of the cover
}

func mp4Targets(ch audioChanges) []*mp4Target {
	var out []*mp4Target
	if ch.title != nil {
		out = append(out, &mp4Target{kind: mp4Title, value: *ch.title, write: true})
	}
	for _, f := range []struct {
		kind, name string
		sg         single
	}{{"\xa9day", "", ch.published}, {"desc", "", ch.descr}, {"----", "PUBLISHER", ch.publisher}, {"----", "ISBN", ch.isbn}} {
		if v, w, touched := f.sg.patch(); touched {
			out = append(out, &mp4Target{kind: f.kind, name: f.name, value: v, write: w})
		}
	}
	if ch.cover != nil {
		out = append(out, &mp4Target{kind: "covr", image: ch.cover, write: true})
	}
	return out
}

// validCoverItem checks that an existing covr item holds exactly one JPEG or PNG picture, so replacing it loses nothing.
func validCoverItem(body []byte) error {
	pictures := 0
	for pos := int64(0); pos < int64(len(body)); {
		box, err := readMP4Box(bytes.NewReader(body), pos, int64(len(body)))
		if err != nil {
			return err
		}
		if box.kind != "data" || box.end-box.body < 8 {
			return errors.New("unsupported MP4 cover layout")
		}
		if t := binary.BigEndian.Uint32(body[box.body:]); t != 13 && t != 14 {
			return errors.New("the MP4 cover is not a JPEG or PNG picture")
		}
		pictures++
		pos = box.end
	}
	if pictures != 1 {
		return errors.New("the MP4 file holds several cover pictures; replacing one would drop the others")
	}
	return nil
}

func (t *mp4Target) item() []byte {
	if t.kind == "covr" {
		return mp4Atom("covr", mp4Atom("data", append([]byte{0, 0, 0, 13, 0, 0, 0, 0}, t.image...)))
	}
	data := mp4Atom("data", append([]byte{0, 0, 0, 1, 0, 0, 0, 0}, t.value...))
	if t.kind != "----" {
		return mp4Atom(t.kind, data)
	}
	mean := mp4Atom("mean", append(make([]byte, 4), "com.apple.iTunes"...))
	name := mp4Atom("name", append(make([]byte, 4), t.name...))
	return mp4Atom("----", bytes.Join([][]byte{mean, name, data}, nil))
}

// freeformName returns the namespace and name of a "----" item body.
func freeformName(body []byte) (mean, name string) {
	for pos := int64(0); pos < int64(len(body)); {
		box, err := readMP4Box(bytes.NewReader(body), pos, int64(len(body)))
		if err != nil {
			return "", ""
		}
		if box.end-box.body >= 4 {
			switch box.kind {
			case "mean":
				mean = string(body[box.body+4 : box.end])
			case "name":
				name = string(body[box.body+4 : box.end])
			}
		}
		pos = box.end
	}
	return mean, name
}

// validTextItem checks that an existing item holds exactly one UTF-8 text value, so replacing it loses nothing.
func validTextItem(body []byte, freeform bool) error {
	var data int
	for pos := int64(0); pos < int64(len(body)); {
		box, err := readMP4Box(bytes.NewReader(body), pos, int64(len(body)))
		if err != nil {
			return err
		}
		switch {
		case box.kind == "data":
			data++
			if box.end-box.body < 8 || binary.BigEndian.Uint64(body[box.body:]) != 1<<32 {
				return errors.New("unsupported MP4 text encoding")
			}
		case freeform && (box.kind == "mean" || box.kind == "name"):
		default:
			return errors.New("unsupported MP4 metadata item layout")
		}
		pos = box.end
	}
	if data != 1 {
		return errors.New("unsupported MP4 metadata item with multiple values")
	}
	return nil
}

func editIlst(ilst []byte, ch audioChanges) ([]byte, error) {
	targets := mp4Targets(ch)
	var out []byte
	for pos := int64(0); pos < int64(len(ilst)); {
		box, err := readMP4Box(bytes.NewReader(ilst), pos, int64(len(ilst)))
		if err != nil {
			return nil, err
		}
		if binary.BigEndian.Uint32(ilst[pos:]) == 0 {
			return nil, errors.New("unsupported open-ended MP4 metadata child")
		}
		body := ilst[box.body:box.end]
		var hit *mp4Target
		for _, tg := range targets {
			if tg.kind != box.kind {
				continue
			}
			if tg.kind == "----" {
				mean, name := freeformName(body)
				if !strings.EqualFold(mean, "com.apple.iTunes") || !strings.EqualFold(name, tg.name) {
					continue
				}
			}
			hit = tg
			break
		}
		if hit == nil {
			out = append(out, ilst[box.start:box.end]...)
		} else {
			if hit.seen {
				return nil, errors.New("ambiguous MP4 metadata: duplicate " + hit.kind)
			}
			if hit.kind == "covr" {
				if err := validCoverItem(body); err != nil {
					return nil, err
				}
			} else if err := validTextItem(body, hit.kind == "----"); err != nil {
				return nil, errors.New("unsupported MP4 title encoding or multiple title values: " + err.Error())
			}
			hit.seen = true
			if hit.write {
				out = append(out, hit.item()...)
			}
		}
		pos = box.end
	}
	for _, tg := range targets {
		if !tg.seen && tg.write {
			out = append(out, tg.item()...)
		}
	}
	return out, nil
}
