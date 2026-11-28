package wire

import (
	"bytes"
	"encoding/json"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
)

// MetadataValue is a string, a string array, a nonnegative number or null.
type MetadataValue struct{ Raw json.RawMessage }

func (v MetadataValue) MarshalJSON() ([]byte, error) {
	if len(bytes.TrimSpace(v.Raw)) == 0 {
		return []byte("null"), nil
	}
	return v.Raw, nil
}

func (v *MetadataValue) UnmarshalJSON(b []byte) error {
	v.Raw = append(v.Raw[:0], b...)
	return nil
}

func (MetadataValue) Schema(r huma.Registry) *huma.Schema {
	if _, ok := r.Map()["MetadataValue"]; !ok {
		// The string cap is the longest field, the 8,000-character description (metadata.MaxDescription). Shorter
		// per-field limits are checked by the service, which knows the field.
		zero, s8000, s1024, n100 := 0, 8000, 1024, 100
		min0 := 0.0
		r.Map()["MetadataValue"] = &huma.Schema{OneOf: []*huma.Schema{
			{Type: "string", MinLength: &zero, MaxLength: &s8000},
			{Type: "array", Items: &huma.Schema{Type: "string", MinLength: &zero, MaxLength: &s1024}, MinItems: &zero, MaxItems: &n100},
			{Type: "number", Minimum: &min0},
			{Type: "null"},
		}}
	}
	return &huma.Schema{Ref: "#/components/schemas/MetadataValue"}
}

type MetadataEvidence struct {
	Source string        `json:"source" enum:"user,sidecar,embedded,provider,filename"`
	Value  MetadataValue `json:"value"`
}

type EditionMetadataField struct {
	Field     string             `json:"field" enum:"title,authors,series_name,series_index,language,tags,publisher,published,page_count,isbn,description,subtitle,genres,moods,age_rating,asin,open_library_id,google_books_id,hardcover_id,goodreads_id,public_rating,public_rating_count"`
	Source    string             `json:"source" enum:"user,sidecar,embedded,provider,filename"`
	Cleared   bool               `json:"cleared"`
	Value     MetadataValue      `json:"value"`
	Conflicts []MetadataEvidence `json:"conflicts" maxItems:"100"`
	// Locked is the person's lock (ADR-0097). It is separate from the source: an edit is not locked unless locked.
	Locked bool `json:"locked"`
}

type EditionMetadataReport struct {
	EditionID string                 `json:"editionId" format:"uuid"`
	Revision  string                 `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Fields    []EditionMetadataField `json:"fields" maxItems:"100"`
}

type EditionMetadataWrite struct {
	OperationID  string        `json:"operationId" format:"uuid"`
	BaseRevision string        `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Clear        bool          `json:"clear"`
	Value        MetadataValue `json:"value"`
}

type EditionMetadataRemove struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
}

type EditionLink struct {
	OperationID  string  `json:"operationId" format:"uuid"`
	BaseRevision string  `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	TitleID      *string `json:"titleId" format:"uuid" nullable:"true"`
}

var _ = reflect.TypeOf

// ProviderQuery is the only data sent to a metadata provider (ADR-0049).
// Omitted or empty members use the edition's effective title, authors and ISBN.
type ProviderQuery struct {
	Title   string   `json:"title,omitempty" maxLength:"512"`
	Authors []string `json:"authors,omitempty" maxItems:"20"`
	ISBN    string   `json:"isbn,omitempty" maxLength:"13"`
	// ASIN is used for audiobooks only (Audnexus); an edition search ignores it.
	ASIN string `json:"asin,omitempty" maxLength:"10"`
}

// ProviderSearch asks the library's enabled providers for candidates.
type ProviderSearch struct {
	Query ProviderQuery `json:"query"`
	// Fresh skips the short-lived search cache and refreshes it.
	Fresh bool `json:"fresh,omitempty"`
	// Providers limits the search to some of the library's enabled providers. Empty searches all of them.
	Providers []string `json:"providers,omitempty" maxItems:"5" uniqueItems:"true" items.enum:"open_library,google_books,audnexus,hardcover,goodreads" doc:"Search only these providers, which must also be enabled for the library. Omit to search every enabled provider."`
}

// ProviderCandidate is one result to review; Consistent never authorizes an automatic change.
type ProviderCandidate struct {
	ID           string                   `json:"id" maxLength:"256"`
	ByIdentifier bool                     `json:"byIdentifier"`
	Consistent   bool                     `json:"consistent"`
	Fields       map[string]MetadataValue `json:"fields" maxProperties:"11"`
}

type ProviderResult struct {
	Provider string `json:"provider" enum:"open_library,google_books,audnexus,hardcover,goodreads"`
	// Status is unconfigured when the library lists a provider the operator has not set up (for example Hardcover without a token).
	Status string `json:"status" enum:"ok,no_match,unavailable,unconfigured"`
	// Cached is true when the candidates came from the short-lived search cache.
	Cached     bool                `json:"cached"`
	Candidates []ProviderCandidate `json:"candidates" maxItems:"5"`
}

// ProviderSearchResults reports the query that was sent, whether any provider is enabled for the library, and each provider's result.
type ProviderSearchResults struct {
	EditionID string           `json:"editionId" format:"uuid"`
	Enabled   bool             `json:"enabled"`
	Query     ProviderQuery    `json:"query"`
	Results   []ProviderResult `json:"results" maxItems:"8"`
}

// RecordingProviderSearchResults is the audiobook counterpart of ProviderSearchResults.
type RecordingProviderSearchResults struct {
	RecordingID string           `json:"recordingId" format:"uuid"`
	Enabled     bool             `json:"enabled"`
	Query       ProviderQuery    `json:"query"`
	Results     []ProviderResult `json:"results" maxItems:"8"`
}

// EditionAutoFill asks the server to fill an edition's empty fields from an unambiguous identifier match (ADR-0060/0087).
type EditionAutoFill struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	// DryRun returns what would be filled without storing anything, so a person can review it and save what they keep (ADR-0090).
	DryRun bool `json:"dryRun,omitempty"`
}

// AutoFillResult says what auto-fill did. Outcome filled means the listed fields were stored as provider values;
// the others mean nothing changed: nothing_to_fill (a match but no empty field), needs_review (candidates exist but
// none was an exact, consistent identifier match), no_match, or disabled (the library has no provider enabled).
type AutoFillResult struct {
	Outcome  string   `json:"outcome" enum:"filled,proposed,nothing_to_fill,needs_review,no_match,disabled"`
	Provider string   `json:"provider,omitempty" enum:"open_library,google_books,audnexus,hardcover,goodreads"`
	Filled   []string `json:"filled" maxItems:"11"`
	// Rule is how the match was accepted: identifier (ADR-0060) or title_author (ADR-0090, a per-library setting).
	Rule string `json:"rule,omitempty" enum:"identifier,title_author"`
	// Proposed holds the values a dry run would fill, keyed by field. Outcome proposed means nothing was stored.
	Proposed map[string]MetadataValue `json:"proposed,omitempty"`
	// Revision is the revision a save of this result must be based on: the edition's revision, or for a recording the
	// title's metadata revision.
	Revision string `json:"revision,omitempty" pattern:"^(0|[1-9][0-9]*)$"`
}
