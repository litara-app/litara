package writeback

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/testutil"
)

func coverFields(t *testing.T, img []byte) metadata.Fields {
	t.Helper()
	enc, _ := json.Marshal(base64.StdEncoding.EncodeToString(img))
	return metadata.Fields{"cover_image": enc}
}

func newJPEG(t *testing.T, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 48, 72))
	for y := 0; y < 72; y++ {
		for x := 0; x < 48; x++ {
			img.Set(x, y, c)
		}
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 92}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// audioStreams keeps what a cover write must never change: the audio packets, the chapters and the file's own tags.
type audioKept struct {
	Packets  []map[string]any
	Chapters []map[string]any
	Tags     map[string]string
}

func keptOf(p audioProbe) audioKept {
	k := audioKept{Chapters: p.Chapters, Tags: p.Format.Tags}
	for _, pk := range p.Packets {
		if idx, _ := pk["stream_index"].(float64); idx == 0 {
			k.Packets = append(k.Packets, pk)
		}
	}
	return k
}

func pictureCount(p audioProbe) int {
	n := 0
	for _, s := range p.Streams {
		if d, ok := s["disposition"].(map[string]any); ok {
			if v, _ := d["attached_pic"].(float64); v == 1 {
				n++
			}
		}
	}
	return n
}

// ADR-0086: the M4B/M4A and MP3 writers replace or add the front cover and change nothing else.
func TestAudioCoverWritersReplaceOrAddTheFrontCoverOnly(t *testing.T) {
	ffmpeg, ffprobe := testutil.Tool(t, "ffmpeg"), testutil.Tool(t, "ffprobe")
	want := newJPEG(t, color.RGBA{R: 30, G: 160, B: 90, A: 255})
	for _, tc := range []struct {
		name, format, codec, muxer string
		flags                      []string
	}{
		{"mp3-id3v23", "mp3", "libmp3lame", "mp3", []string{"-id3v2_version", "3"}},
		{"mp3-id3v24", "mp3", "libmp3lame", "mp3", []string{"-id3v2_version", "4"}},
		{"m4a", "m4a", "aac", "ipod", nil},
		{"m4b-fast-start", "m4b", "aac", "ipod", []string{"-movflags", "+faststart"}},
	} {
		for _, hasArt := range []bool{true, false} {
			name := tc.name + "/no-art"
			if hasArt {
				name = tc.name + "/replace"
			}
			t.Run(name, func(t *testing.T) {
				dir := t.TempDir()
				src, dst := filepath.Join(dir, "source."+tc.format), filepath.Join(dir, "staged.tmp")
				chapters := filepath.Join(dir, "chapters.txt")
				if err := os.WriteFile(chapters, []byte(";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=First\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Second\n"), 0o600); err != nil {
					t.Fatal(err)
				}
				args := []string{"-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2"}
				if hasArt {
					art := filepath.Join(dir, "art.png")
					f, _ := os.Create(art)
					img := image.NewRGBA(image.Rect(0, 0, 16, 16))
					img.Set(0, 0, color.RGBA{R: 255, A: 255})
					_ = png.Encode(f, img)
					f.Close()
					args = append(args, "-i", art, "-f", "ffmetadata", "-i", chapters, "-map", "0:a", "-map", "1:v", "-map_chapters", "2",
						"-c:v", "copy", "-disposition:v:0", "attached_pic")
				} else {
					args = append(args, "-f", "ffmetadata", "-i", chapters, "-map", "0:a", "-map_chapters", "1")
				}
				args = append(args, "-c:a", tc.codec, "-metadata", "title=Old title", "-metadata", "artist=An author", "-f", tc.muxer)
				args = append(args, tc.flags...)
				runTool(t, ffmpeg, append(args, src)...)
				before := probeTags(t, ffprobe, src)
				wantPics := 0
				if hasArt {
					wantPics = 1
				}
				if pictureCount(before) != wantPics {
					t.Fatalf("fixture has %d pictures, want %d", pictureCount(before), wantPics)
				}
				original, _ := os.ReadFile(src)
				changes := coverFields(t, want)
				writer := BuiltInWriters()[tc.format]
				if err := writer.Write(t.Context(), src, dst, changes); err != nil {
					t.Fatal(err)
				}
				if err := writer.Validate(t.Context(), src, dst, changes); err != nil {
					t.Fatal(err)
				}
				after := probeTags(t, ffprobe, dst)
				if pictureCount(after) != 1 {
					t.Fatalf("the file should hold exactly one picture, has %d", pictureCount(after))
				}
				if !reflect.DeepEqual(keptOf(before), keptOf(after)) {
					t.Fatal("audio packets, chapters or tags changed")
				}
				// The picture itself is the requested JPEG, byte for byte.
				out := filepath.Join(dir, "extracted.jpg")
				runTool(t, ffmpeg, "-v", "error", "-i", dst, "-map", "0:v:0", "-c", "copy", "-f", "image2", out)
				if got, err := os.ReadFile(out); err != nil || !bytes.Equal(got, want) {
					t.Fatalf("the embedded picture is not the requested cover: %v", err)
				}
				if got, _ := os.ReadFile(src); !bytes.Equal(got, original) {
					t.Fatal("the source changed")
				}
				// Repeating the write leaves a second file identical to the first.
				again := filepath.Join(dir, "again.tmp")
				if err := writer.Write(t.Context(), dst, again, changes); err != nil {
					t.Fatal(err)
				}
				a, _ := os.ReadFile(dst)
				b, _ := os.ReadFile(again)
				if !bytes.Equal(a, b) {
					t.Fatal("writing the same cover twice changed the file")
				}
				// A tampered staged file is refused.
				staged, _ := os.OpenFile(dst, os.O_APPEND|os.O_WRONLY, 0)
				_, _ = staged.Write([]byte{0})
				staged.Close()
				if writer.Validate(t.Context(), src, dst, changes) == nil {
					t.Fatal("accepted tampered staged bytes")
				}
			})
		}
	}
}

