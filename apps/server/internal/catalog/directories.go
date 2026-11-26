package catalog

import (
	"context"
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Authors lists the authors of the titles the user can see, by name ignoring case (ADR-0100).
func (s *Service) Authors(ctx context.Context, userID uuid.UUID, q string, page, size int) (wire.DirectoryAuthors, error) {
	q = strings.TrimSpace(q)
	rows, err := s.q.ListAuthors(ctx, sqlcgen.ListAuthorsParams{UserID: userID, Q: q, PageSize: int32(size), PageOffset: int32(page * size)})
	if err != nil {
		return wire.DirectoryAuthors{}, unavailable(err)
	}
	total, err := s.q.CountAuthors(ctx, sqlcgen.CountAuthorsParams{UserID: userID, Q: q})
	if err != nil {
		return wire.DirectoryAuthors{}, unavailable(err)
	}
	out := wire.DirectoryAuthors{Items: []wire.DirectoryAuthor{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, r := range rows {
		out.Items = append(out.Items, wire.DirectoryAuthor{Name: r.Name, Titles: r.Titles, CoverTitleID: r.CoverTitleID.String()})
	}
	return out, nil
}

// Series lists the series of the titles the user can see, by name ignoring case (ADR-0100).
func (s *Service) Series(ctx context.Context, userID uuid.UUID, q string, page, size int) (wire.DirectorySeriesPage, error) {
	q = strings.TrimSpace(q)
	rows, err := s.q.ListSeries(ctx, sqlcgen.ListSeriesParams{UserID: userID, Q: q, PageSize: int32(size), PageOffset: int32(page * size)})
	if err != nil {
		return wire.DirectorySeriesPage{}, unavailable(err)
	}
	total, err := s.q.CountSeries(ctx, sqlcgen.CountSeriesParams{UserID: userID, Q: q})
	if err != nil {
		return wire.DirectorySeriesPage{}, unavailable(err)
	}
	out := wire.DirectorySeriesPage{Items: []wire.DirectorySeries{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, r := range rows {
		authors := append([]string{}, r.Authors...)
		sort.Slice(authors, func(i, j int) bool { return strings.ToLower(authors[i]) < strings.ToLower(authors[j]) })
		if len(authors) > 3 {
			authors = authors[:3]
		}
		out.Items = append(out.Items, wire.DirectorySeries{Name: r.Name, Titles: r.Titles, CoverTitleID: r.CoverTitleID.String(), Authors: authors})
	}
	return out, nil
}
