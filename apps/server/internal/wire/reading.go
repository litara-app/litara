package wire

type ReadingPositionWrite struct {
	OperationID  string        `json:"operationId" format:"uuid"`
	BaseRevision string        `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Anchor       EditionAnchor `json:"anchor"`
	CapturedAt   string        `json:"capturedAt" format:"date-time"`
}

type ReadingCompletionWrite struct {
	OperationID    string `json:"operationId" format:"uuid"`
	BaseRevision   string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	FileID         string `json:"fileId" format:"uuid"`
	ContentVersion string `json:"contentVersion" format:"uuid"`
	Event          string `json:"event" enum:"manual_finish,manual_unfinish"`
	CapturedAt     string `json:"capturedAt" format:"date-time"`
}

type ReadingHistoryEntry struct {
	ID             string `json:"id" format:"uuid"`
	EditionID      string `json:"editionId" format:"uuid"`
	TitleID        string `json:"titleId" format:"uuid"`
	FileID         string `json:"fileId" format:"uuid"`
	ContentVersion string `json:"contentVersion" format:"uuid"`
	Event          string `json:"event" enum:"manual_finish,manual_unfinish"`
	CapturedAt     string `json:"capturedAt" format:"date-time"`
	ReceivedAt     string `json:"receivedAt" format:"date-time"`
}

type ReadingHistory struct {
	Items []ReadingHistoryEntry `json:"items" maxItems:"200"`
	Total int64                 `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64                 `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64                 `json:"size" minimum:"1" maximum:"200"`
}

type PersonalConflict struct {
	ID              string            `json:"id" format:"uuid"`
	ResourceKind    string            `json:"resourceKind" enum:"position,completion,annotation,shelf,membership,shelf-order"`
	ResourceID      string            `json:"resourceId" format:"uuid"`
	EditionID       *string           `json:"editionId" format:"uuid" nullable:"true"`
	Reason          string            `json:"reason" enum:"stale_revision,content_changed,locator_incompatible,deleted,access_changed"`
	BaseRevision    string            `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	CurrentRevision string            `json:"currentRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Candidate       PersonalCandidate `json:"candidate"`
	CreatedAt       string            `json:"createdAt" format:"date-time"`
	ResolvedAt      *string           `json:"resolvedAt" format:"date-time" nullable:"true"`
}

type PersonalConflicts struct {
	Items []PersonalConflict `json:"items" maxItems:"200"`
	Total int64              `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64              `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64              `json:"size" minimum:"1" maximum:"200"`
}

type ResolvePersonalConflict struct {
	OperationID    string  `json:"operationId" format:"uuid"`
	BaseRevision   string  `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Choice         string  `json:"choice" enum:"keep_server,use_candidate"`
	ContentVersion *string `json:"contentVersion" format:"uuid" nullable:"true"`
}

type ResolvedPersonalConflict struct {
	ConflictID   string `json:"conflictId" format:"uuid"`
	ResourceKind string `json:"resourceKind" maxLength:"64"`
	ResourceID   string `json:"resourceId" format:"uuid"`
	Revision     string `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	ResolvedAt   string `json:"resolvedAt" format:"date-time"`
}
