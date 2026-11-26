package wire

// Online author and series data (ADR-0102 to ADR-0106). A lookup saves nothing; applying re-reads the chosen record
// from the provider and saves only what was chosen.

// DirectoryLookup asks the providers enabled for the author's or series' libraries.
type DirectoryLookup struct {
	Fresh bool `json:"fresh,omitempty" doc:"Ignore results cached from the last few minutes."`
}

// AuthorCandidate is one author a provider offers for review.
type AuthorCandidate struct {
	ID        string `json:"id" maxLength:"64"`
	Name      string `json:"name"`
	Detail    string `json:"detail" doc:"A short line to tell people of the same name apart."`
	URL       string `json:"url" format:"uri" doc:"The record on the provider's site."`
	Biography string `json:"biography" maxLength:"8000" doc:"Empty when the provider has none."`
	HasPhoto  bool   `json:"hasPhoto"`
}

// SeriesCandidate is one series found through the books already in the library.
type SeriesCandidate struct {
	ID            string   `json:"id" maxLength:"64"`
	Name          string   `json:"name"`
	URL           string   `json:"url" format:"uri"`
	Authors       []string `json:"authors" maxItems:"5"`
	Description   string   `json:"description" maxLength:"8000" doc:"Empty when the provider has none."`
	BookCount     *int     `json:"bookCount" nullable:"true" minimum:"1"`
	Status        *string  `json:"status" nullable:"true" enum:"ongoing,complete"`
	NumberedBooks int      `json:"numberedBooks" minimum:"0" doc:"Whole-numbered main books the provider lists."`
	MatchedBooks  int      `json:"matchedBooks" minimum:"1" doc:"How many of the books searched point at this series."`
	SearchedBooks int      `json:"searchedBooks" minimum:"1"`
}

// ProviderAuthors is what one provider returned. Status is as for book metadata searches.
type ProviderAuthors struct {
	Provider   string            `json:"provider" enum:"hardcover,open_library"`
	Status     string            `json:"status" enum:"ok,no_match,unavailable,unconfigured"`
	Candidates []AuthorCandidate `json:"candidates" maxItems:"5"`
}

type ProviderSeries struct {
	Provider   string            `json:"provider" enum:"hardcover,open_library"`
	Status     string            `json:"status" enum:"ok,no_match,unavailable,unconfigured"`
	Candidates []SeriesCandidate `json:"candidates" maxItems:"5"`
}

// AuthorLookupResults lists what was asked. Enabled is false when no library of this author enables a provider that
// has author data, and then nothing was contacted.
type AuthorLookupResults struct {
	Enabled bool              `json:"enabled"`
	Results []ProviderAuthors `json:"results" maxItems:"2"`
}

type SeriesLookupResults struct {
	Enabled bool             `json:"enabled"`
	Results []ProviderSeries `json:"results" maxItems:"2"`
}

// DirectoryApply saves chosen values from one candidate under the entry's revision. For a series it also records the
// match, which brings in the books missing from the library; fields may then be empty.
type DirectoryApply struct {
	OperationID  string   `json:"operationId" format:"uuid"`
	BaseRevision string   `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Provider     string   `json:"provider" enum:"hardcover,open_library"`
	CandidateID  string   `json:"candidateId" minLength:"1" maxLength:"64"`
	Fields       []string `json:"fields" maxItems:"5" enum:"biography,description,book_count,status"`
	Photo        bool     `json:"photo,omitempty" doc:"Authors only: also store the candidate's photo."`
}

// SeriesMatch is the provider record a series was matched to.
type SeriesMatch struct {
	Provider string `json:"provider" enum:"hardcover,open_library"`
	Name     string `json:"name"`
	URL      string `json:"url" format:"uri"`
}

// MissingBook is a numbered book of a matched series that none of the viewer's libraries holds. It is display
// information only, not a catalog title.
type MissingBook struct {
	Number       int      `json:"number" minimum:"1"`
	Title        string   `json:"title" maxLength:"512"`
	Authors      []string `json:"authors" maxItems:"5"`
	Released     string   `json:"released" doc:"YYYY or YYYY-MM-DD."`
	URL          string   `json:"url" doc:"The book on the provider's site; empty when unknown."`
	CoverVersion *string  `json:"coverVersion" format:"uuid" nullable:"true" doc:"Set when a cover is stored."`
}

// MissingBooks are those of a matched series. An unmatched one has no match and no items.
type MissingBooks struct {
	Match *SeriesMatch  `json:"match,omitempty"`
	Items []MissingBook `json:"items" maxItems:"100"`
}
