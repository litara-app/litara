package catalog

import (
	"testing"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
)

func audioFile(mime string) sqlcgen.ListRecordingFilesRow {
	size, dur := int64(1000), int64(20000)
	return sqlcgen.ListRecordingFilesRow{FileID: uuid.New(), ContentVersion: uuid.New(), Filename: "a", MimeType: mime, SizeBytes: &size, DurationMs: &dur, Available: true}
}

// Every audio type the scanner catalogs and ffprobe inspects is ready; recognizing a type must not leave a probed,
// well-formed file stuck as incomplete (T007 finding F5).
func TestInspectedAudioTypesAreReady(t *testing.T) {
	for _, mime := range []string{"audio/mpeg", "audio/mp4", "audio/x-m4b", "audio/x-m4a", "audio/aac", "audio/flac", "audio/ogg", "audio/opus", "audio/wav"} {
		r := Evaluate([]sqlcgen.ListRecordingFilesRow{audioFile(mime)})
		if !r.Ready || len(r.Issues) != 0 {
			t.Errorf("%s: ready=%v issues=%v", mime, r.Ready, r.Issues)
		}
	}
}

// An unknown type keeps the explicit incomplete state instead of being silently offered.
func TestUnknownAudioTypeStaysIncomplete(t *testing.T) {
	r := Evaluate([]sqlcgen.ListRecordingFilesRow{audioFile("audio/x-unknown")})
	if r.Ready || len(r.Issues) != 1 || r.Issues[0].Code != "file_unsupported" {
		t.Fatalf("ready=%v issues=%v", r.Ready, r.Issues)
	}
}
