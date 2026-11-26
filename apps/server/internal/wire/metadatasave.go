package wire

// MetadataChange is one field change in a metadata save (ADR-0095, ADR-0097).
//
// Action set stores a protected edit (value) or a deliberate clear (clear true, value null); reset discards the saved
// edit or clear so other sources apply again; lock freezes the field as it is now; unlock removes only the lock and
// keeps the value. A locked field refuses set and reset until it is unlocked.
type MetadataChange struct {
	Field  string        `json:"field" minLength:"1" maxLength:"64" pattern:"^[a-z_]+$"`
	Action string        `json:"action" enum:"set,reset,lock,unlock"`
	Clear  bool          `json:"clear,omitempty" doc:"With action set: store a deliberate clear (value must be null)."`
	Value  MetadataValue `json:"value,omitempty" doc:"With action set and clear false: the new value."`
}

// MetadataSave applies its changes together or not at all, against the revision the form was loaded from. A stale
// revision is a 409 stale_revision and a change to a locked field is a 409 field_locked; nothing is stored in either case.
type MetadataSave struct {
	OperationID  string           `json:"operationId" format:"uuid"`
	BaseRevision string           `json:"baseRevision" pattern:"^(0|[1-9][0-9]*)$"`
	Changes      []MetadataChange `json:"changes" minItems:"1" maxItems:"30"`
}
