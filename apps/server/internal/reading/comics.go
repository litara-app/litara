package reading

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/comics"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/media"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Comic page extraction orchestration (ADR-0067). The engine lives in package
// comics; this file owns authorization, receipts, durable job rows, the cache
// budget and serving validated page images.

// Extractions enqueues a durable extraction job inside the row's transaction.
type Extractions interface {
	EnqueueExtract(ctx context.Context, tx pgx.Tx, id uuid.UUID) error
}

// ComicOptions configure extraction. A zero CacheDir leaves it unavailable (503).
type ComicOptions struct {
	MediaRoot   string
	CacheDir    string
	Limits      comics.Limits // lowered from the ADR defaults; never raised
	CacheBudget int64         // bytes; default 16 GiB
	// ActiveWindow protects recently served entries from eviction.
	ActiveWindow time.Duration
	Enqueuer     Extractions
}

type comicState struct {
	opts ComicOptions
	sem  chan struct{}
}

// EnableComics turns on page extraction for this service.
func (s *Service) EnableComics(o ComicOptions) {
	if o.CacheBudget <= 0 {
		o.CacheBudget = 16 << 30
	}
	if o.ActiveWindow <= 0 {
		o.ActiveWindow = 10 * time.Minute
	}
	o.Limits = comics.DefaultLimits().Lowered(o.Limits)
	s.comics = &comicState{opts: o, sem: make(chan struct{}, 2)}
}

