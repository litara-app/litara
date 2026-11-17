package comics

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/deranjer/ebooker/apps/server/internal/comics/archivetest"
)

// RAR and 7z extraction (ADR-0072): ordinary archives read in natural page order, and every hostile
// or unsupported shape is refused with a typed reason before bytes are trusted.

func tmp(t *testing.T, name string) string { return filepath.Join(t.TempDir(), name) }

func pageNames(res Result) []string {
	var out []string
	for _, p := range res.Pages {
		out = append(out, p.File)
	}
	return out
}

func TestRARStoredPagesInNaturalOrder(t *testing.T) {
	p := tmp(t, "a.cbr")
	if err := archivetest.WriteRAR5(p, []archivetest.RarEntry{
		{Name: "pages/10.png", Data: pngBytes(4, 4)}, {Name: "pages/2.png", Data: pngBytes(5, 5)}, {Name: "pages/1.png", Data: pngBytes(6, 6)},
		{Name: "ComicInfo.xml", Data: []byte("<x/>")}, {Name: "pages", Dir: true},
	}); err != nil {
		t.Fatal(err)
	}
	res, dst, err := extract(t, p, DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Pages) != 3 || res.Pages[0].Width != 6 || res.Pages[1].Width != 5 || res.Pages[2].Width != 4 {
		t.Fatalf("pages are not in natural order 1, 2, 10: %+v", res.Pages)
	}
	for _, f := range pageNames(res) {
		if _, serr := os.Stat(filepath.Join(dst, f)); serr != nil {
			t.Fatal(serr)
		}
	}
	// The same entry must keep its identity whatever the container (path-derived, not format-derived).
	zp := makeZip(t, ent{name: "pages/1.png", data: pngBytes(6, 6)}, ent{name: "pages/2.png", data: pngBytes(5, 5)}, ent{name: "pages/10.png", data: pngBytes(4, 4)})
	zres, _, zerr := extract(t, zp, DefaultLimits())
	if zerr != nil {
		t.Fatal(zerr)
	}
	for i := range res.Pages {
		if res.Pages[i].EntryID != zres.Pages[i].EntryID {
			t.Fatalf("entry IDs differ between RAR and ZIP at page %d", i)
		}
	}
}

func TestRARHostileShapesAreRefused(t *testing.T) {
	big := uint64(1) << 40
	cases := []struct {
		name    string
		entries []archivetest.RarEntry
		want    string
	}{
		{"traversal", []archivetest.RarEntry{{Name: "../escape.png", Data: pngBytes(2, 2)}, {Name: "1.png", Data: pngBytes(2, 2)}}, CodeUnsupported},
		{"absolute path", []archivetest.RarEntry{{Name: "/etc/1.png", Data: pngBytes(2, 2)}}, CodeUnsupported},
		{"symlink", []archivetest.RarEntry{{Name: "1.png", Data: pngBytes(2, 2)}, {Name: "link.png", Symlink: "/etc/passwd"}}, CodeUnsupported},
		{"encrypted entry", []archivetest.RarEntry{{Name: "1.png", Data: pngBytes(2, 2), Encrypted: true}}, CodeUnsupported},
		{"unknown size", []archivetest.RarEntry{{Name: "1.png", Data: pngBytes(2, 2), UnknownSize: true}}, CodeUnsupported},
		{"declared size over the per-entry ceiling", []archivetest.RarEntry{{Name: "1.png", Data: pngBytes(2, 2), DeclaredSize: &big}}, CodeLimit},
		{"nested archive", []archivetest.RarEntry{{Name: "1.png", Data: pngBytes(2, 2)}, {Name: "more.zip", Data: []byte("PK")}}, CodeUnsupported},
		{"duplicate normalized paths", []archivetest.RarEntry{{Name: "A.png", Data: pngBytes(2, 2)}, {Name: "a.png", Data: pngBytes(2, 2)}}, CodeUnsupported},
		{"no pages", []archivetest.RarEntry{{Name: "notes.txt", Data: []byte("hi")}}, CodeUnsupported},
		{"not an image", []archivetest.RarEntry{{Name: "1.png", Data: []byte("this is not a png at all, just text")}}, CodeUnsupported},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := tmp(t, "x.cbr")
			if err := archivetest.WriteRAR5(p, c.entries); err != nil {
				t.Fatal(err)
			}
			_, dst, err := extract(t, p, DefaultLimits())
			if code(err) != c.want {
				t.Fatalf("got %v (code %q), want code %q", err, code(err), c.want)
			}
			if _, serr := os.Stat(dst); serr == nil {
				t.Fatal("a refused archive left published output")
			}
		})
	}
}

