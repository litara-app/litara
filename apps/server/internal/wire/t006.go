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
