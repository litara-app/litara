// Package inspect runs the bundled ffprobe against a local file and
// normalizes its output into an internal typed result. It never modifies the
// inspected file.
package inspect

// SchemaVersion identifies the shape of Result persisted in PostgreSQL.
const SchemaVersion = 1

// Completeness says whether every field needed downstream could be derived.
type Completeness string

const (
	Complete   Completeness = "complete"
	Incomplete Completeness = "incomplete"
)

// Result is the internal normalized inspection result. Nil pointers mean the
// value was unknown, never zero. Timeline values are milliseconds; Raw*
// fields preserve the source units for provenance.
type Result struct {
	SchemaVersion int          `json:"schemaVersion"`
	Tool          ToolInfo     `json:"tool"`
	Source        SourceInfo   `json:"source"`
	Format        Format       `json:"format"`
	Streams       []Stream     `json:"streams"`
	Artwork       []Artwork    `json:"artwork"`
	Chapters      []Chapter    `json:"chapters"`
	Completeness  Completeness `json:"completeness"`
	Issues        []Issue      `json:"issues"`
}

type ToolInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type SourceInfo struct {
	SizeBytes int64 `json:"sizeBytes"`
	ModTimeMs int64 `json:"modTimeMs"`
}

type Format struct {
	Name        string            `json:"name"`
	LongName    string            `json:"longName,omitempty"`
	ProbeScore  int               `json:"probeScore"`
	DurationMs  *int64            `json:"durationMs"`
	StartTimeMs *int64            `json:"startTimeMs"`
	BitRate     *int64            `json:"bitRate"`
	Tags        map[string]string `json:"tags"`
	// RawDurationSeconds is ffprobe's textual duration, kept for provenance.
	RawDurationSeconds string `json:"rawDurationSeconds,omitempty"`
}

type Stream struct {
	Index         int               `json:"index"`
	Type          string            `json:"type"`
	Codec         string            `json:"codec"`
	CodecLongName string            `json:"codecLongName,omitempty"`
	Profile       string            `json:"profile,omitempty"`
	SampleRate    *int64            `json:"sampleRate"`
	Channels      *int64            `json:"channels"`
	ChannelLayout string            `json:"channelLayout,omitempty"`
	BitRate       *int64            `json:"bitRate"`
	DurationMs    *int64            `json:"durationMs"`
	Width         *int64            `json:"width,omitempty"`
	Height        *int64            `json:"height,omitempty"`
	AttachedPic   bool              `json:"attachedPicture"`
	Tags          map[string]string `json:"tags"`
}

// Artwork describes an embedded picture without extracting its bytes.
// Extraction and decoding are a named follow-up.
type Artwork struct {
	StreamIndex int    `json:"streamIndex"`
	Codec       string `json:"codec"`
	Width       *int64 `json:"width"`
	Height      *int64 `json:"height"`
	Source      string `json:"source"`
}

// Chapter positions are relative to the inspected file (ADR-0029).
type Chapter struct {
	Index    int    `json:"index"`
	Title    string `json:"title"`
	StartMs  int64  `json:"startMs"`
	EndMs    *int64 `json:"endMs"`
	TimeBase string `json:"rawTimeBase"`
	RawStart int64  `json:"rawStart"`
	RawEnd   int64  `json:"rawEnd"`
}

type Issue struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
