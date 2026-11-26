package wire

// DirectoryAuthor is one author in the author directory (ADR-0100): a name, matched ignoring case, with the number of
// titles the viewer can see. Name is the most common spelling among those titles.
type DirectoryAuthor struct {
	Name         string `json:"name"`
	Titles       int64  `json:"titles" minimum:"1"`
	CoverTitleID string `json:"coverTitleId" format:"uuid" doc:"A title of this author whose cover can stand for them."`
}

type DirectoryAuthors struct {
	Items []DirectoryAuthor `json:"items" maxItems:"200"`
	Total int64             `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64             `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64             `json:"size" minimum:"1" maximum:"200"`
}

// DirectorySeries is one series in the series directory (ADR-0100).
type DirectorySeries struct {
	Name         string   `json:"name"`
	Titles       int64    `json:"titles" minimum:"1"`
	CoverTitleID string   `json:"coverTitleId" format:"uuid" doc:"The earliest title in series order."`
	Authors      []string `json:"authors" maxItems:"3" doc:"Up to three first authors of the series' titles."`
}

type DirectorySeriesPage struct {
	Items []DirectorySeries `json:"items" maxItems:"200"`
	Total int64             `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64             `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64             `json:"size" minimum:"1" maximum:"200"`
}
