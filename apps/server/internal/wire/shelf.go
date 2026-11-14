package wire

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
)

type T005Predicate struct {
	Kind     string `json:"kind" enum:"predicate"`
	Field    string `json:"field" enum:"title,author,series,language,tag,format,mediaKind,finished,inProgress"`
	Operator string `json:"operator" enum:"equals,contains"`
	Value    string `json:"value" minLength:"1" maxLength:"512"`
}

type T005FilterGroup struct {
	Kind     string       `json:"kind" enum:"all,any"`
	Children []T005Filter `json:"children" minItems:"1" maxItems:"32"`
}

type T005FilterNot struct {
	Kind  string     `json:"kind" enum:"not"`
	Child T005Filter `json:"child"`
}

// T005Filter is exactly one of predicate, all/any group, or not.
type T005Filter struct {
	Predicate *T005Predicate
	Group     *T005FilterGroup
	Not       *T005FilterNot
}

func (f T005Filter) MarshalJSON() ([]byte, error) {
	switch {
	case f.Predicate != nil:
		return json.Marshal(f.Predicate)
	case f.Group != nil:
		return json.Marshal(f.Group)
	case f.Not != nil:
		return json.Marshal(f.Not)
	}
	return nil, errors.New("empty filter")
}

func (f *T005Filter) UnmarshalJSON(b []byte) error {
	var head struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(b, &head); err != nil {
		return err
	}
	*f = T005Filter{}
	dec := func(v any) error {
		d := json.NewDecoder(bytes.NewReader(b))
		d.DisallowUnknownFields()
		return d.Decode(v)
	}
	switch head.Kind {
	case "predicate":
		f.Predicate = new(T005Predicate)
		return dec(f.Predicate)
	case "all", "any":
		f.Group = new(T005FilterGroup)
		return dec(f.Group)
	case "not":
		f.Not = new(T005FilterNot)
		return dec(f.Not)
	}
	return fmt.Errorf("unknown filter kind %q", head.Kind)
}

func (T005Filter) Schema(r huma.Registry) *huma.Schema {
	if _, ok := r.Map()["T005Filter"]; !ok {
		placeholder := &huma.Schema{}
		r.Map()["T005Filter"] = placeholder // registered first so the recursive group/not refs terminate
		ref := func(v any, name string) *huma.Schema { return r.Schema(reflect.TypeOf(v), true, name) }
		*placeholder = huma.Schema{OneOf: []*huma.Schema{ref(T005Predicate{}, "T005Predicate"), ref(T005FilterGroup{}, "T005FilterGroup"), ref(T005FilterNot{}, "T005FilterNot")}}
	}
	return &huma.Schema{Ref: "#/components/schemas/T005Filter"}
}

type T005ShelfData struct {
	Name       string               `json:"name" minLength:"1" maxLength:"256"`
	Visibility string               `json:"visibility" enum:"private,shared"`
	Kind       string               `json:"kind" enum:"manual,smart"`
	Filter     Nullable[T005Filter] `json:"filter"`
}

type T005ShelfWrite struct {
	OperationID  string        `json:"operationId" format:"uuid"`
	BaseRevision string        `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Data         T005ShelfData `json:"data"`
	CapturedAt   string        `json:"capturedAt" format:"date-time"`
}

type T005Shelf struct {
	ID                string                  `json:"id" format:"uuid"`
	Revision          string                  `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	OwnerID           string                  `json:"ownerId" format:"uuid"`
	CanEdit           bool                    `json:"canEdit"`
	Deleted           bool                    `json:"deleted"`
	Data              Nullable[T005ShelfData] `json:"data"`
	VisibleTitleCount int64                   `json:"visibleTitleCount" minimum:"0" maximum:"9007199254740991"`
	Evaluation        string                  `json:"evaluation" enum:"manual,viewer-specific"`
	UpdatedAt         string                  `json:"updatedAt" format:"date-time"`
}

type T005Shelves struct {
	Items []T005Shelf `json:"items" maxItems:"200"`
	Total int64       `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64       `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64       `json:"size" minimum:"1" maximum:"200"`
}

// T005MemberChange is the body of adding or removing one manual-shelf member.
type T005MemberChange struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	CapturedAt   string `json:"capturedAt" format:"date-time"`
}

type T005ShelfOrder struct {
	OperationID     string    `json:"operationId" format:"uuid"`
	BaseRevision    string    `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	VisibleTitleIDs []UUIDStr `json:"visibleTitleIds" maxItems:"10000"`
	CapturedAt      string    `json:"capturedAt" format:"date-time"`
}

// T005MembershipCandidate is the retained add/remove attempt, with the
// normalized action and title the route path carried.
type T005MembershipCandidate struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	CapturedAt   string `json:"capturedAt" format:"date-time"`
	Action       string `json:"action" enum:"add,remove"`
	TitleID      string `json:"titleId" format:"uuid"`
}
