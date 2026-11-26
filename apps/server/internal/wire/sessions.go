package wire

// ReadingSessionWrite is one reading session as the browser knows it so far (ADR-0092). It is sent repeatedly under
// the same session id, and the server keeps the longest active time and the latest end it has seen.
type ReadingSessionWrite struct {
	StartedAt     string `json:"startedAt" format:"date-time"`
	EndedAt       string `json:"endedAt" format:"date-time"`
	ActiveSeconds int64  `json:"activeSeconds" minimum:"0" maximum:"86400" doc:"Seconds the person was actively reading, not the length of the window."`
	// Where the person was as a fraction of the book, when known.
	StartFraction *float64 `json:"startFraction,omitempty" minimum:"0" maximum:"1" nullable:"true"`
	EndFraction   *float64 `json:"endFraction,omitempty" minimum:"0" maximum:"1" nullable:"true"`
}

// ReadingSession is a stored session. Only its owner ever sees it.
type ReadingSession struct {
	ID            string   `json:"id" format:"uuid"`
	EditionID     string   `json:"editionId" format:"uuid"`
	TitleID       string   `json:"titleId" format:"uuid"`
	StartedAt     string   `json:"startedAt" format:"date-time"`
	EndedAt       string   `json:"endedAt" format:"date-time"`
	ActiveSeconds int64    `json:"activeSeconds" minimum:"0" maximum:"86400"`
	StartFraction *float64 `json:"startFraction" minimum:"0" maximum:"1" nullable:"true"`
	EndFraction   *float64 `json:"endFraction" minimum:"0" maximum:"1" nullable:"true"`
}

type ReadingSessions struct {
	Items []ReadingSession `json:"items" maxItems:"200"`
	Total int64            `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64            `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64            `json:"size" minimum:"1" maximum:"200"`
}
