package wire

// T005 edition/title wire shapes (contracts/t005/openapi.json). Go names omit
// the contract's T005 prefix only where noted; JSON shapes are exact.

type EditionIssue struct {
	Code   string `json:"code" maxLength:"128"`
	Detail string `json:"detail" maxLength:"2048"`
}

type Capability struct {
	State  string         `json:"state" enum:"supported,incomplete,unsupported"`
	Issues []EditionIssue `json:"issues" maxItems:"100"`
}

type EditionFile struct {
	ID             string  `json:"id" format:"uuid"`
	ContentVersion string  `json:"contentVersion" format:"uuid"`
	Format         string  `json:"format" enum:"epub,kepub,mobi,azw,azw3,fb2,pdf,cbz,cbr,cb7"`
	MimeType       string  `json:"mimeType" maxLength:"128"`
	SizeBytes      *int64  `json:"sizeBytes" minimum:"0" maximum:"9007199254740991" nullable:"true"`
	Availability   string  `json:"availability" enum:"available,missing,unavailable,unverified"`
	ContentPath    *string `json:"contentPath" pattern:"^/api/v1/files/[0-9a-f-]+/versions/[0-9a-f-]+/content$" nullable:"true"`
}

type ReadingCompletion struct {
	Revision  string  `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Finished  bool    `json:"finished"`
	ChangedAt *string `json:"changedAt" format:"date-time" nullable:"true"`
}

type EditionCapabilities struct {
	Read          Capability `json:"read"`
	Download      Capability `json:"download"`
	Resume        Capability `json:"resume"`
	TextSelection Capability `json:"textSelection"`
	TextHighlight Capability `json:"textHighlight"`
	PageNote      Capability `json:"pageNote"`
	Bookmark      Capability `json:"bookmark"`
}

type Edition struct {
	ID           string              `json:"id" format:"uuid"`
	TitleID      string              `json:"titleId" format:"uuid"`
	LibraryID    string              `json:"libraryId" format:"uuid"`
	Revision     string              `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Label        string              `json:"label" maxLength:"1024"`
	Language     *string             `json:"language" maxLength:"128" nullable:"true"`
	File         EditionFile         `json:"file"`
	Readiness    string              `json:"readiness" enum:"ready,incomplete,unsupported"`
	Issues       []EditionIssue      `json:"issues" maxItems:"100"`
	Completion   ReadingCompletion   `json:"completion"`
	Capabilities EditionCapabilities `json:"capabilities"`
}

type Editions struct {
	Items []Edition `json:"items" maxItems:"200"`
	Total int64     `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64     `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64     `json:"size" minimum:"1" maximum:"200"`
}

type Title struct {
	ID                string   `json:"id" format:"uuid"`
	Title             string   `json:"title" maxLength:"2048"`
	Authors           []Str512 `json:"authors" maxItems:"100"`
	Series            []Str512 `json:"series" maxItems:"100"`
	Languages         []Str128 `json:"languages" maxItems:"100"`
	EditionCount      int64    `json:"editionCount" minimum:"0" maximum:"9007199254740991"`
	RecordingCount    int64    `json:"recordingCount" minimum:"0" maximum:"9007199254740991"`
	PhysicalCopyCount int64    `json:"physicalCopyCount" minimum:"0" maximum:"9007199254740991" doc:"Paper copies in granted libraries (ADR-0116)."`
	LastActivityAt    *string  `json:"lastActivityAt" format:"date-time" nullable:"true"`
}

// TitleRow is one row of the library table: the title plus what the table shows and sorts by.
type TitleRow struct {
	Title
	LibraryIDs   []string `json:"libraryIds" maxItems:"200" doc:"Granted libraries that hold the title." items:"format:uuid"`
	Formats      []string `json:"formats" maxItems:"32" doc:"Ebook formats such as epub or pdf, audio when there is a recording and paper when there is a paper copy."`
	AddedAt      string   `json:"addedAt" format:"date-time" doc:"When the title first appeared in a granted library."`
	SeriesIndex  *float64 `json:"seriesIndex" minimum:"0" nullable:"true"`
	Publisher    *string  `json:"publisher" maxLength:"512" nullable:"true"`
	Published    *string  `json:"published" pattern:"^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$" nullable:"true"`
	PageCount    *int64   `json:"pageCount" minimum:"1" maximum:"100000" nullable:"true"`
	RatingHalves *int64   `json:"ratingHalves" minimum:"1" maximum:"10" nullable:"true" doc:"The caller's own rating in half stars."`
	Status       string   `json:"status" enum:"unread,reading,finished" doc:"The caller's own reading state."`
}