func TestRARCountAndSizeCeilings(t *testing.T) {
	var many []archivetest.RarEntry
	for i := 0; i < 30; i++ {
		many = append(many, archivetest.RarEntry{Name: strings.Repeat("a", 1) + string(rune('a'+i%26)) + string(rune('a'+i/26)) + ".png", Data: pngBytes(2, 2)})
	}
	p := tmp(t, "many.cbr")
	if err := archivetest.WriteRAR5(p, many); err != nil {
		t.Fatal(err)
	}
	lim := DefaultLimits()
	lim.MaxEntries = 10
	if _, _, err := extract(t, p, lim); code(err) != CodeLimit {
		t.Fatalf("entry ceiling not enforced: %v", err)
	}
	lim = DefaultLimits()
	lim.MaxPages = 10
	if _, _, err := extract(t, p, lim); code(err) != CodeLimit {
		t.Fatalf("page ceiling not enforced: %v", err)
	}
}

func TestRARDictionaryAboveTheCeilingIsRefused(t *testing.T) {
	// The library limits a dictionary to the entry's declared size, so a tiny archive cannot demand a huge one;
	// what it can demand is bounded by the per-entry ceiling, and a lowered dictionary ceiling still wins.
	declared := uint64(10 << 20)
	p := tmp(t, "dict.cbr")
	if err := archivetest.WriteRAR5(p, []archivetest.RarEntry{{Name: "1.png", Data: []byte("not real compressed data"), Method: 3, DictLog: 15, DeclaredSize: &declared}}); err != nil {
		t.Fatal(err)
	}
	lim := DefaultLimits()
	lim.MaxDictionary = 1 << 20
	_, dst, err := extract(t, p, lim)
	if code(err) != CodeLimit {
		t.Fatalf("got %v (code %q), want a limit refusal", err, code(err))
	}
	if _, serr := os.Stat(dst); serr == nil {
		t.Fatal("a refused archive left published output")
	}
}

func TestRARDictionaryCeilingIsConfigurable(t *testing.T) {
	// A stored (method 0) file ignores its dictionary, so an ordinary archive passes any ceiling.
	p := tmp(t, "ok.cbr")
	if err := archivetest.WriteRAR5(p, []archivetest.RarEntry{{Name: "1.png", Data: pngBytes(2, 2), DictLog: 3}}); err != nil {
		t.Fatal(err)
	}
	lim := DefaultLimits()
	lim.MaxDictionary = 1 << 20
	if _, _, err := extract(t, p, lim); err != nil {
		t.Fatalf("stored archive refused: %v", err)
	}
}

func TestRARSpanningVolumesAreRefused(t *testing.T) {
	// A file that declares more packed data than the archive holds looks like a continuation into a
	// next volume; the reader may only see this one file, so it must fail cleanly.
	p := tmp(t, "cut.cbr")
	if err := archivetest.WriteRAR5(p, []archivetest.RarEntry{{Name: "1.png", Data: pngBytes(40, 40)}, {Name: "2.png", Data: pngBytes(40, 40)}}); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	if err := os.WriteFile(p, b[:len(b)-len(b)/3], 0o600); err != nil { // truncate inside the second file
		t.Fatal(err)
	}
	if _, _, err := extract(t, p, DefaultLimits()); err == nil {
		t.Fatal("a truncated archive was accepted")
	}
}

func TestSevenZipRealArchivesDecode(t *testing.T) {
	for _, name := range []string{"solid-lzma2.7z", "lzma.7z"} {
		t.Run(name, func(t *testing.T) {
			res, _, err := extract(t, filepath.Join("testdata", name), DefaultLimits())
			if err != nil {
				t.Fatal(err)
			}
			if len(res.Pages) != 3 || res.Pages[0].Width != 24 || res.Pages[2].Height != 36 {
				t.Fatalf("unexpected pages: %+v", res.Pages)
			}
		})
	}
}

func TestSevenZipEncryptedArchivesAreRefused(t *testing.T) {
	for _, name := range []string{"encrypted-data.7z", "encrypted-headers.7z"} {
		t.Run(name, func(t *testing.T) {
			_, dst, err := extract(t, filepath.Join("testdata", name), DefaultLimits())
			if err == nil {
				t.Fatal("an encrypted 7z was accepted")
			}
			if _, serr := os.Stat(dst); serr == nil {
				t.Fatal("published output for an encrypted archive")
			}
		})
	}
}

