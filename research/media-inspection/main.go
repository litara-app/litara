// An isolated inspection experiment, not Litara application code.
package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/spf13/afero"
	"gitlab.com/phpboyscout/afmpeg/pkg/afmpeg"
)

const engineTag = "n9.0.1-8"

type metrics struct {
	Reads       int
	Bytes       int64
	Seeks       int
	LargestRead int
}
type probeFS struct {
	afero.Fs
	stats *metrics
}

func (f probeFS) Open(name string) (afero.File, error) { return f.OpenFile(name, os.O_RDONLY, 0) }
func (f probeFS) OpenFile(name string, flag int, mode os.FileMode) (afero.File, error) {
	if flag != os.O_RDONLY {
		return nil, os.ErrPermission
	}
	var file afero.File
	if name == "large.wav" {
		file = &virtualWAV{header: rf64Header(8 << 30), size: (8 << 30) + 80}
	} else {
		var err error
		file, err = f.Fs.OpenFile(name, flag, mode)
		if err != nil {
			return nil, err
		}
	}
	return &countedFile{File: file, stats: f.stats}, nil
}

type countedFile struct {
	afero.File
	stats *metrics
}

func (f *countedFile) Read(b []byte) (int, error) {
	n, e := f.File.Read(b)
	f.stats.Reads++
	f.stats.Bytes += int64(n)
	if len(b) > f.stats.LargestRead {
		f.stats.LargestRead = len(b)
	}
	return n, e
}
func (f *countedFile) ReadAt(b []byte, off int64) (int, error) {
	n, e := f.File.ReadAt(b, off)
	f.stats.Reads++
	f.stats.Bytes += int64(n)
	if len(b) > f.stats.LargestRead {
		f.stats.LargestRead = len(b)
	}
	return n, e
}
func (f *countedFile) Seek(off int64, whence int) (int64, error) {
	f.stats.Seeks++
	return f.File.Seek(off, whence)
}

// An 8 GiB seekable PCM stream without allocating or writing 8 GiB.
type virtualWAV struct {
	afero.File
	header    []byte
	size, pos int64
}

func (f *virtualWAV) ReadAt(b []byte, off int64) (int, error) {
	if off < 0 {
		return 0, os.ErrInvalid
	}
	if off >= f.size {
		return 0, io.EOF
	}
	n := len(b)
	if int64(n) > f.size-off {
		n = int(f.size - off)
	}
	clear(b[:n])
	if off < int64(len(f.header)) {
		copy(b[:n], f.header[off:])
	}
	if n < len(b) {
		return n, io.EOF
	}
	return n, nil
}
func (f *virtualWAV) Read(b []byte) (int, error) {
	n, e := f.ReadAt(b, f.pos)
	f.pos += int64(n)
	return n, e
}
func (f *virtualWAV) Seek(off int64, whence int) (int64, error) {
	p := off
	switch whence {
	case io.SeekStart:
	case io.SeekCurrent:
		p += f.pos
	case io.SeekEnd:
		p += f.size
	default:
		return 0, os.ErrInvalid
	}
	if p < 0 {
		return 0, os.ErrInvalid
	}
	f.pos = p
	return p, nil
}
func (f *virtualWAV) Close() error               { return nil }
func (f *virtualWAV) Name() string               { return "large.wav" }
func (f *virtualWAV) Stat() (os.FileInfo, error) { return virtualInfo{f.size}, nil }

type virtualInfo struct{ size int64 }

