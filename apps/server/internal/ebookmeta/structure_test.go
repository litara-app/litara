package ebookmeta

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"strings"
	"testing"
)

func TestEPUBStructureDistinguishesDamageFromUnavailableEvidence(t *testing.T) {
	makeBook := func(root, pkg string, protected bool) []byte {
		var b bytes.Buffer
		z := zip.NewWriter(&b)
		entries := map[string]string{
			"META-INF/container.xml": `<container><rootfiles><rootfile full-path="` + root + `"/></rootfiles></container>`,
			"book.opf":               pkg,
		}
		if protected {
			entries["META-INF/encryption.xml"] = "<encrypted/>"
		}
		for k, v := range entries {
			f, err := z.Create(k)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.Write([]byte(v)); err != nil {
				t.Fatal(err)
			}
		}
		if err := z.Close(); err != nil {
			t.Fatal(err)
		}
		return b.Bytes()
	}
	valid := makeBook("book.opf", "<package/>", false)
	overCount := bytes.Clone(valid)
	end := overCount[len(overCount)-22:]
	binary.LittleEndian.PutUint16(end[8:], maxEntries+1)
	binary.LittleEndian.PutUint16(end[10:], maxEntries+1)
	for _, tc := range []struct {
		name string
		data []byte
		want string
	}{
		{"valid", valid, StructureChecked},
		{"truncated", valid[:len(valid)/2], StructureDamaged},
		{"missing package", makeBook("missing.opf", "<package/>", false), StructureDamaged},
		{"broken package", makeBook("book.opf", "<package", false), StructureDamaged},
		{"wrong root", makeBook("book.opf", "<html/>", false), StructureDamaged},
		{"protected", makeBook("book.opf", "<package", true), ""},
		{"oversize", makeBook("book.opf", strings.Repeat("x", maxXMLBytes+1), false), ""},
		{"too many declared entries", overCount, ""},
		{"other format", []byte("%PDF-1.5"), ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := InspectEPUB(bytes.NewReader(tc.data), int64(len(tc.data))); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
	if got := InspectEPUB(failingEPUBRead{bytes.NewReader(valid)}, int64(len(valid))); got != "" {
		t.Fatalf("transient I/O was classified as %q", got)
	}
}

type failingEPUBRead struct{ *bytes.Reader }

func (r failingEPUBRead) ReadAt(p []byte, offset int64) (int, error) {
	if offset == 0 && len(p) == 4 {
		return r.Reader.ReadAt(p, offset)
	}
	return 0, errors.New("transient disk error")
}
