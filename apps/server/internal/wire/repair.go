package wire

type T005RepairFile struct {
	FileID         string `json:"fileId" format:"uuid"`
	ContentVersion string `json:"contentVersion" format:"uuid"`
}

type T005RepairSource struct {
	RecordingID    string `json:"recordingId" format:"uuid"`
	LayoutRevision string `json:"layoutRevision" format:"uuid"`
}

type T005RepairOutput struct {
	Key   string           `json:"key" minLength:"1" maxLength:"64"`
	Label string           `json:"label" minLength:"1" maxLength:"1024"`
	Files []T005RepairFile `json:"files" minItems:"1" maxItems:"10000"`
}

type T005RepairCreate struct {
	OperationID string             `json:"operationId" format:"uuid"`
	Kind        string             `json:"kind" enum:"merge,split"`
	Sources     []T005RepairSource `json:"sources" minItems:"1" maxItems:"100"`
	Outputs     []T005RepairOutput `json:"outputs" minItems:"1" maxItems:"100"`
}

type T005RepairApply struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
}

type T005RepairResult struct {
	Key         string `json:"key" minLength:"1" maxLength:"64"`
	RecordingID string `json:"recordingId" format:"uuid"`
}

type T005RepairPlan struct {
	ID        string             `json:"id" format:"uuid"`
	Revision  string             `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	LibraryID string             `json:"libraryId" format:"uuid"`
	TitleID   string             `json:"titleId" format:"uuid"`
	Kind      string             `json:"kind" enum:"merge,split"`
	State     string             `json:"state" enum:"planned,approved,applied,cancelled,stale"`
	Sources   []T005RepairSource `json:"sources" minItems:"1" maxItems:"100"`
	Outputs   []T005RepairOutput `json:"outputs" minItems:"1" maxItems:"100"`
	Result    []T005RepairResult `json:"result" maxItems:"100"`
	Warnings  []T005Issue        `json:"warnings" maxItems:"100"`
}
