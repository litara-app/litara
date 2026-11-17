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

type T006SmtpReport struct {
	Revision     string `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Configured   bool   `json:"configured"`
	Enabled      bool   `json:"enabled"`
	Host         string `json:"host" minLength:"0" maxLength:"253"`
	Port         int    `json:"port" minimum:"1" maximum:"65535"`
	TLSMode      string `json:"tlsMode" enum:"starttls,implicit,local_test_plain"`
	Username     string `json:"username" minLength:"0" maxLength:"320"`
	FromAddress  string `json:"fromAddress" minLength:"0" maxLength:"320"`
	HasPassword  bool   `json:"hasPassword"`
	KeyAvailable bool   `json:"keyAvailable"`
}

type T006SmtpWrite struct {
	OperationID  string  `json:"operationId" format:"uuid"`
	BaseRevision string  `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Enabled      bool    `json:"enabled"`
	Host         string  `json:"host" pattern:"^[^\\r\\n]*$" minLength:"1" maxLength:"253"`
	Port         int     `json:"port" minimum:"1" maximum:"65535"`
	TLSMode      string  `json:"tlsMode" enum:"starttls,implicit,local_test_plain"`
	Username     string  `json:"username" pattern:"^[^\\r\\n]*$" minLength:"0" maxLength:"320"`
	FromAddress  string  `json:"fromAddress" format:"email" pattern:"^[^\\r\\n]*$" maxLength:"320"`
	SecretAction string  `json:"secretAction" enum:"keep,replace,clear"`
	Password     *string `json:"password" minLength:"1" maxLength:"4096" nullable:"true"`
}

type T006ConnectionTest struct {
	Success bool   `json:"success"`
	Code    string `json:"code" minLength:"1" maxLength:"128"`
	Detail  string `json:"detail" minLength:"0" maxLength:"1024"`
}

type T006RecipientData struct {
	Name    string `json:"name" pattern:"^[^\\r\\n]*$" minLength:"1" maxLength:"128"`
	Address string `json:"address" format:"email" pattern:"^[^\\r\\n]*$" maxLength:"320"`
}

type T006RecipientWrite struct {
	OperationID  string            `json:"operationId" format:"uuid"`
	BaseRevision string            `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Data         T006RecipientData `json:"data"`
}

type T006Recipient struct {
	ID       string                      `json:"id" format:"uuid"`
	Revision string                      `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Deleted  bool                        `json:"deleted"`
	Data     Nullable[T006RecipientData] `json:"data"`
}

type T006RecipientList struct {
	Items []T006Recipient `json:"items"`
}

type T006TransportState struct {
	Available bool   `json:"available"`
	Revision  string `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
}

type T006TransportList struct {
	Server   T006TransportState `json:"server"`
	Personal T006TransportState `json:"personal"`
}

type T006DeliveryCreate struct {
	OperationID                  string  `json:"operationId" format:"uuid"`
	FileID                       string  `json:"fileId" format:"uuid"`
	ContentVersion               string  `json:"contentVersion" format:"uuid"`
	RecipientID                  string  `json:"recipientId" format:"uuid"`
	RecipientRevision            string  `json:"recipientRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Transport                    string  `json:"transport" enum:"server,personal"`
	TransportRevision            string  `json:"transportRevision" pattern:"^(0|[1-9][0-9]*)$"`
	ResendOf                     *string `json:"resendOf" format:"uuid" nullable:"true"`
	AcknowledgePossibleDuplicate bool    `json:"acknowledgePossibleDuplicate"`
}

type T006Delivery struct {
	ID               string  `json:"id" format:"uuid"`
	Revision         string  `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	FileID           string  `json:"fileId" format:"uuid"`
	ContentVersion   string  `json:"contentVersion" format:"uuid"`
	RecipientID      string  `json:"recipientId" format:"uuid"`
	RecipientName    string  `json:"recipientName" minLength:"1" maxLength:"128"`
	RecipientAddress string  `json:"recipientAddress" format:"email"`
	Transport        string  `json:"transport" enum:"server,personal"`
	State            string  `json:"state" enum:"queued,sending,retry_wait,accepted,failed,outcome_unknown,cancelled"`
	Attempts         int     `json:"attempts" minimum:"0"`
	CreatedAt        string  `json:"createdAt" format:"date-time"`
	UpdatedAt        string  `json:"updatedAt" format:"date-time"`
	Code             *string `json:"code" minLength:"1" maxLength:"128" nullable:"true"`
	ResendOf         *string `json:"resendOf" format:"uuid" nullable:"true"`
}

type T006DeliveryList struct {
	Items []T006Delivery `json:"items"`
	Page  int            `json:"page" minimum:"0"`
	Size  int            `json:"size" minimum:"1" maximum:"200"`
	Total int64          `json:"total" minimum:"0"`
}
