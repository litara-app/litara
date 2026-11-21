package wire

// Book details and personal title state (ADR-0081).

// T009EditionDetails is the effective descriptive metadata of one edition: the winning value per field after user
// edits, sidecar and the file's own tags (ADR-0047). A field with no value anywhere is null.
type T009EditionDetails struct {
	EditionID   string  `json:"editionId" format:"uuid"`
	AddedAt     string  `json:"addedAt" format:"date-time"`
	Publisher   *string `json:"publisher" maxLength:"512" nullable:"true"`
	Published   *string `json:"published" pattern:"^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$" nullable:"true"`
	PageCount   *int64  `json:"pageCount" minimum:"1" maximum:"100000" nullable:"true"`
	ISBN        *string `json:"isbn" pattern:"^([0-9]{9}[0-9X]|[0-9]{13})$" nullable:"true"`
	Description *string `json:"description" maxLength:"8000" nullable:"true"`
}

// T009RecordingDetails is the same for an audiobook recording: the effective values of the title the recording belongs to,
// after user edits, sidecar, the files' own tags and providers. An audiobook has no page count.
type T009RecordingDetails struct {
	RecordingID string  `json:"recordingId" format:"uuid"`
	AddedAt     string  `json:"addedAt" format:"date-time"`
	Publisher   *string `json:"publisher" maxLength:"512" nullable:"true"`
	Published   *string `json:"published" pattern:"^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$" nullable:"true"`
	ISBN        *string `json:"isbn" pattern:"^([0-9]{9}[0-9X]|[0-9]{13})$" nullable:"true"`
	Description *string `json:"description" maxLength:"8000" nullable:"true"`
}

// T009PersonalData is what the signed-in person records about a title. Dates here are overrides: null means "use the
// date derived from reading history".
type T009PersonalData struct {
	RatingHalves *int64  `json:"ratingHalves" minimum:"1" maximum:"10" nullable:"true" doc:"Half stars, 1 (half a star) to 10 (five stars); null is unrated."`
	Review       string  `json:"review" maxLength:"20000" doc:"Private to the author; empty is no review."`
	StartedAt    *string `json:"startedAt" format:"date-time" nullable:"true"`
	FinishedAt   *string `json:"finishedAt" format:"date-time" nullable:"true"`
}

type T009Personal struct {
	TitleID           string           `json:"titleId" format:"uuid"`
	Revision          string           `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Data              T009PersonalData `json:"data"`
	DerivedStartedAt  *string          `json:"derivedStartedAt" format:"date-time" nullable:"true"`
	DerivedFinishedAt *string          `json:"derivedFinishedAt" format:"date-time" nullable:"true"`
	UpdatedAt         *string          `json:"updatedAt" format:"date-time" nullable:"true"`
}

type T009PersonalWrite struct {
	OperationID  string           `json:"operationId" format:"uuid"`
	BaseRevision string           `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	CapturedAt   string           `json:"capturedAt" format:"date-time"`
	Data         T009PersonalData `json:"data"`
}
