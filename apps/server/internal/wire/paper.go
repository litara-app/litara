package wire

// Physical copies and paper reading (ADR-0116).

// CopyDetails describe one printing and where it is. Every one is optional.
type CopyDetails struct {
	Binding    *string `json:"binding,omitempty" enum:"hardcover,paperback,other" nullable:"true"`
	ISBN       *string `json:"isbn,omitempty" maxLength:"32" nullable:"true" doc:"ISBN-10 or ISBN-13; hyphens and spaces are removed."`
	Language   *string `json:"language,omitempty" maxLength:"35" nullable:"true"`
	PageCount  *int64  `json:"pageCount,omitempty" minimum:"1" maximum:"100000" nullable:"true"`
	Location   *string `json:"location,omitempty" maxLength:"200" nullable:"true" doc:"Where the copy is kept, in the owner's words."`
	Note       *string `json:"note,omitempty" maxLength:"2000" nullable:"true" doc:"Everyone who can see the copy sees it."`
	AcquiredOn *string `json:"acquiredOn,omitempty" format:"date" nullable:"true"`
}

type PhysicalCopy struct {
	ID        string `json:"id" format:"uuid"`
	TitleID   string `json:"titleId" format:"uuid"`
	LibraryID string `json:"libraryId" format:"uuid"`
	Revision  string `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	CopyDetails
	AddedAt string `json:"addedAt" format:"date-time"`
}

type PhysicalCopies struct {
	Items []PhysicalCopy `json:"items" maxItems:"200"`
	Total int64          `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64          `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64          `json:"size" minimum:"1" maximum:"200"`
}

// NewPaperTitle is the book itself, for a copy of a book that is not in the catalogue yet.
type NewPaperTitle struct {
	Title       string   `json:"title" minLength:"1" maxLength:"2048"`
	Authors     []Str512 `json:"authors,omitempty" maxItems:"50"`
	Series      *string  `json:"series,omitempty" maxLength:"512" nullable:"true"`
	SeriesIndex *float64 `json:"seriesIndex,omitempty" minimum:"0" nullable:"true"`
	Publisher   *string  `json:"publisher,omitempty" maxLength:"512" nullable:"true"`
	Published   *string  `json:"published,omitempty" pattern:"^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$" nullable:"true"`
	Description *string  `json:"description,omitempty" maxLength:"8000" nullable:"true"`
}

// AddPhysicalCopy adds a copy of an existing title (titleId) or of a new one (newTitle); send exactly one.
type AddPhysicalCopy struct {
	OperationID string         `json:"operationId" format:"uuid"`
	LibraryID   string         `json:"libraryId" format:"uuid"`
	TitleID     *string        `json:"titleId,omitempty" format:"uuid" nullable:"true"`
	NewTitle    *NewPaperTitle `json:"newTitle,omitempty"`
	// SeparateFromMatches confirms a new title although the catalogue has books that may be the same one.
	SeparateFromMatches bool        `json:"separateFromMatches,omitempty" doc:"With newTitle: add it as a separate book although the catalogue has possible matches. Without it, possible matches refuse the request with title_match."`
	Copy                CopyDetails `json:"copy"`
}

// UpdatePhysicalCopy replaces a copy's title, library and details. A detail left out is cleared.
type UpdatePhysicalCopy struct {
	OperationID  string      `json:"operationId" format:"uuid"`
	BaseRevision string      `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	TitleID      string      `json:"titleId" format:"uuid"`
	LibraryID    string      `json:"libraryId" format:"uuid"`
	Copy         CopyDetails `json:"copy"`
}

type RemovePhysicalCopy struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
}

type CopyLocations struct {
	Items []string `json:"items" maxItems:"200"`
}

// PaperLookup asks the library's metadata providers about a book, and the catalogue for books that may be the same one.
type PaperLookup struct {
	ISBN    string   `json:"isbn,omitempty" maxLength:"32"`
	Title   string   `json:"title,omitempty" maxLength:"2048"`
	Authors []Str512 `json:"authors,omitempty" maxItems:"50"`
	Fresh   bool     `json:"fresh,omitempty"`
}

type PaperTitleMatch struct {
	TitleID  string   `json:"titleId" format:"uuid"`
	Title    string   `json:"title" maxLength:"2048"`
	Authors  []Str512 `json:"authors" maxItems:"100"`
	Series   *string  `json:"series" maxLength:"512" nullable:"true"`
	SameISBN bool     `json:"sameIsbn" doc:"An ebook or paper copy of it has this ISBN. Otherwise the name and first author match."`
}

type PaperLookupResults struct {
	Enabled bool              `json:"enabled" doc:"The library has at least one metadata provider turned on."`
	Results []ProviderResult  `json:"results" maxItems:"8"`
	Matches []PaperTitleMatch `json:"matches" maxItems:"40"`
}

// PaperReading is the caller's own reading of one copy. Revision 0 means nothing has been recorded.
type PaperReading struct {
	CopyID    string  `json:"copyId" format:"uuid"`
	Revision  string  `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Status    string  `json:"status" enum:"not_started,reading,finished"`
	Page      *int64  `json:"page" minimum:"1" maximum:"100000" nullable:"true"`
	ChangedAt *string `json:"changedAt" format:"date-time" nullable:"true"`
}

// PaperReadingWrite replaces the status and page. A page is never required; leaving it out clears it.
type PaperReadingWrite struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Status       string `json:"status" enum:"not_started,reading,finished"`
	Page         *int64 `json:"page,omitempty" minimum:"1" maximum:"100000" nullable:"true"`
	CapturedAt   string `json:"capturedAt" format:"date-time"`
}

type PaperHistoryEntry struct {
	ID         string `json:"id" format:"uuid"`
	TitleID    string `json:"titleId" format:"uuid"`
	CopyID     string `json:"copyId" format:"uuid"`
	Event      string `json:"event" enum:"started,finished,unfinished"`
	CapturedAt string `json:"capturedAt" format:"date-time"`
	ReceivedAt string `json:"receivedAt" format:"date-time"`
}

type PaperHistory struct {
	Items []PaperHistoryEntry `json:"items" maxItems:"200"`
	Total int64               `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64               `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64               `json:"size" minimum:"1" maximum:"200"`
}
