package wire

// ListeningSessionWrite is one stretch of listening as the player knows it so far (ADR-0109). It is sent repeatedly
// under the same session id, and the server keeps the longest listened time and the latest end it has seen.
type ListeningSessionWrite struct {
	StartedAt       string `json:"startedAt" format:"date-time"`
	EndedAt         string `json:"endedAt" format:"date-time"`
	ListenedSeconds int64  `json:"listenedSeconds" minimum:"0" maximum:"86400" doc:"Wall-clock seconds during which audio played; playback speed does not change it."`
	// Where the listener was as a fraction of the recording, when known.
	StartFraction *float64 `json:"startFraction,omitempty" minimum:"0" maximum:"1" nullable:"true"`
	EndFraction   *float64 `json:"endFraction,omitempty" minimum:"0" maximum:"1" nullable:"true"`
}

// ListeningSession is a stored session. Only its owner ever sees it.
type ListeningSession struct {
	ID              string   `json:"id" format:"uuid"`
	RecordingID     string   `json:"recordingId" format:"uuid"`
	TitleID         string   `json:"titleId" format:"uuid"`
	StartedAt       string   `json:"startedAt" format:"date-time"`
	EndedAt         string   `json:"endedAt" format:"date-time"`
	ListenedSeconds int64    `json:"listenedSeconds" minimum:"0" maximum:"86400"`
	StartFraction   *float64 `json:"startFraction" minimum:"0" maximum:"1" nullable:"true"`
	EndFraction     *float64 `json:"endFraction" minimum:"0" maximum:"1" nullable:"true"`
}

type ListeningSessions struct {
	Items []ListeningSession `json:"items" maxItems:"200"`
	Total int64              `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64              `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64              `json:"size" minimum:"1" maximum:"200"`
}

// AudioBookmarkData is a bookmarked place (ADR-0110): a file version and offset under one recording layout.
type AudioBookmarkData struct {
	FileID         string `json:"fileId" format:"uuid"`
	ContentVersion string `json:"contentVersion" format:"uuid"`
	OffsetMs       int64  `json:"offsetMs" minimum:"0" maximum:"9007199254740991"`
	LayoutRevision string `json:"layoutRevision" format:"uuid"`
	Note           string `json:"note" maxLength:"4096"`
}

type AudioBookmarkWrite struct {
	OperationID  string            `json:"operationId" format:"uuid"`
	BaseRevision string            `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Data         AudioBookmarkData `json:"data"`
	CapturedAt   string            `json:"capturedAt" format:"date-time"`
}

type AudioBookmark struct {
	ID          string `json:"id" format:"uuid"`
	RecordingID string `json:"recordingId" format:"uuid"`
	Revision    string `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Deleted     bool   `json:"deleted"`
	// Data is null once the bookmark is deleted.
	Data Nullable[AudioBookmarkData] `json:"data"`
	// Available is false when the file or the recording's layout changed since the bookmark was made. The place is kept
	// but must not be opened as if it still pointed at the same audio.
	Available bool   `json:"available"`
	CreatedAt string `json:"createdAt" format:"date-time"`
	UpdatedAt string `json:"updatedAt" format:"date-time"`
}

type AudioBookmarks struct {
	Items []AudioBookmark `json:"items" maxItems:"200"`
	Total int64           `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64           `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64           `json:"size" minimum:"1" maximum:"200"`
}

// AudioBookmarkConflict is a bookmark write that was not applied and waits for its owner's choice.
type AudioBookmarkConflict struct {
	ID         string `json:"id" format:"uuid"`
	BookmarkID string `json:"bookmarkId" format:"uuid"`
	Reason     string `json:"reason" enum:"stale_revision,content_changed,layout_changed,deleted"`
	// Candidate is the attempted bookmark, or null when the attempt was a deletion.
	Candidate       Nullable[AudioBookmarkData] `json:"candidate"`
	BaseRevision    string                      `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	CurrentRevision string                      `json:"currentRevision" pattern:"^(0|[1-9][0-9]*)$"`
	CreatedAt       string                      `json:"createdAt" format:"date-time"`
}

type AudioBookmarkConflicts struct {
	Items []AudioBookmarkConflict `json:"items" maxItems:"200"`
}

type AudioBookmarkResolve struct {
	OperationID string `json:"operationId" format:"uuid"`
	Choice      string `json:"choice" enum:"keep_current,use_candidate"`
	// BaseRevision is the bookmark's revision the choice was made against; "0" when it does not exist.
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
}
