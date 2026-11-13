// Package wire defines the exact JSON shapes of the T003 contract
// (contracts/t003/openapi.json). Type names match the OpenAPI component
// schema names so the generated and shared specs can be compared by name.
// IDs are strings on the wire; services convert at their boundary.
package wire

import (
	"bytes"
	"encoding/json"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
)

// Nullable is an object that is either present or JSON null. Huma cannot
// express nullable $ref objects through struct tags, so the schema is
// anyOf [$ref, null], matching the shared contract.
type Nullable[T any] struct {
	Value *T
}

func Some[T any](v *T) Nullable[T] { return Nullable[T]{Value: v} }

func (n Nullable[T]) IsZero() bool { return n.Value == nil }

func (n Nullable[T]) MarshalJSON() ([]byte, error) {
	if n.Value == nil {
		return []byte("null"), nil
	}
	return json.Marshal(n.Value)
}

func (n *Nullable[T]) UnmarshalJSON(b []byte) error {
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		n.Value = nil
		return nil
	}
	n.Value = new(T)
	return json.Unmarshal(b, n.Value)
}

func (Nullable[T]) Schema(r huma.Registry) *huma.Schema {
	t := reflect.TypeFor[T]()
	return &huma.Schema{AnyOf: []*huma.Schema{r.Schema(t, true, t.Name()), {Type: "null"}}}
}

const MaxSafeInt = 9007199254740991

type User struct {
	ID          string `json:"id" format:"uuid"`
	Username    string `json:"username" minLength:"1" maxLength:"128"`
	DisplayName string `json:"displayName"`
	IsAdmin     bool   `json:"isAdmin"`
	Active      bool   `json:"active"`
}

type Library struct {
	ID   string `json:"id" format:"uuid"`
	Name string `json:"name"`
}

type Session struct {
	ID                string `json:"id" format:"uuid"`
	DeviceName        string `json:"deviceName"`
	Client            string `json:"client" enum:"native,web"`
	CreatedAt         string `json:"createdAt" format:"date-time"`
	LastUsedAt        string `json:"lastUsedAt" format:"date-time"`
	IdleExpiresAt     string `json:"idleExpiresAt" format:"date-time"`
	AbsoluteExpiresAt string `json:"absoluteExpiresAt" format:"date-time"`
}

type Discovery struct {
	ServerID     string   `json:"serverId" format:"uuid"`
	Product      string   `json:"product" enum:"Litara"`
	APIVersions  []string `json:"apiVersions" minItems:"1" enum:"v1"`
	APIBasePath  string   `json:"apiBasePath" pattern:"^/"`
	Stability    string   `json:"stability" enum:"development"`
	Capabilities []string `json:"capabilities" enum:"recordings,range-media,position-conflicts,offline-snapshots"`
	Registration string   `json:"registration" enum:"admin-only"`
}

type Login struct {
	Username   string `json:"username" minLength:"1" maxLength:"128"`
	Password   string `json:"password" minLength:"1" maxLength:"1024"`
	DeviceName string `json:"deviceName" minLength:"1" maxLength:"128"`
}

type TokenPair struct {
	AccessToken  string  `json:"accessToken" minLength:"32"`
	TokenType    string  `json:"tokenType" enum:"Bearer"`
	ExpiresIn    int     `json:"expiresIn" enum:"900"`
	RefreshToken string  `json:"refreshToken" minLength:"32"`
	Session      Session `json:"session"`
	User         User    `json:"user"`
}

type Refresh struct {
	RefreshToken string `json:"refreshToken" minLength:"32"`
	RequestID    string `json:"requestId" format:"uuid"`
}

type BrowserSession struct {
	User      User    `json:"user"`
	Session   Session `json:"session"`
	CSRFToken string  `json:"csrfToken" minLength:"32"`
}

type CreateUser struct {
	Username    string `json:"username" minLength:"1" maxLength:"128"`
	DisplayName string `json:"displayName" maxLength:"256"`
	Password    string `json:"password" minLength:"12" maxLength:"1024"`
	IsAdmin     bool   `json:"isAdmin"`
}

