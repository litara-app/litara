package media

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestRangeFixtures runs the shared normative cases from contracts/t003/fixtures/ranges.json.
func TestRangeFixtures(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "t003", "fixtures", "ranges.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Range        *string `json:"range"`
		Size         int64   `json:"size"`
		IfRange      string  `json:"ifRange"`
		CurrentEtag  string  `json:"currentEtag"`
		Status       int     `json:"status"`
		Start        int64   `json:"start"`
		End          int64   `json:"end"`
		Length       int64   `json:"length"`
		ContentRange string  `json:"contentRange"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		r := Request{Method: "GET", IfRange: c.IfRange}
		if c.Range != nil {
			r.Range = *c.Range
		}
		etag := `"v"`
		if c.CurrentEtag != "" {
			etag = c.CurrentEtag
		}
		p := Decide(r, c.Size, etag)
		name := "none"
		if c.Range != nil {
			name = *c.Range
		}
		if p.Status != c.Status {
			t.Errorf("%s size=%d: status %d, want %d", name, c.Size, p.Status, c.Status)
			continue
		}
		switch c.Status {
		case 206:
			if p.Start != c.Start || p.End != c.End || p.Length != c.Length {
				t.Errorf("%s: window %d-%d/%d, want %d-%d/%d", name, p.Start, p.End, p.Length, c.Start, c.End, c.Length)
			}
		case 200:
			if p.Length != c.Length {
				t.Errorf("%s: length %d, want %d", name, p.Length, c.Length)
			}
		case 416:
			if p.ContentRange != c.ContentRange {
				t.Errorf("%s: content-range %q, want %q", name, p.ContentRange, c.ContentRange)
			}
		}
	}
}

func TestPreconditions(t *testing.T) {
	const e = `"abc"`
	if p := Decide(Request{IfMatch: `"zzz"`}, 10, e); p.Status != 412 {
		t.Errorf("If-Match mismatch = %d", p.Status)
	}
	if p := Decide(Request{IfMatch: e}, 10, e); p.Status != 200 {
		t.Errorf("If-Match match = %d", p.Status)
	}
	if p := Decide(Request{IfNoneMatch: e, Range: "bytes=0-1"}, 10, e); p.Status != 304 {
		t.Errorf("If-None-Match match = %d", p.Status)
	}
	if p := Decide(Request{IfNoneMatch: `"other"`}, 10, e); p.Status != 200 {
		t.Errorf("If-None-Match mismatch = %d", p.Status)
	}
	if p := Decide(Request{Range: "bytes=2-3", IfRange: e}, 10, e); p.Status != 206 {
		t.Errorf("If-Range match = %d", p.Status)
	}
	if p := Decide(Request{Range: "bytes=2-3", IfRange: `"stale"`}, 10, e); p.Status != 200 || p.Length != 10 {
		t.Errorf("If-Range mismatch = %+v", p)
	}
	if p := Decide(Request{Range: "bytes=5-2"}, 10, e); p.Status != 400 {
		t.Errorf("reversed range = %d", p.Status)
	}
	if p := Decide(Request{Range: "bytes=-5"}, 0, e); p.Status != 416 {
		t.Errorf("empty file suffix = %d", p.Status)
	}
}

func TestOpenAndCopyAndLargeOffsetSparse(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.bin")
	if err := os.WriteFile(p, []byte("0123456789"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dir, p, 11); err == nil {
		t.Error("size mismatch must be unavailable")
	}
	if _, err := Open(dir, filepath.Join(dir, "..", "x"), 1); err == nil {
		t.Error("path outside root must be unavailable")
	}
	f, err := Open(dir, p, 10)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var b bytes.Buffer
	pl := Decide(Request{Range: "bytes=3-5"}, 10, `"v"`)
	if err := Copy(&b, f, pl); err != nil || b.String() != "345" {
		t.Errorf("copy = %q, %v", b.String(), err)
	}

	// Sparse >4 GiB file: reports sparse offset arithmetic, not a valid audiobook.
	sp := filepath.Join(dir, "sparse.bin")
	sf, err := os.Create(sp)
	if err != nil {
		t.Fatal(err)
	}
	const size = int64(4)<<30 + 4096
	if err := sf.Truncate(size); err != nil {
		t.Skipf("filesystem cannot create a sparse >4 GiB file: %v", err)
	}
	if _, err := sf.WriteAt([]byte("MARK"), 4<<30+10); err != nil {
		t.Skipf("filesystem cannot write at >4 GiB offset: %v", err)
	}
	sf.Close()
	f2, err := Open(dir, sp, size)
	if err != nil {
		t.Fatal(err)
	}
	defer f2.Close()
	pl = Decide(Request{Range: "bytes=4294967306-4294967309"}, size, `"v"`)
	if pl.Status != 206 || pl.ContentRange != "bytes 4294967306-4294967309/4294971392" {
		t.Fatalf("plan = %+v", pl)
	}
	b.Reset()
	if err := Copy(&b, f2, pl); err != nil || b.String() != "MARK" {
		t.Errorf("large offset bytes = %q, %v", b.String(), err)
	}
}
