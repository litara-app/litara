package wire

import (
	"bytes"
	"encoding/json"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
)

// T005MetadataValue is a string, a string array, a nonnegative number or null.
type T005MetadataValue struct{ Raw json.RawMessage }

func (v T005MetadataValue) MarshalJSON() ([]byte, error) {
	if len(bytes.TrimSpace(v.Raw)) == 0 {
		return []byte("null"), nil
	}
	return v.Raw, nil
}

func (v *T005MetadataValue) UnmarshalJSON(b []byte) error {
	v.Raw = append(v.Raw[:0], b...)
	return nil
}

func (T005MetadataValue) Schema(r huma.Registry) *huma.Schema {
	if _, ok := r.Map()["T005MetadataValue"]; !ok {
		zero, s4096, s1024, n100 := 0, 4096, 1024, 100
		min0 := 0.0
		r.Map()["T005MetadataValue"] = &huma.Schema{OneOf: []*huma.Schema{
			{Type: "string", MinLength: &zero, MaxLength: &s4096},
			{Type: "array", Items: &huma.Schema{Type: "string", MinLength: &zero, MaxLength: &s1024}, MinItems: &zero, MaxItems: &n100},
			{Type: "number", Minimum: &min0},
			{Type: "null"},
		}}
	}
	return &huma.Schema{Ref: "#/components/schemas/T005MetadataValue"}
}

type T005MetadataEvidence struct {
	Source string            `json:"source" enum:"user,sidecar,embedded,provider,filename"`
	Value  T005MetadataValue `json:"value"`
}

type T005MetadataField struct {
	Field     string                 `json:"field" enum:"title,authors,series_name,series_index,language,tags,publisher,published,page_count,isbn,description"`
	Source    string                 `json:"source" enum:"user,sidecar,embedded,provider,filename"`
	Cleared   bool                   `json:"cleared"`
	Value     T005MetadataValue      `json:"value"`
	Conflicts []T005MetadataEvidence `json:"conflicts" maxItems:"100"`
}

type T005MetadataReport struct {
	EditionID string              `json:"editionId" format:"uuid"`
	Revision  string              `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Fields    []T005MetadataField `json:"fields" maxItems:"100"`
}

type T005MetadataWrite struct {
	OperationID  string            `json:"operationId" format:"uuid"`
	BaseRevision string            `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Clear        bool              `json:"clear"`
	Value        T005MetadataValue `json:"value"`
}

type T005MetadataRemove struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
}

type T005EditionLink struct {
	OperationID  string  `json:"operationId" format:"uuid"`
	BaseRevision string  `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	TitleID      *string `json:"titleId" format:"uuid" nullable:"true"`
}

var _ = reflect.TypeOf
