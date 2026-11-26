package covers

import (
	"bytes"
	"context"
	"errors"
	"os"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/media"
)

// Mediums a cover can belong to.
const (
	Ebook = "ebook"
	Audio = "audio"
)

// Meta describes the stored cover of one slot.
type Meta struct {
	Source  string
	Version uuid.UUID
}

type Service struct {
	pool      *pgxpool.Pool
	q         *sqlcgen.Queries
	mediaRoot string
	fetcher   *Fetcher
	searcher  *Searcher
}

func New(pool *pgxpool.Pool, mediaRoot string, f *Fetcher, s *Searcher) *Service {
	return &Service{pool: pool, q: sqlcgen.New(pool), mediaRoot: mediaRoot, fetcher: f, searcher: s}
}

func rejected(err error) error {
	switch {
	case errors.Is(err, ErrNotAnImage), errors.Is(err, ErrTooLarge), errors.Is(err, ErrForbiddenAddress), errors.Is(err, ErrNoCover):
		return apperr.Validation(err.Error())
	}
	return apperr.Validation("The cover could not be fetched: " + err.Error())
}

// Image returns the cover for a title and medium, extracting one from the files the first time it is asked for. A title
// whose files hold no cover returns apperr.ErrNotFound, and that result is remembered.
func (s *Service) Image(ctx context.Context, titleID uuid.UUID, medium string) ([]byte, uuid.UUID, error) {
	row, err := s.q.GetTitleCover(ctx, sqlcgen.GetTitleCoverParams{TitleID: titleID, Medium: medium})
	if err == nil {
		if row.Source == "none" || row.Image == nil {
			return nil, uuid.Nil, apperr.ErrNotFound
		}
		return row.Image, row.Version, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, uuid.Nil, apperr.ErrUnavailable
	}
	img, xerr := s.extract(ctx, titleID, medium)
	if xerr != nil && !errors.Is(xerr, ErrNoCover) {
		return nil, uuid.Nil, apperr.ErrUnavailable
	}
	src := "extracted"
	if xerr != nil {
		src, img = "none", nil
	}
	m, err := s.store(ctx, titleID, medium, src, img, uuid.Nil)
	if err != nil || img == nil {
		return nil, uuid.Nil, apperr.ErrNotFound
	}
	return img, m.Version, nil
}

func (s *Service) store(ctx context.Context, titleID uuid.UUID, medium, source string, img []byte, by uuid.UUID) (Meta, error) {
	updatedBy := uuid.NullUUID{UUID: by, Valid: by != uuid.Nil}
	r, err := s.q.UpsertTitleCover(ctx, sqlcgen.UpsertTitleCoverParams{TitleID: titleID, Medium: medium, Source: source, Image: img, UpdatedBy: updatedBy})
	if err != nil {
		return Meta{}, apperr.ErrUnavailable
	}
	return Meta{Source: r.Source, Version: r.Version}, nil
}

// extract reads a cover out of the title's own files; it changes nothing on disk.
func (s *Service) extract(ctx context.Context, titleID uuid.UUID, medium string) ([]byte, error) {
	if medium == Audio {
		rows, err := s.q.ListTitleRecordingCovers(ctx, titleID)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			if r.CoverLocator == nil {
				continue
			}
			f, err := os.Open(*r.CoverLocator)
			if err != nil {
				continue
			}
			img, nerr := Normalize(f)
			f.Close()
			if nerr == nil {
				return img, nil
			}
		}
		return nil, ErrNoCover
	}
	files, err := s.q.ListTitleEbookFiles(ctx, titleID)
	if err != nil {
		return nil, err
	}
	for _, fl := range files {
		size := int64(0)
		if fl.SizeBytes != nil {
			size = *fl.SizeBytes
		}
		f, err := media.Open(s.mediaRoot, fl.Locator, size)
		if err != nil {
			continue
		}
		raw, xerr := FromFile(fl.Format, f, sizeOf(f, size))
		f.Close()
		if xerr != nil {
			continue
		}
		if img, nerr := Normalize(bytes.NewReader(raw)); nerr == nil {
			return img, nil
		}
	}
	return nil, ErrNoCover
}

func sizeOf(f *os.File, fallback int64) int64 {
	if st, err := f.Stat(); err == nil {
		return st.Size()
	}
	return fallback
}

// Prepare re-encodes an uploaded image under the cover limits without storing it, for other stored pictures
// (author photos, ADR-0105).
func (s *Service) Prepare(data []byte) ([]byte, error) {
	img, err := Normalize(bytes.NewReader(data))
	if err != nil {
		return nil, rejected(err)
	}
	return img, nil
}

// Upload stores an uploaded image as the title's cover.
func (s *Service) Upload(ctx context.Context, titleID uuid.UUID, medium string, data []byte, by uuid.UUID) (Meta, error) {
	img, err := Normalize(bytes.NewReader(data))
	if err != nil {
		return Meta{}, rejected(err)
	}
	return s.store(ctx, titleID, medium, "upload", img, by)
}

// FromURL fetches a public image and stores it; source is "url", or "search" when it came from a search result.
func (s *Service) FromURL(ctx context.Context, titleID uuid.UUID, medium, url, source string, by uuid.UUID) (Meta, error) {
	img, err := s.fetcher.Get(ctx, url)
	if err != nil {
		return Meta{}, rejected(err)
	}
	return s.store(ctx, titleID, medium, source, img, by)
}

// Regenerate replaces the slot with a cover extracted again from the files; with none inside it records that, so the
// placeholder shows and extraction is not retried on every request.
func (s *Service) Regenerate(ctx context.Context, titleID uuid.UUID, medium string, by uuid.UUID) (Meta, error) {
	img, err := s.extract(ctx, titleID, medium)
	if errors.Is(err, ErrNoCover) {
		return s.store(ctx, titleID, medium, "none", nil, by)
	}
	if err != nil {
		return Meta{}, apperr.ErrUnavailable
	}
	return s.store(ctx, titleID, medium, "extracted", img, by)
}

// Source reports where the current cover came from without extracting anything.
func (s *Service) Source(ctx context.Context, titleID uuid.UUID, medium string) (string, uuid.UUID) {
	row, err := s.q.GetTitleCover(ctx, sqlcgen.GetTitleCoverParams{TitleID: titleID, Medium: medium})
	if err != nil {
		return "none", uuid.Nil
	}
	return row.Source, row.Version
}

func (s *Service) SearchEnabled(ctx context.Context) bool {
	on, err := s.q.GetCoverSettings(ctx)
	return err == nil && on
}

func (s *Service) SetSearchEnabled(ctx context.Context, on bool) (bool, error) {
	v, err := s.q.SetCoverSearchEnabled(ctx, on)
	if err != nil {
		return false, apperr.ErrUnavailable
	}
	return v, nil
}

// Search queries the cover sites; the caller has checked that search is enabled.
func (s *Service) Search(ctx context.Context, title, author, medium string) ([]Result, error) {
	out, err := s.searcher.Search(ctx, title, author, medium)
	if err != nil {
		return nil, apperr.ErrUnavailable
	}
	return out, nil
}

// Searcher returns the search client, so tests can point it at a local server.
func (s *Service) Searcher() *Searcher { return s.searcher }

// Preview fetches a candidate cover for display only; nothing is stored. The browser never contacts the cover sites.
func (s *Service) Preview(ctx context.Context, url string) ([]byte, error) {
	img, err := s.fetcher.Get(ctx, url)
	if err != nil {
		return nil, rejected(err)
	}
	return img, nil
}
