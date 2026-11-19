package writeback

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
)

type audioProbe struct {
	Packets  []map[string]any
	Streams  []map[string]any
	Chapters []map[string]any
	Format   struct {
		Tags map[string]string
	}
}

func runTool(t *testing.T, command string, args ...string) []byte {
	t.Helper()
	out, err := exec.CommandContext(t.Context(), command, args...).CombinedOutput()
	if err != nil {
		t.Fatalf("%s: %v\n%s", filepath.Base(command), err, out)
	}
	return out
}

func probeTags(t *testing.T, ffprobe, path string) audioProbe {
	t.Helper()
	out := runTool(t, ffprobe, "-v", "error", "-of", "json", "-show_data_hash", "sha256",
		"-show_packets", "-show_streams", "-show_chapters", "-show_format",
		"-show_entries", "packet=stream_index,pts,dts,duration,size,flags,data_hash:stream=index,codec_name,codec_type,profile,time_base,sample_rate,channels,extradata_hash:stream_disposition:stream_tags:chapter:format_tags",
		path)
	var probe audioProbe
	if err := json.Unmarshal(out, &probe); err != nil {
		t.Fatal(err)
	}
	return probe
}

// Native CUESHEET for a two-second 44.1 kHz seekable FLAC (RFC 9639 §8.7).
// The two audio tracks start at 0 and 44,100 samples, followed by the lead-out.
func insertFixtureCuesheet(t *testing.T, path string) []byte {
	t.Helper()
	cue := make([]byte, 396)
	cue[395] = 3
	for i, offset := range []uint64{0, 44_100, 88_200} {
		track := make([]byte, 36)
		binary.BigEndian.PutUint64(track, offset)
		track[8] = byte(i + 1)
		if i < 2 {
			track[35] = 1
			index := make([]byte, 12)
			index[8] = 1
			track = append(track, index...)
		} else {
			track[8] = 255
		}
		cue = append(cue, track...)
	}
	block := append([]byte{5, 0, byte(len(cue) >> 8), byte(len(cue))}, cue...)
	original, err := os.ReadFile(path)
	if err != nil || len(original) < 42 {
		t.Fatalf("read FLAC fixture: %v", err)
	}
	// The four-byte magic and 38-byte STREAMINFO precede the cuesheet.
	withCue := bytes.Join([][]byte{original[:42], block, original[42:]}, nil)
	if err := os.WriteFile(path, withCue, 0600); err != nil {
		t.Fatal(err)
	}
	return block
}

