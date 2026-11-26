package httpapi_test

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/deranjer/ebooker/apps/server/internal/apitest"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// archive-restart-cache: an extraction interrupted part-way (the job's context ends) must leave the
// request readable as "still processing", publish nothing, and complete when the durable job runs again
// after a restart, with the same manifest identity and without a second job row.
func TestInterruptedExtractionRecoversOnRestart(t *testing.T) {
	c := newComicEnv(t, apitest.Options{})
	e := c.e
	files := map[string]string{"ComicInfo.xml": "<ComicInfo/>"}
	for i := 1; i <= 60; i++ {
		files[fmt.Sprintf("p/%03d.png", i)] = pngPage(40+i, 60)
	}
	path := filepath.Join(c.root, "Hero", "long.cbz")
	writeZip(t, path, files)
	scanTwice(t, e, c.admin, c.lib)
	ed := c.edition(t, "CBZ")

	var m wire.ComicPageManifest
	first := e.Do("POST", pagesPath(ed), c.userA, extraction(ed.File.ContentVersion))
	first.JSON(t, &m)
	if first.StatusCode != 202 || m.State != "processing" {
		t.Fatalf("prepare: %d %+v", first.StatusCode, m)
	}
	ids := e.Queue.DrainExtracts()
	if len(ids) != 1 {
		t.Fatalf("one durable job expected, got %d", len(ids))
	}
	id := ids[0]
	manifestVersion := m.ManifestVersion

	// 1. The worker is stopped before it can finish (shutdown or crash): the job reports the interruption,
	//    so the queue would retry it, and nothing partial is visible.
	for name, ctx := range map[string]func() (context.Context, context.CancelFunc){
		"cancelled before start": func() (context.Context, context.CancelFunc) {
			c, cancel := context.WithCancel(context.Background())
			cancel()
			return c, cancel
		},
		"deadline passes during extraction": func() (context.Context, context.CancelFunc) {
			return context.WithTimeout(context.Background(), time.Nanosecond)
		},
	} {
		ctx, cancel := ctx()
		err := e.Reading.RunExtraction(ctx, id)
		cancel()
		if err == nil {
			t.Fatalf("%s: an interrupted job reported success", name)
		}
		e.Do("GET", pagesPath(ed), c.userA, nil).JSON(t, &m)
		if m.State != "processing" || len(m.Pages) != 0 {
			t.Fatalf("%s: manifest after interruption: %+v", name, m)
		}
		if x := e.Do("GET", pagesPath(ed)+"/0", c.userA, nil); x.StatusCode != 409 || x.Code() != "pages_not_ready" {
			t.Fatalf("%s: a page of an interrupted extraction was served: %d %s", name, x.StatusCode, x.Body)
		}
	}

	// 2. Asking again while the job is still pending creates no second job and does not restart the clock.
	again := e.Do("POST", pagesPath(ed), c.userA, extraction(ed.File.ContentVersion))
	again.JSON(t, &m)
	if again.StatusCode != 202 || m.State != "processing" || m.ManifestVersion != manifestVersion {
		t.Fatalf("re-request during recovery: %d %+v", again.StatusCode, m)
	}
	if n := len(e.Queue.DrainExtracts()); n != 0 {
		t.Fatalf("a re-request enqueued %d extra jobs", n)
	}

	// 3. The restarted worker runs the same durable job to completion.
	if err := e.Reading.RunExtraction(context.Background(), id); err != nil {
		t.Fatalf("restart run: %v", err)
	}
	e.Do("GET", pagesPath(ed), c.userA, nil).JSON(t, &m)
	if m.State != "ready" || len(m.Pages) != 60 || m.ManifestVersion != manifestVersion {
		t.Fatalf("after restart: state=%s pages=%d manifest=%s (was %s)", m.State, len(m.Pages), m.ManifestVersion, manifestVersion)
	}
	if m.Pages[0].Width != 41 || m.Pages[59].Width != 100 {
		t.Fatalf("recovered pages out of order: first %d last %d", m.Pages[0].Width, m.Pages[59].Width)
	}
	if x := e.Do("GET", pagesPath(ed)+"/59", c.userA, nil); x.StatusCode != 200 {
		t.Fatalf("last recovered page: %d", x.StatusCode)
	}

	// 4. A duplicate delivery of the finished job (the queue may redeliver) is harmless.
	if err := e.Reading.RunExtraction(context.Background(), id); err != nil {
		t.Fatalf("redelivery: %v", err)
	}
	var after wire.ComicPageManifest
	e.Do("GET", pagesPath(ed), c.userA, nil).JSON(t, &after)
	if after.State != "ready" || len(after.Pages) != 60 || after.ManifestVersion != manifestVersion {
		t.Fatalf("redelivery changed the manifest: %+v", after)
	}
}
