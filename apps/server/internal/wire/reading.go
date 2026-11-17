package wire

type T005PositionWrite struct {
	OperationID  string     `json:"operationId" format:"uuid"`
	BaseRevision string     `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Anchor       T005Anchor `json:"anchor"`
	CapturedAt   string     `json:"capturedAt" format:"date-time"`
}

type T005CompletionWrite struct {
	OperationID    string `json:"operationId" format:"uuid"`
	BaseRevision   string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	FileID         string `json:"fileId" format:"uuid"`
	ContentVersion string `json:"contentVersion" format:"uuid"`
	Event          string `json:"event" enum:"manual_finish,manual_unfinish"`
	CapturedAt     string `json:"capturedAt" format:"date-time"`
}

type T005HistoryEntry struct {
	ID             string `json:"id" format:"uuid"`
	EditionID      string `json:"editionId" format:"uuid"`
	TitleID        string `json:"titleId" format:"uuid"`
	FileID         string `json:"fileId" format:"uuid"`
	ContentVersion string `json:"contentVersion" format:"uuid"`
	Event          string `json:"event" enum:"manual_finish,manual_unfinish"`
	CapturedAt     string `json:"capturedAt" format:"date-time"`
	ReceivedAt     string `json:"receivedAt" format:"date-time"`
}

type T005History struct {
	Items []T005HistoryEntry `json:"items" maxItems:"200"`
	Total int64              `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64              `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64              `json:"size" minimum:"1" maximum:"200"`
}

type T005Conflict struct {
	ID              string        `json:"id" format:"uuid"`
	ResourceKind    string        `json:"resourceKind" enum:"position,completion,annotation,shelf,membership,shelf-order"`
	ResourceID      string        `json:"resourceId" format:"uuid"`
	EditionID       *string       `json:"editionId" format:"uuid" nullable:"true"`
	Reason          string        `json:"reason" enum:"stale_revision,content_changed,locator_incompatible,deleted,access_changed"`
	BaseRevision    string        `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	CurrentRevision string        `json:"currentRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Candidate       T005Candidate `json:"candidate"`
	CreatedAt       string        `json:"createdAt" format:"date-time"`
	ResolvedAt      *string       `json:"resolvedAt" format:"date-time" nullable:"true"`
}

type T005Conflicts struct {
	Items []T005Conflict `json:"items" maxItems:"200"`
	Total int64          `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64          `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64          `json:"size" minimum:"1" maximum:"200"`
}

type T005Resolve struct {
	OperationID    string  `json:"operationId" format:"uuid"`
	BaseRevision   string  `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Choice         string  `json:"choice" enum:"keep_server,use_candidate"`
	ContentVersion *string `json:"contentVersion" format:"uuid" nullable:"true"`
}

type T005Resolved struct {
	ConflictID   string `json:"conflictId" format:"uuid"`
	ResourceKind string `json:"resourceKind" maxLength:"64"`
	ResourceID   string `json:"resourceId" format:"uuid"`
	Revision     string `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	ResolvedAt   string `json:"resolvedAt" format:"date-time"`
}
