package wire

// T005 edition/title wire shapes (contracts/t005/openapi.json). Go names omit
// the contract's T005 prefix only where noted; JSON shapes are exact.

type T005Issue struct {
	Code   string `json:"code" maxLength:"128"`
	Detail string `json:"detail" maxLength:"2048"`
}

type T005Capability struct {
	State  string      `json:"state" enum:"supported,incomplete,unsupported"`
	Issues []T005Issue `json:"issues" maxItems:"100"`
}

type T005File struct {
	ID             string  `json:"id" format:"uuid"`
	ContentVersion string  `json:"contentVersion" format:"uuid"`
	Format         string  `json:"format" enum:"epub,kepub,mobi,azw,azw3,fb2,pdf,cbz,cbr,cb7"`
	MimeType       string  `json:"mimeType" maxLength:"128"`
	SizeBytes      *int64  `json:"sizeBytes" minimum:"0" maximum:"9007199254740991" nullable:"true"`
	Availability   string  `json:"availability" enum:"available,missing,unavailable,unverified"`
	ContentPath    *string `json:"contentPath" pattern:"^/api/v1/files/[0-9a-f-]+/versions/[0-9a-f-]+/content$" nullable:"true"`
}

type T005Completion struct {
	Revision  string  `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Finished  bool    `json:"finished"`
	ChangedAt *string `json:"changedAt" format:"date-time" nullable:"true"`
}

type T005Capabilities struct {
	Read          T005Capability `json:"read"`
	Download      T005Capability `json:"download"`
	Resume        T005Capability `json:"resume"`
	TextSelection T005Capability `json:"textSelection"`
	TextHighlight T005Capability `json:"textHighlight"`
	PageNote      T005Capability `json:"pageNote"`
	Bookmark      T005Capability `json:"bookmark"`
}

type T005Edition struct {
	ID           string           `json:"id" format:"uuid"`
	TitleID      string           `json:"titleId" format:"uuid"`
	LibraryID    string           `json:"libraryId" format:"uuid"`
	Revision     string           `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Label        string           `json:"label" maxLength:"1024"`
	Language     *string          `json:"language" maxLength:"128" nullable:"true"`
	File         T005File         `json:"file"`
	Readiness    string           `json:"readiness" enum:"ready,incomplete,unsupported"`
	Issues       []T005Issue      `json:"issues" maxItems:"100"`
	Completion   T005Completion   `json:"completion"`
	Capabilities T005Capabilities `json:"capabilities"`
}

type T005Editions struct {
	Items []T005Edition `json:"items" maxItems:"200"`
	Total int64         `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64         `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64         `json:"size" minimum:"1" maximum:"200"`
}

type T005Title struct {
	ID             string   `json:"id" format:"uuid"`
	Title          string   `json:"title" maxLength:"2048"`
	Authors        []Str512 `json:"authors" maxItems:"100"`
	Series         []Str512 `json:"series" maxItems:"100"`
	Languages      []Str128 `json:"languages" maxItems:"100"`
	EditionCount   int64    `json:"editionCount" minimum:"0" maximum:"9007199254740991"`
	RecordingCount int64    `json:"recordingCount" minimum:"0" maximum:"9007199254740991"`
	LastActivityAt *string  `json:"lastActivityAt" format:"date-time" nullable:"true"`
}

type T005Titles struct {
	Items []T005Title `json:"items" maxItems:"200"`
	Total int64       `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64       `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64       `json:"size" minimum:"1" maximum:"200"`
}

type T005TitleDetail struct {
	Title          T005Title `json:"title"`
	EditionsPath   string    `json:"editionsPath" maxLength:"1024"`
	RecordingsPath string    `json:"recordingsPath" maxLength:"1024"`
}

type T005RecordingLink struct {
	ID           string `json:"id" format:"uuid"`
	LibraryID    string `json:"libraryId" format:"uuid"`
	Label        string `json:"label" maxLength:"1024"`
	SnapshotPath string `json:"snapshotPath" maxLength:"1024"`
}

type T005RecordingLinks struct {
	Items []T005RecordingLink `json:"items" maxItems:"200"`
	Total int64               `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64               `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64               `json:"size" minimum:"1" maximum:"200"`
}

// T005PositionState: the typed position arrives with the reading-state slice;
// until then Position is always JSON null.
type T005PositionState struct {
	Revision                string  `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Position                Nullable[T005Position] `json:"position"`
	UnresolvedConflictCount int64   `json:"unresolvedConflictCount" minimum:"0" maximum:"9007199254740991"`
	ConflictsPath           string  `json:"conflictsPath" maxLength:"1024"`
}

type T005Reader struct {
	SchemaVersion int               `json:"schemaVersion" enum:"1"`
	Edition       T005Edition       `json:"edition"`
	Position      T005PositionState `json:"position"`
	Engine        string            `json:"engine" enum:"foliate,pdfjs,image-pages,none"`
	EngineProfile string            `json:"engineProfile" maxLength:"128"`
	PageManifest  *string           `json:"pageManifestPath" maxLength:"1024" nullable:"true"`
}
