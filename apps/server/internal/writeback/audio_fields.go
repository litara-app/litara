package writeback

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/deranjer/ebooker/apps/server/internal/metadata"
)

// audioChanges is what the audio writers can put in a file's own tags (ADR-0081): the title, and the descriptive fields
// publisher, published date, ISBN and description. Each field is replaced, added or (null) removed; every other tag and every
// byte of audio, chapters and artwork is copied unchanged.
type audioChanges struct {
	title                             *string
	publisher, published, isbn, descr single
	// cover is a new front-cover image as JPEG bytes (ADR-0086), supplied by the engine as cover_image.
	cover []byte
}

var (
	audioPublishedRe = regexp.MustCompile(`^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$`)
	audioISBNRe      = regexp.MustCompile(`^(\d{9}[\dX]|\d{13})$`)
)

func parseAudioChanges(f metadata.Fields) (audioChanges, error) {
	var c audioChanges
	for k, raw := range f {
		switch k {
		case metadata.FieldTitle:
			var t string
			if json.Unmarshal(raw, &t) != nil || strings.TrimSpace(t) == "" || strings.ContainsRune(t, 0) || len(t) > 64<<10 {
				return c, errors.New("the title must be a nonempty string up to 64 KiB")
			}
			c.title = &t
		case metadata.FieldPublisher, metadata.FieldPublished, metadata.FieldISBN, metadata.FieldDescription:
			sg, err := parseAudioSingle(k, raw)
			if err != nil {
				return c, err
			}
			switch k {
			case metadata.FieldPublisher:
				c.publisher = sg
			case metadata.FieldPublished:
				c.published = sg
			case metadata.FieldISBN:
				c.isbn = sg
			default:
				c.descr = sg
			}
		case "cover_image":
			img, err := parseCoverImage(raw)
			if err != nil {
				return c, err
			}
			c.cover = img
		default:
			return c, fmt.Errorf("this audio writer accepts only a title, publisher, published date, ISBN, description and cover, not %q", k)
		}
	}
	if c.title == nil && !c.publisher.touched() && !c.published.touched() && !c.isbn.touched() && !c.descr.touched() && c.cover == nil {
		return c, errors.New("no supported change")
	}
	return c, nil
}

func parseAudioSingle(field string, raw json.RawMessage) (single, error) {
	if string(raw) == "null" {
		return single{clear: true}, nil
	}
	var v string
	if err := json.Unmarshal(raw, &v); err != nil || strings.TrimSpace(v) == "" || strings.ContainsRune(v, 0) {
		return single{}, fmt.Errorf("%s must be null or a non-empty string", field)
	}
	v = strings.TrimSpace(v)
	switch field {
	case metadata.FieldPublisher:
		if len([]rune(v)) > 512 {
			return single{}, errors.New("publisher must be at most 512 characters")
		}
	case metadata.FieldPublished:
		if !audioPublishedRe.MatchString(v) {
			return single{}, errors.New("published must be YYYY, YYYY-MM or YYYY-MM-DD")
		}
	case metadata.FieldISBN:
		if !audioISBNRe.MatchString(v) {
			return single{}, errors.New("isbn must be 10 or 13 characters without hyphens")
		}
	case metadata.FieldDescription:
		if len([]rune(v)) > 8000 {
			return single{}, errors.New("description must be at most 8000 characters")
		}
	}
	return single{set: true, val: v}, nil
}

// patch returns the new value for a tag: (value, true) to write it, ("", false) to remove it, and ok=false when untouched.
func (s single) patch() (value string, write, touched bool) {
	switch {
	case s.set:
		return s.val, true, true
	case s.clear:
		return "", false, true
	}
	return "", false, false
}