func TestAudioWriterPreservesPacketsChaptersArtworkAndTags(t *testing.T) {
	ffmpeg, ffprobe := testutil.Tool(t, "ffmpeg"), testutil.Tool(t, "ffprobe")
	const newTitle = "Book about misinformation — é 🌍"
	change, err := json.Marshal(newTitle)
	if err != nil {
		t.Fatal(err)
	}
	changes := metadata.Fields{metadata.FieldTitle: change}
	for _, tc := range []struct {
		name, format, codec, muxer string
		flags                      []string
	}{
		{"mp3-id3v23", "mp3", "libmp3lame", "mp3", []string{"-id3v2_version", "3"}},
		{"mp3-id3v24", "mp3", "libmp3lame", "mp3", []string{"-id3v2_version", "4"}},
		{"flac", "flac", "flac", "flac", nil},
		{"m4a", "m4a", "aac", "ipod", nil},
		{"m4b-fast-start", "m4b", "aac", "ipod", []string{"-movflags", "+faststart"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			src, dst := filepath.Join(dir, "source."+tc.format), filepath.Join(dir, "staged.tmp")
			art := filepath.Join(dir, "art.png")
			f, err := os.Create(art)
			if err != nil {
				t.Fatal(err)
			}
			img := image.NewRGBA(image.Rect(0, 0, 16, 16))
			img.Set(0, 0, color.RGBA{R: 255, A: 255})
			if err := png.Encode(f, img); err != nil {
				t.Fatal(err)
			}
			if err := f.Close(); err != nil {
				t.Fatal(err)
			}
			chapters := filepath.Join(dir, "chapters.txt")
			if err := os.WriteFile(chapters, []byte(";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=First\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Second\n"), 0600); err != nil {
				t.Fatal(err)
			}
			args := []string{"-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-i", art, "-f", "ffmetadata", "-i", chapters,
				"-map", "0:a", "-map", "1:v", "-map_chapters", "2", "-c:a", tc.codec, "-c:v", "copy", "-disposition:v:0", "attached_pic",
				"-metadata", "title=Old title", "-metadata", "comment=Unrelated metadata", "-metadata", "artist=An author", "-f", tc.muxer}
			args = append(args, tc.flags...)
			runTool(t, ffmpeg, append(args, src)...)
			var cue []byte
			if tc.format == "flac" {
				cue = insertFixtureCuesheet(t, src)
			}
			before := probeTags(t, ffprobe, src)
			if len(before.Packets) == 0 || len(before.Streams) < 2 || before.Format.Tags["title"] != "Old title" ||
				(tc.format != "flac" && len(before.Chapters) != 2) {
				t.Fatalf("fixture missing audio, artwork, title or expected chapters: %#v", before)
			}
			original, err := os.ReadFile(src)
			if err != nil {
				t.Fatal(err)
			}
			writer := BuiltInWriters()[tc.format]
			if err := writer.Write(t.Context(), src, dst, changes); err != nil {
				t.Fatal(err)
			}
			if err := writer.Validate(t.Context(), src, dst, changes); err != nil {
				t.Fatal(err)
			}
			after := probeTags(t, ffprobe, dst)
			if after.Format.Tags["title"] != newTitle {
				t.Fatalf("title did not round trip: %#v", after.Format.Tags)
			}
			delete(before.Format.Tags, "title")
			delete(after.Format.Tags, "title")
			if !reflect.DeepEqual(before, after) {
				t.Fatalf("packet, stream, chapter, artwork or other tag data changed")
			}
			if len(cue) != 0 {
				got, err := os.ReadFile(dst)
				if err != nil || len(got) < 42+len(cue) || !bytes.Equal(got[42:42+len(cue)], cue) {
					t.Fatalf("native FLAC cuesheet bytes changed: %v", err)
				}
			}
			if got, err := os.ReadFile(src); err != nil || !bytes.Equal(got, original) {
				t.Fatalf("source changed: %v", err)
			}
			staged, err := os.OpenFile(dst, os.O_APPEND|os.O_WRONLY, 0)
			if err != nil {
				t.Fatal(err)
			}
			_, writeErr := staged.Write([]byte{0})
			if closeErr := staged.Close(); writeErr != nil || closeErr != nil {
				t.Fatalf("tampering fixture: %v / %v", writeErr, closeErr)
			}
			if writer.Validate(t.Context(), src, dst, changes) == nil {
				t.Fatal("accepted tampered staged bytes")
			}
		})
	}
}

func TestAudioWritersRefuseUnsupportedAndMalformedInput(t *testing.T) {
	for _, format := range []string{"mp3", "flac", "m4a", "m4b"} {
		t.Run(format, func(t *testing.T) {
			d := t.TempDir()
			src, dst := filepath.Join(d, "bad."+format), filepath.Join(d, "staged.tmp")
			if err := os.WriteFile(src, []byte("invalid fixture"), 0600); err != nil {
				t.Fatal(err)
			}
			w := BuiltInWriters()[format]
			if err := w.(audioWriter).ValidateFields(metadata.Fields{metadata.FieldAuthors: json.RawMessage(`["Author"]`)}); err == nil {
				t.Fatal("accepted unsupported field")
			}
			if err := w.Write(context.Background(), src, dst, metadata.Fields{metadata.FieldTitle: json.RawMessage(`"Title"`)}); err == nil {
				t.Fatal("accepted malformed source")
			}
			if _, err := os.Stat(dst); !os.IsNotExist(err) {
				t.Fatalf("failed write left a stage: %v", err)
			}
		})
	}
}
