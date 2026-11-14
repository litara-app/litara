package wire

// LibraryConfig is the per-library ingestion configuration (ADR-0050/0054/0058/0059).
// Backups default off (ADR-0051/0057); symlinks default excluded (ADR-0059).
type LibraryConfig struct {
	Mode               string   `json:"mode" enum:"index,managed"`
	RootPath           string   `json:"rootPath" minLength:"1" maxLength:"4096"`
	FollowSymlinks     bool     `json:"followSymlinks"`
	SentinelPath       *string  `json:"sentinelPath,omitempty" maxLength:"1024" doc:"Operator-supplied root identity file, relative to the root; never created automatically."`
	SentinelSHA256     *string  `json:"sentinelSha256,omitempty" pattern:"^[0-9a-f]{64}$"`
	ScanIntervalSecs   int      `json:"scanIntervalSecs,omitempty" minimum:"60" default:"900"`
	VerifyIntervalSecs int      `json:"verifyIntervalSecs,omitempty" minimum:"3600" default:"86400"`
	StabilitySecs      int      `json:"stabilitySecs,omitempty" minimum:"1" default:"30"`
	ImportTemplate     *string  `json:"importTemplate,omitempty" maxLength:"512"`
	WritebackBackups   bool     `json:"writebackBackups"`
	BackupRoot         *string  `json:"backupRoot,omitempty" maxLength:"4096"`
	ProviderOrder      []string `json:"providerOrder" uniqueItems:"true" maxItems:"8"`
}

type CreateLibrary struct {
	Name   string        `json:"name" minLength:"1" maxLength:"200"`
	Config LibraryConfig `json:"config"`
}

type RootHealth struct {
	State     string  `json:"state" enum:"healthy,unavailable,identity_mismatch,unknown"`
	Detail    *string `json:"detail,omitempty"`
	CheckedAt *string `json:"checkedAt,omitempty" format:"date-time"`
}

type LibraryDetail struct {
	Library Library       `json:"library"`
	Config  LibraryConfig `json:"config"`
	Health  RootHealth    `json:"health"`
}