func TestAudioCoverRefusals(t *testing.T) {
	good := newJPEG(t, color.RGBA{R: 1, G: 2, B: 3, A: 255})
	if err := BuiltInWriters()["flac"].(audioWriter).ValidateFields(coverFields(t, good)); err == nil || !strings.Contains(err.Error(), "FLAC") {
		t.Fatalf("FLAC cover: %v", err)
	}
	for _, f := range []string{"mp3", "m4a", "m4b"} {
		if err := BuiltInWriters()[f].(audioWriter).ValidateFields(coverFields(t, good)); err != nil {
			t.Fatalf("%s should accept a cover: %v", f, err)
		}
	}
	for name, raw := range map[string]string{"text": "hello", "png": "iVBORw0KGgo="} {
		bad, _ := json.Marshal(base64.StdEncoding.EncodeToString([]byte(raw)))
		if _, err := parseAudioChanges(metadata.Fields{"cover_image": bad}); err == nil {
			t.Fatalf("%s was accepted as a cover", name)
		}
	}

	// Several pictures in one MP4 cover item would lose all but one, so it is refused; one JPEG or PNG is replaceable.
	data := func(kind uint32, payload string) []byte {
		return mp4Atom("data", append(binary.BigEndian.AppendUint32(nil, kind), append(make([]byte, 4), payload...)...))
	}
	if err := validCoverItem(bytes.Join([][]byte{data(13, "a"), data(14, "b")}, nil)); err == nil {
		t.Fatal("an MP4 cover item with two pictures was accepted")
	}
	if err := validCoverItem(data(27, "a")); err == nil {
		t.Fatal("an MP4 cover item of an unknown type was accepted")
	}
	if err := validCoverItem(data(14, "a")); err != nil {
		t.Fatalf("a single PNG cover item: %v", err)
	}
	// Only a front cover (type 3) is replaced in an MP3; another picture kind is left alone.
	frame := func(pictureType byte) []byte {
		return append([]byte{0}, append([]byte("image/png\x00"), pictureType, 0, 'x')...)
	}
	if !apicIsFrontCover(frame(3)) || apicIsFrontCover(frame(4)) || apicIsFrontCover([]byte{0, 'i'}) {
		t.Fatal("front cover detection is wrong")
	}
	// With a front cover present only it is replaced; with one picture of another kind that one is replaced; with several
	// pictures and no front cover none is replaced (a front cover is added beside them).
	if !apicReplaces(frame(3), 2, 1) || apicReplaces(frame(4), 2, 1) || !apicReplaces(frame(4), 1, 0) || apicReplaces(frame(4), 2, 0) {
		t.Fatal("picture replacement rules are wrong")
	}
}
