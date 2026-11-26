package wire

// DirectoryAuthor is one author in the author directory (ADR-0100): a name, matched ignoring case, with the number of
// titles the viewer can see. Name is the most common spelling among those titles.
type DirectoryAuthor struct {
	Name         string `json:"name"`
	Titles       int64  `json:"titles" minimum:"1"`
	CoverTitleID string `json:"coverTitleId" format:"uuid" doc:"A title of this author whose cover can stand for them."`
	SeriesCount  int64  `json:"seriesCount" minimum:"0" doc:"How many series this author's visible titles belong to."`
}

type DirectoryAuthors struct {
	Items []DirectoryAuthor `json:"items" maxItems:"200"`
	Total int64             `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64             `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64             `json:"size" minimum:"1" maximum:"200"`
}

// DirectorySeries is one series in the series directory (ADR-0100).
type DirectorySeries struct {
	Name         string           `json:"name"`
	Titles       int64            `json:"titles" minimum:"1"`
	CoverTitleID string           `json:"coverTitleId" format:"uuid" doc:"The earliest title in series order."`
	Authors      []string         `json:"authors" maxItems:"3" doc:"Up to three first authors of the series' titles."`
	Covers       []DirectoryCover `json:"covers" maxItems:"5" doc:"Up to five titles in series order, for a stack of covers."`
	Finished     int64            `json:"finished" minimum:"0" doc:"How many of the visible titles the caller has finished."`
}

// DirectoryCover names one title whose cover stands in a series stack.
type DirectoryCover struct {
	TitleID string `json:"titleId" format:"uuid"`
	Title   string `json:"title" maxLength:"2048"`
	Medium  string `json:"medium" enum:"ebook,audio" doc:"Which cover to show: the ebook one when the caller can see an ebook."`
}

// ContinueReading is the title an author or series page offers to continue (ADR-0104). Every field is null when there
// is nothing left to read.
type ContinueReading struct {
	TitleID *string `json:"titleId" format:"uuid" nullable:"true"`
	Title   *string `json:"title" maxLength:"2048" nullable:"true"`
	Medium  *string `json:"medium" enum:"ebook,audio" nullable:"true" doc:"What to open: the one used most recently, or the ebook of an unread title."`
	State   *string `json:"state" enum:"reading,unread" nullable:"true"`
}

type DirectorySeriesPage struct {
	Items []DirectorySeries `json:"items" maxItems:"200"`
	Total int64             `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64             `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64             `json:"size" minimum:"1" maximum:"200"`
}
