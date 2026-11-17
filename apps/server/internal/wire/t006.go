package wire

// T006 management wire types (contracts/t006/openapi.json). Bodies must stay
// byte-compatible with the contract; scripts/contracts/compare.py checks them.

type T006IntegrationSettings struct {
	Revision                    string `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	OpdsEnabled                 bool   `json:"opdsEnabled"`
	EmailEnabled                bool   `json:"emailEnabled"`
	KoreaderEnabled             bool   `json:"koreaderEnabled"`
	MaxAttachmentBytes          int64  `json:"maxAttachmentBytes" minimum:"1" maximum:"104857600"`
	MaxDeliveriesPerUserPerHour int    `json:"maxDeliveriesPerUserPerHour" minimum:"1" maximum:"100"`
	ServerSmtpAvailable         bool   `json:"serverSmtpAvailable"`
}

type T006IntegrationSettingsWrite struct {
	OperationID                 string `json:"operationId" format:"uuid"`
	BaseRevision                string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	OpdsEnabled                 bool   `json:"opdsEnabled"`
	EmailEnabled                bool   `json:"emailEnabled"`
	KoreaderEnabled             bool   `json:"koreaderEnabled"`
	MaxAttachmentBytes          int64  `json:"maxAttachmentBytes" minimum:"1" maximum:"104857600"`
	MaxDeliveriesPerUserPerHour int    `json:"maxDeliveriesPerUserPerHour" minimum:"1" maximum:"100"`
}

type T006Credential struct {
	ID         string  `json:"id" format:"uuid"`
	Kind       string  `json:"kind" enum:"opds,koreader"`
	Username   string  `json:"username" minLength:"1" maxLength:"128"`
	Label      string  `json:"label" minLength:"1" maxLength:"128"`
	CreatedAt  string  `json:"createdAt" format:"date-time"`
	Revoked    bool    `json:"revoked"`
	LastUsedAt *string `json:"lastUsedAt" format:"date-time" nullable:"true"`
}

type T006CredentialList struct {
	Items []T006Credential `json:"items"`
}

type T006CredentialCreate struct {
	OperationID string `json:"operationId" format:"uuid"`
	Kind        string `json:"kind" enum:"opds,koreader"`
	Label       string `json:"label" minLength:"1" maxLength:"128"`
	Password    string `json:"password" pattern:"^[A-Za-z0-9_-]+$" minLength:"32" maxLength:"128"`
}

type T006CredentialRevoke struct {
	OperationID string `json:"operationId" format:"uuid"`
}

type T006Mutation struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
}

type T006DigestBindingWrite struct {
	OperationID    string `json:"operationId" format:"uuid"`
	BaseRevision   string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	CredentialID   string `json:"credentialId" format:"uuid"`
	Document       string `json:"document" pattern:"^[0-9a-f]{32}$"`
	FileID         string `json:"fileId" format:"uuid"`
	ContentVersion string `json:"contentVersion" format:"uuid"`
}

type T006DigestBinding struct {
	ID             string `json:"id" format:"uuid"`
	Revision       string `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	CredentialID   string `json:"credentialId" format:"uuid"`
	Document       string `json:"document" pattern:"^[0-9a-f]{32}$"`
	FileID         string `json:"fileId" format:"uuid"`
	ContentVersion string `json:"contentVersion" format:"uuid"`
	Deleted        bool   `json:"deleted"`
}

type T006DigestBindingList struct {
	Items []T006DigestBinding `json:"items"`
	Page  int                 `json:"page" minimum:"0"`
	Size  int                 `json:"size" minimum:"1" maximum:"200"`
	Total int64               `json:"total" minimum:"0"`
}

type T006KoPositionData struct {
	Document   string  `json:"document" pattern:"^[0-9a-f]{32}$"`
	Progress   string  `json:"progress" minLength:"1" maxLength:"8192"`
	Percentage float64 `json:"percentage" minimum:"0" maximum:"1"`
	Device     string  `json:"device" minLength:"1" maxLength:"256"`
	DeviceID   *string `json:"deviceId" minLength:"1" maxLength:"256" nullable:"true"`
	Timestamp  int64   `json:"timestamp" minimum:"0"`
}

type T006KoPosition struct {
	Revision       string                       `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	FileID         string                       `json:"fileId" format:"uuid"`
	ContentVersion string                       `json:"contentVersion" format:"uuid"`
	Source         string                       `json:"source" enum:"koreader"`
	Position       Nullable[T006KoPositionData] `json:"position"`
}

type T006KoCandidate struct {
	Progress   string  `json:"progress" minLength:"1" maxLength:"8192"`
	Percentage float64 `json:"percentage" minimum:"0" maximum:"1"`
	Device     string  `json:"device" minLength:"1" maxLength:"256"`
	DeviceID   *string `json:"deviceId" minLength:"1" maxLength:"256" nullable:"true"`
}

type T006KoConflict struct {
	ID              string          `json:"id" format:"uuid"`
	Revision        string          `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	FileID          string          `json:"fileId" format:"uuid"`
	ContentVersion  string          `json:"contentVersion" format:"uuid"`
	CredentialID    string          `json:"credentialId" format:"uuid"`
	Reason          string          `json:"reason" enum:"baseline_required,stale_revision,content_changed,unresolved_candidate"`
	Candidate       T006KoCandidate `json:"candidate"`
	CurrentRevision string          `json:"currentRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Resolved        bool            `json:"resolved"`
}

type T006KoConflictList struct {
	Items []T006KoConflict `json:"items"`
	Page  int              `json:"page" minimum:"0"`
	Size  int              `json:"size" minimum:"1" maximum:"200"`
	Total int64            `json:"total" minimum:"0"`
}

type T006KoResolve struct {
	OperationID  string `json:"operationId" format:"uuid"`
	BaseRevision string `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Action       string `json:"action" enum:"keep_server,use_candidate"`
}
