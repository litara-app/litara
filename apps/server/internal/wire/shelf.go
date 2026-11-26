package wire

type ShelfData struct {
	Name       string                `json:"name" minLength:"1" maxLength:"256"`
	Visibility string                `json:"visibility" enum:"private,shared"`
	Kind       string                `json:"kind" enum:"manual,smart"`
	Filter     Nullable[TitleFilter] `json:"filter" doc:"For a smart shelf, a filter in the library search format; null for a manual shelf."`
}

type ShelfWrite struct {
	OperationID  string    `json:"operationId" format:"uuid"`
	BaseRevision string    `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Data         ShelfData `json:"data"`
	CapturedAt   string    `json:"capturedAt" format:"date-time"`
}

type Shelf struct {
	ID                string              `json:"id" format:"uuid"`
	Revision          string              `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	OwnerID           string              `json:"ownerId" format:"uuid"`
	CanEdit           bool                `json:"canEdit"`
	Deleted           bool                `json:"deleted"`
	Data              Nullable[ShelfData] `json:"data"`
	VisibleTitleCount int64               `json:"visibleTitleCount" minimum:"0" maximum:"9007199254740991"`
	Evaluation        string              `json:"evaluation" enum:"manual,viewer-specific"`
	UpdatedAt         string              `json:"updatedAt" format:"date-time"`
}

type Shelves struct {
	Items []Shelf `json:"items" maxItems:"200"`
	Total int64   `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64   `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64   `json:"size" minimum:"1" maximum:"200"`
}

// MemberChange is the body of adding or removing one manual-shelf member.
type MemberChange struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	CapturedAt   string `json:"capturedAt" format:"date-time"`
}

type ShelfOrder struct {
	OperationID     string    `json:"operationId" format:"uuid"`
	BaseRevision    string    `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	VisibleTitleIDs []UUIDStr `json:"visibleTitleIds" maxItems:"10000"`
	CapturedAt      string    `json:"capturedAt" format:"date-time"`
}

// MembershipCandidate is the retained add/remove attempt, with the
// normalized action and title the route path carried.
type MembershipCandidate struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	CapturedAt   string `json:"capturedAt" format:"date-time"`
	Action       string `json:"action" enum:"add,remove"`
	TitleID      string `json:"titleId" format:"uuid"`
}
