package catalog

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// TitleListParams: Q is a case-insensitive literal substring over title,
// authors and series (never SQL or a regular expression).
type TitleListParams struct {
	Q          *string
	LibraryID  *uuid.UUID
	MediaKind  *string // "ebook" or "audio"
	Page, Size int
}

func titleWire(id uuid.UUID, title string, authors []string, series *string, languages []string, editions, recordings int64) wire.T005Title {
	auth := make([]wire.Str512, 0, len(authors))
	for _, a := range authors {
		auth = append(auth, wire.Str512(a))
	}
	langs := make([]wire.Str128, 0, len(languages))
	for _, l := range languages {
		langs = append(langs, wire.Str128(l))
	}
	ser := []wire.Str512{}
	if series != nil && *series != "" {
		ser = append(ser, wire.Str512(*series))
	}
	// lastActivityAt becomes non-null when per-user edition state exists.
	return wire.T005Title{ID: id.String(), Title: title, Authors: auth, Series: ser, Languages: langs,
		EditionCount: editions, RecordingCount: recordings}
}

// Titles lists titles that hold at least one edition or recording in a library
// the caller can read. Counts include only granted libraries.
func (s *Service) Titles(ctx context.Context, userID uuid.UUID, p TitleListParams) (wire.T005Titles, error) {
	rows, err := s.q.ListTitlesPage(ctx, sqlcgen.ListTitlesPageParams{UserID: userID, Q: p.Q, LibraryID: nullUUID(p.LibraryID), MediaKind: p.MediaKind, PageSize: int32(p.Size), PageOffset: int32(p.Page * p.Size)})
	if err != nil {
		return wire.T005Titles{}, unavailable(err)
	}
	total, err := s.q.CountTitlesPage(ctx, sqlcgen.CountTitlesPageParams{UserID: userID, Q: p.Q, LibraryID: nullUUID(p.LibraryID), MediaKind: p.MediaKind})
	if err != nil {
		return wire.T005Titles{}, unavailable(err)
	}
	out := wire.T005Titles{Items: []wire.T005Title{}, Total: total, Page: int64(p.Page), Size: int64(p.Size)}
	for _, r := range rows {
		out.Items = append(out.Items, titleWire(r.ID, r.Title, r.Authors, r.SeriesName, r.Languages, r.EditionCount, r.RecordingCount))
	}
	return out, nil
}

// Title returns one title the caller can see through a granted library.
// A title that exists but is held only in other libraries is denied (403).
func (s *Service) Title(ctx context.Context, userID, id uuid.UUID) (wire.T005TitleDetail, error) {
	exists, err := s.q.TitleExists(ctx, id)
	if err != nil {
		return wire.T005TitleDetail{}, unavailable(err)
	}
	if !exists {
		return wire.T005TitleDetail{}, apperr.ErrNotFound
	}
	rows, err := s.q.GetTitleForUser(ctx, sqlcgen.GetTitleForUserParams{UserID: userID, ID: id})
	if err != nil {
		return wire.T005TitleDetail{}, unavailable(err)
	}
	if len(rows) == 0 || rows[0].EditionCount+rows[0].RecordingCount == 0 {
		return wire.T005TitleDetail{}, apperr.ErrAccessDenied
	}
	r := rows[0]
	return wire.T005TitleDetail{
		Title:          titleWire(r.ID, r.Title, r.Authors, r.SeriesName, r.Languages, r.EditionCount, r.RecordingCount),
		EditionsPath:   fmt.Sprintf("%s/editions?titleId=%s", s.apiBase, id),
		RecordingsPath: fmt.Sprintf("%s/titles/%s/recordings", s.apiBase, id)}, nil
}

// TitleRecordings lists recording links in granted libraries only.
func (s *Service) TitleRecordings(ctx context.Context, userID, titleID uuid.UUID, page, size int) (wire.T005RecordingLinks, error) {
	if _, err := s.Title(ctx, userID, titleID); err != nil {
		return wire.T005RecordingLinks{}, err
	}
	rows, err := s.q.ListTitleRecordingsPage(ctx, sqlcgen.ListTitleRecordingsPageParams{UserID: userID, TitleID: titleID,
		PageSize: int32(size), PageOffset: int32(page * size)})
	if err != nil {
		return wire.T005RecordingLinks{}, unavailable(err)
	}
	total, err := s.q.CountTitleRecordings(ctx, sqlcgen.CountTitleRecordingsParams{UserID: userID, TitleID: titleID})
	if err != nil {
		return wire.T005RecordingLinks{}, unavailable(err)
	}
	out := wire.T005RecordingLinks{Items: []wire.T005RecordingLink{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, r := range rows {
		out.Items = append(out.Items, wire.T005RecordingLink{ID: r.ID.String(), LibraryID: r.LibraryID.String(), Label: r.Title,
			SnapshotPath: fmt.Sprintf("%s/recordings/%s", s.apiBase, r.ID)})
	}
	return out, nil
}