func (i virtualInfo) Name() string       { return "large.wav" }
func (i virtualInfo) Size() int64        { return i.size }
func (i virtualInfo) Mode() os.FileMode  { return 0444 }
func (i virtualInfo) ModTime() time.Time { return time.Unix(0, 0) }
func (i virtualInfo) IsDir() bool        { return false }
func (i virtualInfo) Sys() any           { return nil }
func rf64Header(dataSize uint64) []byte {
	b := make([]byte, 80)
	copy(b, "RF64")
	binary.LittleEndian.PutUint32(b[4:], math.MaxUint32)
	copy(b[8:], "WAVEds64")
	binary.LittleEndian.PutUint32(b[16:], 28)
	binary.LittleEndian.PutUint64(b[20:], dataSize+72)
	binary.LittleEndian.PutUint64(b[28:], dataSize)
	binary.LittleEndian.PutUint64(b[36:], dataSize/2)
	copy(b[48:], "fmt ")
	binary.LittleEndian.PutUint32(b[52:], 16)
	binary.LittleEndian.PutUint16(b[56:], 1)
	binary.LittleEndian.PutUint16(b[58:], 1)
	binary.LittleEndian.PutUint32(b[60:], 8000)
	binary.LittleEndian.PutUint32(b[64:], 16000)
	binary.LittleEndian.PutUint16(b[68:], 2)
	binary.LittleEndian.PutUint16(b[70:], 16)
	copy(b[72:], "data")
	binary.LittleEndian.PutUint32(b[76:], math.MaxUint32)
	return b
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func riffChunk(kind string, payload []byte) []byte {
	b := make([]byte, 8+len(payload)+(len(payload)%2))
	copy(b, kind)
	binary.LittleEndian.PutUint32(b[4:], uint32(len(payload)))
	copy(b[8:], payload)
	return b
}

func chapterFixture(basic []byte) []byte {
	// RIFF cue points and associated labels, followed by ordinary INFO tags.
	cue := make([]byte, 4+2*24)
	binary.LittleEndian.PutUint32(cue, 2)
	labels := []byte("adtl")
	for index, title := range []string{"Opening", "Second"} {
		record := cue[4+index*24:]
		binary.LittleEndian.PutUint32(record, uint32(index+1))
		copy(record[8:], "data")
		binary.LittleEndian.PutUint32(record[20:], uint32(index*8000))
		label := make([]byte, 4)
		binary.LittleEndian.PutUint32(label, uint32(index+1))
		label = append(label, append([]byte(title), 0)...)
		labels = append(labels, riffChunk("labl", label)...)
	}
	info := append([]byte("INFO"), riffChunk("INAM", []byte("Litara generated fixture\x00"))...)
	result := append([]byte{}, basic[:36]...)
	result = append(result, riffChunk("cue ", cue)...)
	result = append(result, riffChunk("LIST", labels)...)
	result = append(result, riffChunk("LIST", info)...)
	result = append(result, basic[36:]...)
	binary.LittleEndian.PutUint32(result[4:], uint32(len(result)-8))
	return result
}

func run() error {
	if err := os.MkdirAll(".cache/fixtures", 0755); err != nil {
		return err
	}
	// Two-second silent PCM fixture written by this experiment; no external media.
	b := make([]byte, 44+32000)
	copy(b, "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(len(b)-8))
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1)
	binary.LittleEndian.PutUint16(b[22:], 1)
	binary.LittleEndian.PutUint32(b[24:], 8000)
	binary.LittleEndian.PutUint32(b[28:], 16000)
	binary.LittleEndian.PutUint16(b[32:], 2)
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], 32000)
	if err := os.WriteFile(".cache/fixtures/small.wav", b, 0644); err != nil {
		return err
	}
	if err := os.WriteFile(".cache/fixtures/chapters.wav", chapterFixture(b), 0644); err != nil {
		return err
	}
	if err := os.WriteFile(".cache/fixtures/invalid.bin", []byte("not media"), 0644); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	var provenance afmpeg.Provenance
	started := time.Now()
	rt, err := afmpeg.New(ctx, afmpeg.WithModuleRelease(engineTag, afmpeg.VariantLGPL,
		afmpeg.WithReleaseBaseURL("https://pkg.phpboyscout.uk/ffmpeg-wasi"),
		afmpeg.WithReleaseCacheDir(".cache/engine"), afmpeg.WithReleaseHTTPClient(&http.Client{Timeout: 90 * time.Second}), afmpeg.WithReleaseProvenance(&provenance)),
		afmpeg.WithMemoryLimit(256<<20), afmpeg.WithTimeout(30*time.Second))
	if err != nil {
		return fmt.Errorf("verified engine initialization: %w", err)
	}
	defer rt.Close(context.Background())
	initialization := time.Since(started)
	report := map[string]any{"go_version": runtime.Version(), "wrapper": "v0.16.1", "engine": engineTag, "initialization_ms": initialization.Milliseconds(), "provenance": provenance, "guest_memory_limit_bytes": 256 << 20}
	results := []map[string]any{}
	base := afero.NewReadOnlyFs(afero.NewBasePathFs(afero.NewOsFs(), ".cache/fixtures"))
	for _, item := range []struct {
		name     string
		expected float64
	}{{"small.wav", 2}, {"chapters.wav", 2}, {"large.wav", float64(uint64(8)<<30) / 16000}} {
		stats := &metrics{}
		fs := probeFS{Fs: base, stats: stats}
		started = time.Now()
		p, e := rt.Probe(ctx, fs, item.name)
		var mem runtime.MemStats
		runtime.ReadMemStats(&mem)
		entry := map[string]any{"file": item.name, "elapsed_ms": time.Since(started).Milliseconds(), "probe": p, "io": stats, "go_heap_alloc_bytes": mem.HeapAlloc, "go_heap_sys_bytes": mem.HeapSys}
		if e != nil {
			entry["error"] = e.Error()
		} else if math.Abs(p.DurationSec-item.expected) > 0.001 {
			entry["error"] = fmt.Sprintf("duration %f != expected %f", p.DurationSec, item.expected)
		}
		if e == nil && item.name == "chapters.wav" {
			if p.Tags["title"] != "Litara generated fixture" || len(p.Chapters) != 2 || p.Chapters[0].Title != "Opening" || p.Chapters[1].Title != "Second" || math.Abs(p.Chapters[1].Start-1) > 0.001 {
				entry["error"] = "metadata/chapter fixture did not round-trip"
			}
		}
		results = append(results, entry)
	}
	// A cancelled probe must return an error rather than hanging behind runtime work.
	cancelled, stop := context.WithCancel(ctx)
	stop()
	_, cancelErr := rt.Probe(cancelled, base, "small.wav")
	report["cancelled_probe_rejected"] = cancelErr != nil
	_, invalidErr := rt.Probe(ctx, base, "invalid.bin")
	report["invalid_media_rejected"] = invalidErr != nil
	report["results"] = results
	out, e := json.MarshalIndent(report, "", "  ")
	if e != nil {
		return e
	}
	fmt.Println(string(out))
	if e = os.WriteFile(filepath.Join("results.json"), append(out, '\n'), 0644); e != nil {
		return e
	}
	for _, entry := range results {
		if e, ok := entry["error"]; ok {
			return fmt.Errorf("probe failed: %v", e)
		}
	}
	if cancelErr == nil {
		return fmt.Errorf("cancelled probe unexpectedly succeeded")
	}
	if invalidErr == nil {
		return fmt.Errorf("invalid media unexpectedly accepted")
	}
	return nil
}