func TestSevenZipStoredPagesAndHostileShapes(t *testing.T) {
	ok := tmp(t, "ok.cb7")
	if err := archivetest.WriteSevenZip(ok, []archivetest.SevenEntry{
		{Name: "pages/10.png", Data: pngBytes(4, 4)}, {Name: "pages/1.png", Data: pngBytes(6, 6)}, {Name: "pages/2.png", Data: pngBytes(5, 5)},
	}, archivetest.SevenOpts{}); err != nil {
		t.Fatal(err)
	}
	res, _, err := extract(t, ok, DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Pages) != 3 || res.Pages[0].Width != 6 || res.Pages[2].Width != 4 {
		t.Fatalf("natural order broken: %+v", res.Pages)
	}

	cases := []struct {
		name    string
		entries []archivetest.SevenEntry
		opts    archivetest.SevenOpts
		want    string
	}{
		{"traversal", []archivetest.SevenEntry{{Name: "../x.png", Data: pngBytes(2, 2)}}, archivetest.SevenOpts{}, CodeUnsupported},
		{"symlink", []archivetest.SevenEntry{{Name: "1.png", Data: pngBytes(2, 2)}, {Name: "l.png", Data: []byte("/etc/passwd"), Attributes: 0x8000 | 0xA1FF<<16}}, archivetest.SevenOpts{}, CodeUnsupported},
		// LZMA2 property byte 36 asks for a 1 GiB dictionary; LZMA props ask for 1 GiB too.
		{"lzma2 dictionary over the ceiling", []archivetest.SevenEntry{{Name: "1.png", Data: []byte("junk")}}, archivetest.SevenOpts{CoderID: []byte{0x21}, CoderProps: []byte{36}}, CodeLimit},
		{"lzma dictionary over the ceiling", []archivetest.SevenEntry{{Name: "1.png", Data: []byte("junk")}}, archivetest.SevenOpts{CoderID: []byte{0x03, 0x01, 0x01}, CoderProps: []byte{0x5d, 0, 0, 0, 0x40}}, CodeLimit},
		{"ppmd is not accepted", []archivetest.SevenEntry{{Name: "1.png", Data: []byte("junk")}}, archivetest.SevenOpts{CoderID: []byte{0x03, 0x04, 0x01}, CoderProps: []byte{6, 0, 0, 0, 1}}, CodeUnsupported},
		{"zstd is not accepted", []archivetest.SevenEntry{{Name: "1.png", Data: []byte("junk")}}, archivetest.SevenOpts{CoderID: []byte{0x04, 0xf7, 0x11, 0x01}, CoderProps: []byte{1, 0, 0, 0, 0}}, CodeUnsupported},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := tmp(t, "h.cb7")
			if err := archivetest.WriteSevenZip(p, c.entries, c.opts); err != nil {
				t.Fatal(err)
			}
			_, dst, err := extract(t, p, DefaultLimits())
			if code(err) != c.want {
				t.Fatalf("got %v (code %q), want %q", err, code(err), c.want)
			}
			if _, serr := os.Stat(dst); serr == nil {
				t.Fatal("a refused archive left published output")
			}
		})
	}
}

func TestSevenZipEntryCeiling(t *testing.T) {
	var many []archivetest.SevenEntry
	for i := 0; i < 30; i++ {
		many = append(many, archivetest.SevenEntry{Name: string(rune('a'+i%26)) + string(rune('a'+i/26)) + ".png", Data: pngBytes(2, 2)})
	}
	p := tmp(t, "many.cb7")
	if err := archivetest.WriteSevenZip(p, many, archivetest.SevenOpts{}); err != nil {
		t.Fatal(err)
	}
	lim := DefaultLimits()
	lim.MaxEntries = 10
	if _, _, err := extract(t, p, lim); code(err) != CodeLimit {
		t.Fatalf("entry ceiling not enforced: %v", err)
	}
}

func TestFormatIsChosenByContentNotExtension(t *testing.T) {
	// A ZIP named .cbr (common in the wild) still reads, and a RAR named .cbz is still a RAR.
	zp := makeZip(t, ent{name: "1.png", data: pngBytes(3, 3)})
	asCBR := tmp(t, "really-zip.cbr")
	b, _ := os.ReadFile(zp)
	if err := os.WriteFile(asCBR, b, 0o600); err != nil {
		t.Fatal(err)
	}
	if res, _, err := extract(t, asCBR, DefaultLimits()); err != nil || len(res.Pages) != 1 {
		t.Fatalf("zip with a cbr name: %v", err)
	}
	rp := tmp(t, "really-rar.cbz")
	if err := archivetest.WriteRAR5(rp, []archivetest.RarEntry{{Name: "1.png", Data: pngBytes(3, 3)}}); err != nil {
		t.Fatal(err)
	}
	if res, _, err := extract(t, rp, DefaultLimits()); err != nil || len(res.Pages) != 1 {
		t.Fatalf("rar with a cbz name: %v", err)
	}
}