type UpdateUser struct {
	DisplayName *string `json:"displayName,omitempty" maxLength:"256"`
	IsAdmin     *bool   `json:"isAdmin,omitempty"`
	Active      *bool   `json:"active,omitempty"`
}

type UserList struct {
	Items []User `json:"items"`
	Total int64  `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64  `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64  `json:"size" minimum:"1" maximum:"200"`
}

type LibraryList struct {
	Items []Library `json:"items"`
	Total int64     `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64     `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64     `json:"size" minimum:"1" maximum:"200"`
}

type Sessions struct {
	Items []Session `json:"items"`
}

type Issue struct {
	Code    string  `json:"code" minLength:"1"`
	Message string  `json:"message"`
	Source  *string `json:"source" nullable:"true" enum:"user,cue,embedded,generated"`
	FileID  *string `json:"fileId" nullable:"true" format:"uuid"`
}

type Anchor struct {
	FileID         string `json:"fileId" format:"uuid"`
	ContentVersion string `json:"contentVersion" format:"uuid"`
	OffsetMs       int64  `json:"offsetMs" minimum:"0" maximum:"9007199254740991"`
}

type File struct {
	ID             string `json:"id" format:"uuid"`
	ContentVersion string `json:"contentVersion" format:"uuid"`
	Sequence       int64  `json:"sequence" minimum:"0" maximum:"9007199254740991"`
	Filename       string `json:"filename"`
	MimeType       string `json:"mimeType"`
	SizeBytes      *int64 `json:"sizeBytes" nullable:"true" minimum:"0" maximum:"9007199254740991"`
	DurationMs     *int64 `json:"durationMs" nullable:"true" minimum:"1" maximum:"9007199254740991"`
	Available      bool   `json:"available"`
	ContentPath    string `json:"contentPath"`
}

type Chapter struct {
	ID               string `json:"id" format:"uuid"`
	Label            string `json:"label"`
	Start            Anchor `json:"start"`
	RecordingStartMs *int64 `json:"recordingStartMs" nullable:"true" minimum:"0" maximum:"9007199254740991"`
	Source           string `json:"source" enum:"user,cue,embedded,generated"`
	Generated        bool   `json:"generated"`
}

type Artwork struct {
	ThumbnailPath *string `json:"thumbnailPath" nullable:"true"`
	CoverPath     *string `json:"coverPath" nullable:"true"`
}

type Position struct {
	FileID         string `json:"fileId" format:"uuid"`
	ContentVersion string `json:"contentVersion" format:"uuid"`
	OffsetMs       int64  `json:"offsetMs" minimum:"0" maximum:"9007199254740991"`
	LayoutRevision string `json:"layoutRevision" format:"uuid"`
	CapturedAt     string `json:"capturedAt" format:"date-time"`
	ReceivedAt     string `json:"receivedAt" format:"date-time"`
	DeviceName     string `json:"deviceName"`
}

type Conflict struct {
	ID                  string                    `json:"id" format:"uuid"`
	Reason              string                    `json:"reason" enum:"stale_revision,layout_changed,content_changed,completion_changed"`
	Candidate           Nullable[Position]        `json:"candidate"`
	BaseRevision        string                    `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	CreatedAt           string                    `json:"createdAt" format:"date-time"`
	ResolvedAt          *string                   `json:"resolvedAt" nullable:"true" format:"date-time"`
	CompletionCandidate Nullable[CompletionWrite] `json:"completionCandidate,omitzero"`
}

type PositionState struct {
	Revision            string             `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Position            Nullable[Position] `json:"position"`
	UnresolvedConflicts []Conflict         `json:"unresolvedConflicts"`
}

type CompletionState struct {
	Revision  string  `json:"revision" pattern:"^(0|[1-9][0-9]*)$"`
	Finished  bool    `json:"finished"`
	ChangedAt *string `json:"changedAt" nullable:"true" format:"date-time"`
}

type Series struct {
	Name  string   `json:"name"`
	Index *float64 `json:"index" nullable:"true"`
}

