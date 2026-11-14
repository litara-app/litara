package wire

import "encoding/json"

// ---- scans ---------------------------------------------------------------

type ScanRun struct {
	ID          string  `json:"id" format:"uuid"`
	LibraryID   string  `json:"libraryId" format:"uuid"`
	Trigger     string  `json:"trigger" enum:"schedule,event,manual,verify"`
	State       string  `json:"state" enum:"queued,running,completed,failed,skipped"`
	Health      *string `json:"health,omitempty" enum:"healthy,unavailable,identity_mismatch"`
	FilesSeen   int     `json:"filesSeen"`
	CreatedAt   string  `json:"createdAt" format:"date-time"`
	CompletedAt *string `json:"completedAt,omitempty" format:"date-time"`
	Failure     *string `json:"failure,omitempty"`
}

type ScanRunList struct {
	Items []ScanRun `json:"items"`
}

type StartScan struct {
	Verify bool `json:"verify,omitempty" doc:"Also re-hash every file to detect changed bytes with unchanged size and time."`
}

// ---- reviews ---------------------------------------------------------------

type Review struct {
	ID         string         `json:"id" format:"uuid"`
	Kind       string         `json:"kind" enum:"move,grouping,ordering,association,provider,import,write"`
	SubjectKey string         `json:"subjectKey"`
	Candidates map[string]any `json:"candidates"`
	CreatedAt  string         `json:"createdAt" format:"date-time"`
}

type ReviewList struct {
	Items []Review `json:"items"`
}

// ReviewResolution is the reviewer's decision; the allowed actions depend on the item kind.
type ReviewResolution struct {
	Action        string   `json:"action" enum:"move,keep_separate,order,link,group_as_one,choose,apply,reject"`
	MissingFileID string   `json:"missingFileId,omitempty" format:"uuid"`
	NewPath       string   `json:"newPath,omitempty" maxLength:"4096"`
	Files         []string `json:"files,omitempty" maxItems:"10000"`
	TitleID       string   `json:"titleId,omitempty" format:"uuid"`
	Path          string   `json:"path,omitempty" maxLength:"4096"`
	Index         *int     `json:"index,omitempty" minimum:"0" maximum:"4"`
}

// ---- metadata ------------------------------------------------------------------

type MetadataConflict struct {
	Source string          `json:"source" enum:"user,sidecar,embedded,provider"`
	Value  json.RawMessage `json:"value" doc:"The suppressed value." type:"object" additionalProperties:"true"`
}

type MetadataField struct {
	Field     string             `json:"field" enum:"title,authors,series_name,series_index,narrators"`
	Source    string             `json:"source" enum:"user,sidecar,embedded,provider"`
	Cleared   bool               `json:"cleared"`
	Value     json.RawMessage    `json:"value,omitempty" doc:"Absent when the field was deliberately cleared." type:"object" additionalProperties:"true"`
	Conflicts []MetadataConflict `json:"conflicts,omitempty"`
}

type MetadataReport struct {
	Fields []MetadataField `json:"fields"`
}

// SetMetadata stores a protected edit (value) or a protected clear (clear=true).
type SetMetadata struct {
	Value json.RawMessage `json:"value,omitempty" type:"object" additionalProperties:"true"`
	Clear bool            `json:"clear,omitempty"`
}

// ---- imports ---------------------------------------------------------------------

type PlanImport struct {
	SourcePath string `json:"sourcePath" minLength:"1" maxLength:"4096" doc:"Absolute directory on the server; read-only and never modified."`
}

type ImportItem struct {
	ID          string  `json:"id" format:"uuid"`
	SourceRel   string  `json:"sourceRel"`
	SizeBytes   int64   `json:"sizeBytes"`
	TargetRel   string  `json:"targetRel"`
	Suffixed    bool    `json:"suffixed" doc:"The target name was changed to avoid overwriting an existing file."`
	DuplicateOf *string `json:"duplicateOf,omitempty" format:"uuid"`
	Decision    string  `json:"decision" enum:"pending,import,skip"`
	State       string  `json:"state" enum:"planned,copying,verified,published,failed,skipped"`
	Detail      *string `json:"detail,omitempty"`
}

type ImportPlan struct {
	ID         string       `json:"id" format:"uuid"`
	LibraryID  string       `json:"libraryId" format:"uuid"`
	SourcePath string       `json:"sourcePath"`
	State      string       `json:"state" enum:"planned,approved,running,completed,failed,cancelled"`
	Items      []ImportItem `json:"items"`
}

type ImportDecision struct {
	Decision string `json:"decision" enum:"import,skip"`
}

// ---- write-back --------------------------------------------------------------------

type PlanInFile struct {
	Changes map[string]json.RawMessage `json:"changes" minProperties:"1" doc:"Fields to write: title, authors, series_name, series_index, narrators."`
}

type Writeback struct {
	ID        string          `json:"id" format:"uuid"`
	LibraryID string          `json:"libraryId" format:"uuid"`
	Kind      string          `json:"kind" enum:"sidecar,in_file"`
	Format    *string         `json:"format,omitempty"`
	Target    string          `json:"target"`
	Stage     string          `json:"stage" enum:"planned,approved,staged,validated,backed_up,published,recovered,abandoned,refused"`
	Detail    *string         `json:"detail,omitempty"`
	BackedUp  bool            `json:"backedUp"`
	Diff      json.RawMessage `json:"diff" type:"object" additionalProperties:"true"`
}

type WriterCapability struct {
	Format  string `json:"format" enum:"epub,mp3,flac,m4a,m4b"`
	Enabled bool   `json:"enabled"`
}

type WriterCapabilityList struct {
	Items []WriterCapability `json:"items"`
}