func TestSevenZipHeaderClaimsAreBoundedBeforeAllocation(t *testing.T) {
	// The library allocates ~130 bytes per *claimed* file before validating the claim; a tiny
	// archive claiming billions of files must be refused by the pre-check, plain or LZMA-encoded.
	for _, encode := range []bool{false, true} {
		for _, claim := range []uint64{1 << 20, 1 << 32} {
			p := tmp(t, "bomb.cb7")
			if err := archivetest.WriteSevenZip(p, []archivetest.SevenEntry{{Name: "1.png", Data: pngBytes(2, 2)}},
				archivetest.SevenOpts{FilesClaim: claim, EncodeHeader: encode}); err != nil {
				t.Fatal(err)
			}
			fi, _ := os.Stat(p)
			_, dst, err := extract(t, p, DefaultLimits())
			if code(err) != CodeLimit {
				t.Fatalf("encoded=%v claim=%d (file %d bytes): got %v, want an entry-limit refusal", encode, claim, fi.Size(), err)
			}
			if _, serr := os.Stat(dst); serr == nil {
				t.Fatal("a refused archive left published output")
			}
		}
	}
}

func TestSevenZipEncodedHeaderArchivesStillWork(t *testing.T) {
	p := tmp(t, "enc.cb7")
	if err := archivetest.WriteSevenZip(p, []archivetest.SevenEntry{{Name: "1.png", Data: pngBytes(7, 7)}, {Name: "2.png", Data: pngBytes(8, 8)}},
		archivetest.SevenOpts{EncodeHeader: true}); err != nil {
		t.Fatal(err)
	}
	res, _, err := extract(t, p, DefaultLimits())
	if err != nil || len(res.Pages) != 2 || res.Pages[1].Width != 8 {
		t.Fatalf("an LZMA-encoded header was not accepted: %v %+v", err, res.Pages)
	}
}

func TestSevenZipTruncationsNeverPanicOrAllocateWildly(t *testing.T) {
	good, err := os.ReadFile(filepath.Join("testdata", "solid-lzma2.7z"))
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < len(good); n++ { // every prefix, and every single-byte corruption of the header tail
		p := tmp(t, "cut.7z")
		if err := os.WriteFile(p, good[:n], 0o600); err != nil {
			t.Fatal(err)
		}
		_, _, _ = extract(t, p, DefaultLimits()) // must return, typed or not, never panic
	}
	for i := 32; i < len(good); i++ {
		b := append([]byte{}, good...)
		b[i] ^= 0xFF
		p := tmp(t, "flip.7z")
		if err := os.WriteFile(p, b, 0o600); err != nil {
			t.Fatal(err)
		}
		_, _, _ = extract(t, p, DefaultLimits())
	}
}

func TestSevenZipFolderAndStreamClaimsAreBoundedBeforeAllocation(t *testing.T) {
	// A folder costs about three header bytes but the library allocates far more for each, so the
	// header size alone does not bound memory; the entry ceiling must also bound folders and streams.
	for _, n := range []int{DefaultLimits().MaxEntries + 1, 2_000_000} {
		p := tmp(t, "folders.cb7")
		if err := archivetest.WriteSevenZipFolderBomb(p, n); err != nil {
			t.Fatal(err)
		}
		fi, _ := os.Stat(p)
		_, dst, err := extract(t, p, DefaultLimits())
		if code(err) != CodeLimit {
			t.Fatalf("%d folders (file %d bytes): got %v, want a limit refusal", n, fi.Size(), err)
		}
		if _, serr := os.Stat(dst); serr == nil {
			t.Fatal("a refused archive left published output")
		}
	}
}

func TestSevenZipFolderCeilingFollowsConfiguredEntryLimit(t *testing.T) {
	p := tmp(t, "few.cb7")
	if err := archivetest.WriteSevenZipFolderBomb(p, 50); err != nil {
		t.Fatal(err)
	}
	lim := DefaultLimits()
	lim.MaxEntries = 10
	if _, _, err := extract(t, p, lim); code(err) != CodeLimit {
		t.Fatalf("got %v, want a limit refusal at a lowered ceiling", err)
	}
}
