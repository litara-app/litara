package wire

import (
	"encoding/json"
	"errors"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
)

// PersonalCandidate is the retained attempted write; exactly one member is set.
type PersonalCandidate struct {
	Position   *ReadingPositionWrite
	Completion *ReadingCompletionWrite
	Annotation *AnnotationWrite
	Delete     *RevisionedDelete
	Shelf      *ShelfWrite
	Order      *ShelfOrder
	Membership *MembershipCandidate
}

func (c PersonalCandidate) MarshalJSON() ([]byte, error) {
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
func (c *PersonalCandidate) UnmarshalJSON(b []byte) error {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(b, &probe); err != nil {
		return err
	}
	*c = PersonalCandidate{}
	has := func(k string) bool { _, ok := probe[k]; return ok }
	switch {
	case has("anchor"):
		c.Position = new(ReadingPositionWrite)
		return json.Unmarshal(b, c.Position)
	case has("event"):
		c.Completion = new(ReadingCompletionWrite)
		return json.Unmarshal(b, c.Completion)
	case has("visibleTitleIds"):
		c.Order = new(ShelfOrder)
		return json.Unmarshal(b, c.Order)
	case has("titleId"):
		c.Membership = new(MembershipCandidate)
		return json.Unmarshal(b, c.Membership)
	case has("data"):
		var d struct {
			Data map[string]json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(b, &d); err != nil {
			return err
		}
		if _, shelf := d.Data["filter"]; shelf {
			c.Shelf = new(ShelfWrite)
			return json.Unmarshal(b, c.Shelf)
		}
		c.Annotation = new(AnnotationWrite)
		return json.Unmarshal(b, c.Annotation)
	}
	c.Delete = new(RevisionedDelete)
	return json.Unmarshal(b, c.Delete)
}

func (PersonalCandidate) Schema(r huma.Registry) *huma.Schema {
	ref := func(v any, name string) *huma.Schema { return r.Schema(reflect.TypeOf(v), true, name) }
	return &huma.Schema{OneOf: []*huma.Schema{
		ref(ReadingPositionWrite{}, "ReadingPositionWrite"), ref(ReadingCompletionWrite{}, "ReadingCompletionWrite"),
		ref(AnnotationWrite{}, "AnnotationWrite"), ref(RevisionedDelete{}, "RevisionedDelete"),
		ref(ShelfWrite{}, "ShelfWrite"), ref(ShelfOrder{}, "ShelfOrder"),
		ref(MembershipCandidate{}, "MembershipCandidate")}}
}
