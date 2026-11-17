package wire

import (
	"encoding/json"
	"errors"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
)

// T005Candidate is the retained attempted write; exactly one member is set.
type T005Candidate struct {
	Position   *T005PositionWrite
	Completion *T005CompletionWrite
	Annotation *T005AnnotationWrite
	Delete     *T005Delete
	Shelf      *T005ShelfWrite
	Order      *T005ShelfOrder
	Membership *T005MembershipCandidate
}

func (c T005Candidate) MarshalJSON() ([]byte, error) {
	switch {
	case c.Position != nil:
		return json.Marshal(c.Position)
	case c.Completion != nil:
		return json.Marshal(c.Completion)
	case c.Annotation != nil:
		return json.Marshal(c.Annotation)
	case c.Delete != nil:
		return json.Marshal(c.Delete)
	case c.Shelf != nil:
		return json.Marshal(c.Shelf)
	case c.Order != nil:
		return json.Marshal(c.Order)
	case c.Membership != nil:
		return json.Marshal(c.Membership)
	}
	return nil, errors.New("empty candidate")
}

// UnmarshalJSON picks the member by its distinguishing property.
func (c *T005Candidate) UnmarshalJSON(b []byte) error {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(b, &probe); err != nil {
		return err
	}
	*c = T005Candidate{}
	has := func(k string) bool { _, ok := probe[k]; return ok }
	switch {
	case has("anchor"):
		c.Position = new(T005PositionWrite)
		return json.Unmarshal(b, c.Position)
	case has("event"):
		c.Completion = new(T005CompletionWrite)
		return json.Unmarshal(b, c.Completion)
	case has("visibleTitleIds"):
		c.Order = new(T005ShelfOrder)
		return json.Unmarshal(b, c.Order)
	case has("titleId"):
		c.Membership = new(T005MembershipCandidate)
		return json.Unmarshal(b, c.Membership)
	case has("data"):
		var d struct {
			Data map[string]json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(b, &d); err != nil {
			return err
		}
		if _, shelf := d.Data["filter"]; shelf {
			c.Shelf = new(T005ShelfWrite)
			return json.Unmarshal(b, c.Shelf)
		}
		c.Annotation = new(T005AnnotationWrite)
		return json.Unmarshal(b, c.Annotation)
	}
	c.Delete = new(T005Delete)
	return json.Unmarshal(b, c.Delete)
}

func (T005Candidate) Schema(r huma.Registry) *huma.Schema {
	ref := func(v any, name string) *huma.Schema { return r.Schema(reflect.TypeOf(v), true, name) }
	return &huma.Schema{OneOf: []*huma.Schema{
		ref(T005PositionWrite{}, "T005PositionWrite"), ref(T005CompletionWrite{}, "T005CompletionWrite"),
		ref(T005AnnotationWrite{}, "T005AnnotationWrite"), ref(T005Delete{}, "T005Delete"),
		ref(T005ShelfWrite{}, "T005ShelfWrite"), ref(T005ShelfOrder{}, "T005ShelfOrder"),
		ref(T005MembershipCandidate{}, "T005MembershipCandidate")}}
}
