package wire

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
)

// Str512 and Str128 are strings with the item-level bounds the contract puts
// on array elements (Huma cannot express those through struct tags).
type Str512 string

func (Str512) Schema(huma.Registry) *huma.Schema {
	zero, max := 0, 512
	return &huma.Schema{Type: "string", MinLength: &zero, MaxLength: &max}
}

type Str128 string

func (Str128) Schema(huma.Registry) *huma.Schema {
	zero, max := 0, 128
	return &huma.Schema{Type: "string", MinLength: &zero, MaxLength: &max}
}

// Typed locator version 1 (ADR-0065). Server validation checks syntax, size,
// kind/profile and known bounds; it cannot prove a CFI resolves.

type CFILocator struct {
	Kind    string `json:"kind" enum:"foliate-cfi"`
	Version int    `json:"version" enum:"1"`
	CFI     string `json:"cfi" pattern:"^epubcfi\\(.+\\)$" maxLength:"16384"`
}

type PDFLocator struct {
	Kind      string  `json:"kind" enum:"pdf-page"`
	Version   int     `json:"version" enum:"1"`
	PageIndex int     `json:"pageIndex" minimum:"0" maximum:"999999"`
	X         float64 `json:"x" minimum:"0" maximum:"1"`
	Y         float64 `json:"y" minimum:"0" maximum:"1"`
}

type ComicLocator struct {
	Kind            string `json:"kind" enum:"comic-page"`
	Version         int    `json:"version" enum:"1"`
	PageIndex       int    `json:"pageIndex" minimum:"0" maximum:"9999"`
	EntryID         string `json:"entryId" pattern:"^[a-f0-9]{64}$"`
	ManifestVersion string `json:"manifestVersion" format:"uuid"`
}

// Locator is exactly one of the three locator kinds.
type Locator struct {
	CFI   *CFILocator
	PDF   *PDFLocator
	Comic *ComicLocator
}

func (l Locator) MarshalJSON() ([]byte, error) {
	switch {
	case l.CFI != nil:
		return json.Marshal(l.CFI)
	case l.PDF != nil:
		return json.Marshal(l.PDF)
	case l.Comic != nil:
		return json.Marshal(l.Comic)
	}
	return nil, errors.New("empty locator")
}

func (l *Locator) UnmarshalJSON(b []byte) error {
	var head struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(b, &head); err != nil {
		return err
	}
	*l = Locator{}
	dec := func(v any) error {
		d := json.NewDecoder(bytes.NewReader(b))
		d.DisallowUnknownFields()
		return d.Decode(v)
	}
	switch head.Kind {
	case "foliate-cfi":
		l.CFI = new(CFILocator)
		return dec(l.CFI)
	case "pdf-page":
		l.PDF = new(PDFLocator)
		return dec(l.PDF)
	case "comic-page":
		l.Comic = new(ComicLocator)
		return dec(l.Comic)
	}
	return fmt.Errorf("unknown locator kind %q", head.Kind)
}

func (Locator) Schema(r huma.Registry) *huma.Schema {
	ref := func(v any, name string) *huma.Schema { return r.Schema(reflect.TypeOf(v), true, name) }
	if _, ok := r.Map()["Locator"]; !ok {
		r.Map()["Locator"] = &huma.Schema{OneOf: []*huma.Schema{ref(CFILocator{}, "CFILocator"), ref(PDFLocator{}, "PDFLocator"), ref(ComicLocator{}, "ComicLocator")}}
	}
	return &huma.Schema{Ref: "#/components/schemas/Locator"}
}

type EditionAnchor struct {
	FileID         string  `json:"fileId" format:"uuid"`
	ContentVersion string  `json:"contentVersion" format:"uuid"`
	Locator        Locator `json:"locator"`
}

type ReadingPosition struct {
	Anchor     EditionAnchor `json:"anchor"`
	CapturedAt string        `json:"capturedAt" format:"date-time"`
	ReceivedAt string        `json:"receivedAt" format:"date-time"`
	DeviceName string        `json:"deviceName" maxLength:"256"`
}

// UUIDStr is a string array element constrained to the uuid format.
type UUIDStr string

func (UUIDStr) Schema(huma.Registry) *huma.Schema {
	return &huma.Schema{Type: "string", Format: "uuid"}
}