type TitleRows struct {
	Items []TitleRow `json:"items" maxItems:"200"`
	Total int64      `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64      `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64      `json:"size" minimum:"1" maximum:"200"`
}

type Titles struct {
	Items []Title `json:"items" maxItems:"200"`
	Total int64   `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64   `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64   `json:"size" minimum:"1" maximum:"200"`
}

type TitleDetail struct {
	Title          Title  `json:"title"`
	EditionsPath   string `json:"editionsPath" maxLength:"1024"`
	RecordingsPath string `json:"recordingsPath" maxLength:"1024"`
	// The title's own details, as opposed to an edition's or a recording's (ADR-0116).
	Publisher   *string `json:"publisher" maxLength:"512" nullable:"true"`
	Published   *string `json:"published" maxLength:"32" nullable:"true"`
	Description *string `json:"description" maxLength:"8000" nullable:"true"`
}

type RecordingLink struct {
	ID           string `json:"id" format:"uuid"`
	LibraryID    string `json:"libraryId" format:"uuid"`
	Label        string `json:"label" maxLength:"1024"`
	SnapshotPath string `json:"snapshotPath" maxLength:"1024"`
}

type RecordingLinks struct {
	Items []RecordingLink `json:"items" maxItems:"200"`
	Total int64           `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64           `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64           `json:"size" minimum:"1" maximum:"200"`
}

// ReadingPositionState: the typed position arrives with the reading-state slice;
// until then Position is always JSON null.
type ReadingPositionState struct {
	Revision                string                    `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Position                Nullable[ReadingPosition] `json:"position"`
	UnresolvedConflictCount int64                     `json:"unresolvedConflictCount" minimum:"0" maximum:"9007199254740991"`
	ConflictsPath           string                    `json:"conflictsPath" maxLength:"1024"`
}

type ReaderSnapshot struct {
	SchemaVersion int                  `json:"schemaVersion" enum:"1"`
	Edition       Edition              `json:"edition"`
	Position      ReadingPositionState `json:"position"`
	Engine        string               `json:"engine" enum:"foliate,pdfjs,image-pages,none"`
	EngineProfile string               `json:"engineProfile" maxLength:"128"`
	PageManifest  *string              `json:"pageManifestPath" maxLength:"1024" nullable:"true"`
}

// TitleFilter is one node of a filter tree (ADR-0085): a group joins its rules with AND or OR, a rule tests one field.
// A group may hold rules and other groups, to the depth and size the server enforces.
type TitleFilter struct {
	Type     string        `json:"type" enum:"group,rule"`
	Join     string        `json:"join,omitempty" enum:"AND,OR" doc:"For a group: how its rules combine."`
	Rules    []TitleFilter `json:"rules,omitempty" maxItems:"30" doc:"For a group: its rules and nested groups."`
	Field    string        `json:"field,omitempty" enum:"title,author,series,publisher,language,format,tag,status,library,rating,published,added,pages,series_index,has_ebook,has_audio,has_description,has_physical" doc:"For a rule: what to test."`
	Operator string        `json:"operator,omitempty" enum:"is,is_not,contains,not_contains,is_empty,not_empty,gt,gte,lt,lte,between,before,after" doc:"For a rule; which operators a field accepts is checked by the server."`
	Value    any           `json:"value,omitempty" doc:"A string, a number, a boolean or a list of up to 20 strings, by field and operator."`
	ValueTo  any           `json:"valueTo,omitempty" doc:"The upper end for between."`
}

// TitleSearchRequest asks for a page of titles matching a filter tree.
type TitleSearchRequest struct {
	Filter    *TitleFilter `json:"filter,omitempty"`
	Q         string       `json:"q,omitempty" maxLength:"512" doc:"Literal substring over title, authors and series, applied in addition to the tree."`
	LibraryID string       `json:"libraryId,omitempty" format:"uuid"`
	MediaKind string       `json:"mediaKind,omitempty" enum:"ebook,audio"`
	Sort      string       `json:"sort,omitempty" enum:"title,author,series,series_index,publisher,published,language,status,pages,rating,editions,added" doc:"Default title."`
	Order     string       `json:"order,omitempty" enum:"asc,desc" doc:"Default asc."`
	Page      int64        `json:"page,omitempty" minimum:"0" maximum:"9007199254740991"`
	Size      int64        `json:"size,omitempty" minimum:"1" maximum:"200" doc:"Default 24."`
}
