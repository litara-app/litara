package wire

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
)

// Annotation selections (ADR-0066): a Foliate range or PDF rectangles measured
// as fractions of the unrotated crop box. Both are untrusted display data.

type T005CFIRange struct {
	Kind    string `json:"kind" enum:"foliate-range"`
	Version int    `json:"version" enum:"1"`
	CFI     string `json:"cfi" pattern:"^epubcfi\\(.+\\)$" maxLength:"16384"`
}

type T005Rectangle struct {
	X      float64 `json:"x" minimum:"0" maximum:"1"`
	Y      float64 `json:"y" minimum:"0" maximum:"1"`
	Width  float64 `json:"width" exclusiveMinimum:"0" maximum:"1"`
	Height float64 `json:"height" exclusiveMinimum:"0" maximum:"1"`
}

type T005PDFRange struct {
	Kind       string          `json:"kind" enum:"pdf-rectangles"`
	Version    int             `json:"version" enum:"1"`
	PageIndex  int             `json:"pageIndex" minimum:"0" maximum:"999999"`
	Rectangles []T005Rectangle `json:"rectangles" minItems:"1" maxItems:"256"`
}

// T005Selection is exactly one selection kind.
type T005Selection struct {
	CFI *T005CFIRange
	PDF *T005PDFRange
}

func (s T005Selection) MarshalJSON() ([]byte, error) {
	switch {
	case s.CFI != nil:
		return json.Marshal(s.CFI)
	case s.PDF != nil:
		return json.Marshal(s.PDF)
	}
	return nil, errors.New("empty selection")
}

func (s *T005Selection) UnmarshalJSON(b []byte) error {
	var head struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(b, &head); err != nil {
		return err
	}
	*s = T005Selection{}
	dec := func(v any) error {
		d := json.NewDecoder(bytes.NewReader(b))
		d.DisallowUnknownFields()
		return d.Decode(v)
	}
	switch head.Kind {
	case "foliate-range":
		s.CFI = new(T005CFIRange)
		return dec(s.CFI)
	case "pdf-rectangles":
		s.PDF = new(T005PDFRange)
		return dec(s.PDF)
	}
	return fmt.Errorf("unknown selection kind %q", head.Kind)
}

func (T005Selection) Schema(r huma.Registry) *huma.Schema {
	ref := func(v any, name string) *huma.Schema { return r.Schema(reflect.TypeOf(v), true, name) }
	if _, ok := r.Map()["T005Selection"]; !ok {
		r.Map()["T005Selection"] = &huma.Schema{OneOf: []*huma.Schema{ref(T005CFIRange{}, "T005CFIRange"), ref(T005PDFRange{}, "T005PDFRange")}}
	}
	return &huma.Schema{Ref: "#/components/schemas/T005Selection"}
}

type T005AnnotationData struct {
	Kind      string                  `json:"kind" enum:"highlight,note,bookmark"`
	Anchor    T005Anchor              `json:"anchor"`
	Selection Nullable[T005Selection] `json:"selection"`
	Text      string                  `json:"text" minLength:"0" maxLength:"65536"`
	Quote     string                  `json:"quote" minLength:"0" maxLength:"16384"`
}

type T005AnnotationWrite struct {
	OperationID  string             `json:"operationId" format:"uuid"`
	BaseRevision string             `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Data         T005AnnotationData `json:"data"`
	CapturedAt   string             `json:"capturedAt" format:"date-time"`
}

// T005Delete deletes an annotation or shelf (tombstone) at the stated revision.
type T005Delete struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	CapturedAt   string `json:"capturedAt" format:"date-time"`
}

type T005Annotation struct {
	ID        string                       `json:"id" format:"uuid"`
	EditionID string                       `json:"editionId" format:"uuid"`
	Revision  string                       `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Deleted   bool                         `json:"deleted"`
	Data      Nullable[T005AnnotationData] `json:"data"`
	UpdatedAt string                       `json:"updatedAt" format:"date-time"`
}

type T005Annotations struct {
	Items []T005Annotation `json:"items" maxItems:"200"`
	Total int64            `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64            `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64            `json:"size" minimum:"1" maximum:"200"`
}
