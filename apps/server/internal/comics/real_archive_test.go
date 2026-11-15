package comics

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// TestRealArchiveFromEnvironment runs the extractor on a real comic archive the developer provides, e.g.
//
//	LITARA_TEST_REAL_ARCHIVE=/path/to/issue.cbr go test ./internal/comics -run RealArchive -v
//
// It is skipped when the variable is unset, so no real (copyrighted) file is ever part of the repository.
func TestRealArchiveFromEnvironment(t *testing.T) {
	src := os.Getenv("LITARA_TEST_REAL_ARCHIVE")
	if src == "" {
		t.Skip("set LITARA_TEST_REAL_ARCHIVE to a real CBR/CB7/CBZ file to run this")
	}
	st, err := os.Stat(src)
	if err != nil {
		t.Fatal(err)
	}
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	start := time.Now()
	dst := filepath.Join(t.TempDir(), "out")
	res, err := Extract(t.Context(), src, dst, DefaultLimits(), Hooks{})
	elapsed := time.Since(start)
	runtime.ReadMemStats(&after)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	t.Logf("archive %d bytes -> %d pages, %d bytes expanded in %v (total allocated %d MiB, heap in use after %d MiB)",
		st.Size(), len(res.Pages), res.Bytes, elapsed, (after.TotalAlloc-before.TotalAlloc)>>20, after.HeapInuse>>20)
	if len(res.Pages) == 0 {
		t.Fatal("no pages")
	}
	for i, p := range res.Pages {
		if i < 3 || i == len(res.Pages)-1 {
			t.Logf("page %d: %s %dx%d %d bytes (%s)", i, p.Mime, p.Width, p.Height, p.Bytes, p.File)
		}
		if _, err := os.Stat(filepath.Join(dst, p.File)); err != nil {
			t.Fatalf("page %d missing on disk: %v", i, err)
		}
	}
	t.Logf("skipped entries: %v", res.Skipped)
}