type RecordingSummary struct {
	ID             string           `json:"id" format:"uuid"`
	TitleID        string           `json:"titleId" format:"uuid"`
	LibraryID      string           `json:"libraryId" format:"uuid"`
	Title          string           `json:"title"`
	Authors        []string         `json:"authors"`
	Narrators      []string         `json:"narrators"`
	Series         Nullable[Series] `json:"series"`
	Readiness      string           `json:"readiness" enum:"ready,incomplete"`
	DurationMs     *int64           `json:"durationMs" nullable:"true" minimum:"0" maximum:"9007199254740991"`
	Artwork        Artwork          `json:"artwork"`
	Completion     CompletionState  `json:"completion"`
	LastActivityAt *string          `json:"lastActivityAt" nullable:"true" format:"date-time"`
}

type Capabilities struct {
	Play               bool `json:"play"`
	Download           bool `json:"download"`
	WholeRecordingSeek bool `json:"wholeRecordingSeek"`
}

// Recording is the self-contained schemaVersion=1 offline snapshot.
type Recording struct {
	RecordingSummary
	SchemaVersion  int          `json:"schemaVersion" enum:"1"`
	LayoutRevision string       `json:"layoutRevision" format:"uuid"`
	Files          []File       `json:"files" minItems:"1"`
	Chapters       []Chapter    `json:"chapters"`
	Capabilities   Capabilities `json:"capabilities"`
	Issues         []Issue      `json:"issues"`
}

type Recordings struct {
	Items []RecordingSummary `json:"items"`
	Total int64              `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64              `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64              `json:"size" minimum:"1" maximum:"200"`
}

type PositionInput struct {
	FileID         string `json:"fileId" format:"uuid"`
	ContentVersion string `json:"contentVersion" format:"uuid"`
	OffsetMs       int64  `json:"offsetMs" minimum:"0" maximum:"9007199254740991"`
	CapturedAt     string `json:"capturedAt" format:"date-time"`
}

type PositionWrite struct {
	OperationID    string        `json:"operationId" format:"uuid"`
	BaseRevision   string        `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	LayoutRevision string        `json:"layoutRevision" format:"uuid"`
	Position       PositionInput `json:"position"`
}

type ResolveConflict struct {
	OperationID    string                  `json:"operationId" format:"uuid"`
	BaseRevision   string                  `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	LayoutRevision string                  `json:"layoutRevision" format:"uuid"`
	Choice         string                  `json:"choice" enum:"keep_server,use_candidate,use_explicit"`
	Position       Nullable[PositionInput] `json:"position"`
}

type CompletionWrite struct {
	OperationID    string           `json:"operationId" format:"uuid"`
	BaseRevision   string           `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	LayoutRevision string           `json:"layoutRevision" format:"uuid"`
	Event          string           `json:"event" enum:"natural_end,manual_finish,manual_unfinish"`
	CapturedAt     string           `json:"capturedAt" format:"date-time"`
	FinalPosition  Nullable[Anchor] `json:"finalPosition"`
}

type ResolveCompletionConflict struct {
	OperationID    string           `json:"operationId" format:"uuid"`
	BaseRevision   string           `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	LayoutRevision string           `json:"layoutRevision" format:"uuid"`
	Choice         string           `json:"choice" enum:"keep_server,use_candidate,use_explicit"`
	Event          *string          `json:"event" nullable:"true" enum:"natural_end,manual_finish,manual_unfinish"`
	CapturedAt     string           `json:"capturedAt" format:"date-time"`
	FinalPosition  Nullable[Anchor] `json:"finalPosition"`
}

type HistoryEntry struct {
	ID          string `json:"id" format:"uuid"`
	RecordingID string `json:"recordingId" format:"uuid"`
	TitleID     string `json:"titleId" format:"uuid"`
	Event       string `json:"event" enum:"natural_end,manual_finish,manual_unfinish"`
	CapturedAt  string `json:"capturedAt" format:"date-time"`
	ReceivedAt  string `json:"receivedAt" format:"date-time"`
}

type History struct {
	Items []HistoryEntry `json:"items"`
	Total int64          `json:"total" minimum:"0" maximum:"9007199254740991"`
	Page  int64          `json:"page" minimum:"0" maximum:"9007199254740991"`
	Size  int64          `json:"size" minimum:"1" maximum:"200"`
}

// Raw returns v marshaled; panics only on programmer error (all types here are plain).
func Raw(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
