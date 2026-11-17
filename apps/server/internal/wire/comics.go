package wire

type T005Extraction struct {
	OperationID    string `json:"operationId" format:"uuid"`
	BaseRevision   string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	ContentVersion string `json:"contentVersion" format:"uuid"`
}

type T005Page struct {
	Index       int    `json:"index" minimum:"0" maximum:"9999"`
	EntryID     string `json:"entryId" pattern:"^[a-f0-9]{64}$"`
	MimeType    string `json:"mimeType" enum:"image/jpeg,image/png,image/webp,image/gif,image/avif"`
	Width       int    `json:"width" minimum:"1" maximum:"100000"`
	Height      int    `json:"height" minimum:"1" maximum:"100000"`
	ContentPath string `json:"contentPath" maxLength:"1024"`
}

type T005PageManifest struct {
	FileID          string      `json:"fileId" format:"uuid"`
	ContentVersion  string      `json:"contentVersion" format:"uuid"`
	ManifestVersion string      `json:"manifestVersion" format:"uuid"`
	State           string      `json:"state" enum:"processing,ready,incomplete,unsupported"`
	Pages           []T005Page  `json:"pages" maxItems:"10000"`
	Issues          []T005Issue `json:"issues" maxItems:"100"`
}