type storedPage struct {
	Index   int    `json:"index"`
	EntryID string `json:"entryId"`
	Mime    string `json:"mime"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	File    string `json:"file"`
	Bytes   int64  `json:"bytes"`
}

func unavailableComics() error {
	return apperr.New(http.StatusServiceUnavailable, "comics_unavailable", "Comic page extraction is not configured on this server.")
}

func (s *Service) cacheDir(id uuid.UUID) string {
	return filepath.Join(s.comics.opts.CacheDir, "comics", id.String())
}

func (s *Service) manifestWire(row sqlcgen.ComicExtraction) (wire.T005PageManifest, error) {
	out := wire.T005PageManifest{FileID: row.FileID.String(), ContentVersion: row.ContentVersion.String(), ManifestVersion: row.ManifestVersion.String(),
		State: row.Status, Pages: []wire.T005Page{}, Issues: []wire.T005Issue{}}
	if err := json.Unmarshal(row.Issues, &out.Issues); err != nil {
		return out, err
	}
	if row.Status == "ready" {
		var pages []storedPage
		if err := json.Unmarshal(row.Pages, &pages); err != nil {
			return out, err
		}
		for _, p := range pages {
			out.Pages = append(out.Pages, wire.T005Page{Index: p.Index, EntryID: p.EntryID, MimeType: p.Mime, Width: p.Width, Height: p.Height,
				ContentPath: fmt.Sprintf("%s/files/%s/versions/%s/pages/%d", s.cat.Base(), row.FileID, row.ContentVersion, p.Index)})
		}
	}
	return out, nil
}

// PrepareComicPages records a user-triggered extraction request and returns the
// current manifest state. It is idempotent per file version and profile.
func (s *Service) PrepareComicPages(ctx context.Context, a Actor, fileID, version uuid.UUID, w wire.T005Extraction) (wire.T005PageManifest, error) {
	if s.comics == nil || s.comics.opts.CacheDir == "" {
		return wire.T005PageManifest{}, unavailableComics()
	}
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.T005PageManifest{}, err
	}
	if _, err = parseRev(w.BaseRevision); err != nil {
		return wire.T005PageManifest{}, err
	}
	bodyVersion, err := parseUUID("contentVersion", w.ContentVersion)
	if err != nil {
		return wire.T005PageManifest{}, err
	}
	_, _, err = s.cat.ComicFormat(ctx, a.UserID, fileID, version) // authorize before anything else is judged
	if err != nil {
		return wire.T005PageManifest{}, err
	}
	if bodyVersion != version {
		return wire.T005PageManifest{}, apperr.Validation("contentVersion must match the content version in the path.")
	}
	fp := fingerprint(http.MethodPost, "/files/"+fileID.String()+"/versions/"+version.String()+"/pages", w)
	body, err := s.runTx(ctx, a, op, fp, func(q *sqlcgen.Queries) error {
		return q.LockPersonalKey(ctx, "comic:"+fileID.String()+":"+version.String())
	}, func(tx pgx.Tx, q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		row, err := q.InsertExtraction(ctx, sqlcgen.InsertExtractionParams{FileID: fileID, ContentVersion: version, Profile: comics.Profile, Status: "processing"})
		created := err == nil
		if errors.Is(err, pgx.ErrNoRows) {
			row, err = q.GetExtraction(ctx, sqlcgen.GetExtractionParams{FileID: fileID, ContentVersion: version, Profile: comics.Profile})
		}
		if err != nil {
			return nil, nil, err
		}
		switch {
		case created || row.Status == "incomplete":
			if !created {
				if err := q.SetExtractionProcessing(ctx, row.ID); err != nil {
					return nil, nil, err
				}
			}
			if err := s.enqueue(ctx, tx, row.ID); err != nil {
				return nil, nil, err
			}
		}
		row, err = q.GetExtractionByID(ctx, row.ID)
		if err != nil {
			return nil, nil, err
		}
		m, err := s.manifestWire(row)
		return wire.Raw(m), nil, err
	})
	if err != nil {
		return wire.T005PageManifest{}, err
	}
	var out wire.T005PageManifest
	return out, json.Unmarshal(body, &out)
}

// enqueue inserts the job in the caller's transaction so the row and its job commit together.
func (s *Service) enqueue(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	if s.comics.opts.Enqueuer == nil {
		return unavailableComics()
	}
	return s.comics.opts.Enqueuer.EnqueueExtract(ctx, tx, id)
}

// ComicManifest returns the stored manifest without starting a job.
func (s *Service) ComicManifest(ctx context.Context, userID, fileID, version uuid.UUID) (wire.T005PageManifest, error) {
	row, err := s.comicRow(ctx, userID, fileID, version)
	if err != nil {
		return wire.T005PageManifest{}, err
	}
	return s.manifestWire(row)
}

func (s *Service) comicRow(ctx context.Context, userID, fileID, version uuid.UUID) (sqlcgen.ComicExtraction, error) {
	if s.comics == nil {
		return sqlcgen.ComicExtraction{}, unavailableComics()
	}
	if _, _, err := s.cat.ComicFormat(ctx, userID, fileID, version); err != nil {
		return sqlcgen.ComicExtraction{}, err
	}
	row, err := s.q.GetExtraction(ctx, sqlcgen.GetExtractionParams{FileID: fileID, ContentVersion: version, Profile: comics.Profile})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, apperr.New(http.StatusNotFound, "pages_not_prepared", "No page extraction was requested for this file version.")
	}
	return row, dbErr(err)
}

// ComicPageFile is a validated cached page ready to stream.
type ComicPageFile struct {
	File *os.File
	Mime string
	Size int64
	ETag string
}

// ComicPage opens one cached page after authorizing the caller again.
func (s *Service) ComicPage(ctx context.Context, userID, fileID, version uuid.UUID, index int) (ComicPageFile, error) {
	row, err := s.comicRow(ctx, userID, fileID, version)
	if err != nil {
		return ComicPageFile{}, err
	}
	switch row.Status {
	case "ready":
	case "unsupported":
		var issues []wire.T005Issue
		_ = json.Unmarshal(row.Issues, &issues)
		code, detail := comics.CodeUnsupported, "The archive cannot be read as comic pages."
		if len(issues) > 0 {
			code, detail = issues[0].Code, issues[0].Detail
		}
		return ComicPageFile{}, apperr.New(http.StatusConflict, code, detail)
	default:
		return ComicPageFile{}, apperr.New(http.StatusConflict, "pages_not_ready", "The pages are not ready yet.")
	}
	var pages []storedPage
	if err := json.Unmarshal(row.Pages, &pages); err != nil {
		return ComicPageFile{}, dbErr(err)
	}
	if index < 0 || index >= len(pages) {
		return ComicPageFile{}, apperr.ErrNotFound
	}
	p := pages[index]
	f, err := os.Open(filepath.Join(s.cacheDir(row.ID), p.File))
	if err != nil {
		return ComicPageFile{}, apperr.New(http.StatusConflict, "pages_not_ready", "The cached page is no longer available; request the pages again.")
	}
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		f.Close()
		return ComicPageFile{}, apperr.New(http.StatusConflict, "pages_not_ready", "The cached page is no longer available; request the pages again.")
	}
	go func() { _ = s.q.TouchExtraction(context.WithoutCancel(ctx), row.ID) }()
	return ComicPageFile{File: f, Mime: p.Mime, Size: st.Size(), ETag: fmt.Sprintf("%q", fmt.Sprintf("%s-%d", row.ManifestVersion, p.Index))}, nil
}

// RunExtraction executes one persisted extraction (the job body). It is
// idempotent: a row that is no longer processing is left alone.
func (s *Service) RunExtraction(ctx context.Context, id uuid.UUID) error {
	if s.comics == nil {
		return unavailableComics()
	}
	row, err := s.q.GetExtractionByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil || row.Status != "processing" {
		return err
	}
	select {
	case s.comics.sem <- struct{}{}: // at most two extractions per server
		defer func() { <-s.comics.sem }()
	case <-ctx.Done():
		return ctx.Err()
	}
	finish := func(status string, issues []wire.T005Issue, pages []byte, bytes int64) error {
		return s.q.SetExtractionResult(ctx, sqlcgen.SetExtractionResultParams{ID: id, Status: status, Pages: pages, Issues: wire.Raw(issues), CacheBytes: bytes})
	}
	fv, err := s.q.GetFileVersionForExtraction(ctx, sqlcgen.GetFileVersionForExtractionParams{FileID: row.FileID, ContentVersion: row.ContentVersion})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (!fv.Current || !fv.Available || fv.SizeBytes == nil)) {
		return finish("incomplete", []wire.T005Issue{{Code: "content_changed", Detail: "The file version is no longer current."}}, []byte("[]"), 0)
	}
	if err != nil {
		return err
	}
	src, err := media.Open(s.comics.opts.MediaRoot, fv.Locator, *fv.SizeBytes)
	if err != nil {
		return finish("incomplete", []wire.T005Issue{{Code: "file_unavailable", Detail: "The original file cannot be read."}}, []byte("[]"), 0)
	}
	src.Close()
	dst := s.cacheDir(id)
	res, xerr := comics.Extract(ctx, fv.Locator, dst, s.comics.opts.Limits, comics.Hooks{Reserve: func(n int64) error { return s.reserve(ctx, id, n) }})
	if xerr != nil {
		_ = os.RemoveAll(dst)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var ce *comics.Error
		if errors.As(xerr, &ce) {
			status := "unsupported"
			if ce.Code == "cache_full" {
				status = "incomplete"
			}
			return finish(status, []wire.T005Issue{{Code: ce.Code, Detail: ce.Detail}}, []byte("[]"), 0)
		}
		return finish("incomplete", []wire.T005Issue{{Code: "extraction_failed", Detail: "The pages could not be extracted; request them again to retry."}}, []byte("[]"), 0)
	}
	pages := make([]storedPage, 0, len(res.Pages))
	for _, p := range res.Pages {
		pages = append(pages, storedPage{Index: p.Index, EntryID: p.EntryID, Mime: p.Mime, Width: p.Width, Height: p.Height, File: p.File, Bytes: p.Bytes})
	}
	return finish("ready", []wire.T005Issue{}, wire.Raw(pages), res.Bytes)
}

// reserve claims cache budget for an extraction, evicting inactive entries
// least-recently-used first. Entries served within ActiveWindow are protected.
func (s *Service) reserve(ctx context.Context, id uuid.UUID, need int64) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if err := q.LockPersonalKey(ctx, "comic-cache"); err != nil {
			return err
		}
		used, err := q.SumCacheExcluding(ctx, id)
		if err != nil {
			return err
		}
		budget := s.comics.opts.CacheBudget
		if used+need > budget {
			cands, err := q.ListEvictableExtractions(ctx, sqlcgen.ListEvictableExtractionsParams{ID: id, InactiveSecs: s.comics.opts.ActiveWindow.Seconds()})
			if err != nil {
				return err
			}
			for _, c := range cands {
				if used+need <= budget {
					break
				}
				_ = os.RemoveAll(s.cacheDir(c.ID))
				if err := q.EvictExtraction(ctx, c.ID); err != nil {
					return err
				}
				used -= c.CacheBytes
			}
		}
		if used+need > budget {
			return &comics.Error{Code: "cache_full", Detail: "The page cache cannot hold this archive while other entries are active."}
		}
		return q.SetExtractionReserved(ctx, sqlcgen.SetExtractionReservedParams{ID: id, ReservedBytes: need})
	})
}
