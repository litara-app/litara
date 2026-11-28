package wire

// CSV import of paper books (ADR-0117).

type PaperImportShelf struct {
	Name string `json:"name" maxLength:"100"`
	Rows int64  `json:"rows" minimum:"0" maximum:"10000"`
}

// PaperImportPlan counts what applying the import as it stands would do.
type PaperImportPlan struct {
	NewBook     int64 `json:"newBook" minimum:"0" doc:"Rows that create a book with a paper copy."`
	AddCopy     int64 `json:"addCopy" minimum:"0" doc:"Rows that add a copy to a book in the catalogue."`
	ReadingOnly int64 `json:"readingOnly" minimum:"0" doc:"Rows that only add your rating, review or finish date to a catalogue book."`
	NeedsChoice int64 `json:"needsChoice" minimum:"0" doc:"Rows with a possible match you have not decided. They are skipped as they stand."`
	Already     int64 `json:"already" minimum:"0" doc:"Rows whose book already has this paper copy in the library."`
	NotOwned    int64 `json:"notOwned" minimum:"0"`
	Skipped     int64 `json:"skipped" minimum:"0" doc:"Rows you chose to leave out."`
	Unusable    int64 `json:"unusable" minimum:"0" doc:"Rows with no title."`
	Copies      int64 `json:"copies" minimum:"0" doc:"Paper copies that would be created."`
}

// PaperImportResult counts what an applied import has done so far.
type PaperImportResult struct {
	Added        int64 `json:"added" minimum:"0" doc:"Books created with their copies."`
	Attached     int64 `json:"attached" minimum:"0" doc:"Rows that added copies to a catalogue book."`
	ReadingAdded int64 `json:"readingAdded" minimum:"0"`
	Skipped      int64 `json:"skipped" minimum:"0"`
	Failed       int64 `json:"failed" minimum:"0"`
	Waiting      int64 `json:"waiting" minimum:"0"`
}

type PaperImport struct {
	ID        string `json:"id" format:"uuid"`
	LibraryID string `json:"libraryId" format:"uuid"`
	Source    string `json:"source" enum:"goodreads,litara"`
	State     string `json:"state" enum:"review,applying,completed"`
	Revision  string `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Rows      int64  `json:"rows" minimum:"1" maximum:"10000"`
	// Ownership is the answer to "Which books in this file do you own on paper?". Null until the person answers.
	Ownership      *string            `json:"ownership" enum:"all,owned,shelves,pick" nullable:"true"`
	Shelves        []string           `json:"shelves" maxItems:"200"`
	IncludeReading bool               `json:"includeReading"`
	FileShelves    []PaperImportShelf `json:"fileShelves" maxItems:"200" doc:"Shelves named in the file, most used first. Empty once applied."`
	MarkedOwned    int64              `json:"markedOwned" minimum:"0" doc:"Rows the file marks with at least one owned copy."`
	WithReading    int64              `json:"withReading" minimum:"0" doc:"Rows with a rating, review or reading shelf."`
	Plan           *PaperImportPlan   `json:"plan,omitempty" doc:"While in review."`
	Result         *PaperImportResult `json:"result,omitempty" doc:"Once applying."`
	CreatedAt      string             `json:"createdAt" format:"date-time"`
	ExpiresAt      *string            `json:"expiresAt" format:"date-time" nullable:"true" doc:"When an unapplied import is deleted."`
}

type PaperImports struct {
	Items []PaperImport `json:"items" maxItems:"50"`
}

type PaperImportRow struct {
	Row        int64             `json:"row" minimum:"2"`
	Title      string            `json:"title" maxLength:"2048"`
	Authors    []Str512          `json:"authors" maxItems:"50"`
	ISBN       *string           `json:"isbn" maxLength:"13" nullable:"true"`
	Shelves    []string          `json:"shelves" maxItems:"100"`
	Selected   bool              `json:"selected" doc:"Owned on paper: applying makes copies."`
	Copies     int64             `json:"copies" minimum:"0" maximum:"10" doc:"Copies the row makes if selected."`
	Action     string            `json:"action" enum:"new_book,add_copy,reading_only,needs_choice,already,not_owned,skip,unusable"`
	TitleID    *string           `json:"titleId" format:"uuid" nullable:"true" doc:"The catalogue book the action is for."`
	Choice     *string           `json:"choice" enum:"attach,separate,skip" nullable:"true"`
	Matches    []PaperTitleMatch `json:"matches" maxItems:"20"`
	Problems   []string          `json:"problems" maxItems:"30"`
	Outcome    *string           `json:"outcome" enum:"added,attached,reading_added,skipped,failed" nullable:"true"`
	Detail     *string           `json:"detail" maxLength:"1024" nullable:"true"`
	HasReading bool              `json:"hasReading" doc:"The row has a rating, review or reading shelf."`
}

type PaperImportRows struct {
	Items []PaperImportRow `json:"items" maxItems:"200"`
	Total int64            `json:"total" minimum:"0" maximum:"10000"`
	Page  int64            `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64            `json:"size" minimum:"1" maximum:"200"`
}

// PaperImportOptions replaces the answers for the whole file. A new ownership answer or shelf choice drops the rows
// selected or cleared one at a time.
type PaperImportOptions struct {
	Ownership      *string  `json:"ownership" enum:"all,owned,shelves,pick" nullable:"true"`
	Shelves        []string `json:"shelves,omitempty" maxItems:"200"`
	IncludeReading bool     `json:"includeReading,omitempty" doc:"These are my ratings, reviews and reading. Off unless chosen."`
}

// PaperImportRowChange sets the person's own choices for one row. A member left out is unchanged.
type PaperImportRowChange struct {
	Selected *bool   `json:"selected,omitempty"`
	Choice   *string `json:"choice,omitempty" enum:"auto,attach,separate,skip" doc:"auto returns to the starting choice."`
	TitleID  *string `json:"titleId,omitempty" format:"uuid" doc:"With attach: one of the row's matches."`
}

// ApplyPaperImport applies the import as reviewed at baseRevision.
type ApplyPaperImport struct {
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
}
