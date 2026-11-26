package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Authors lists the authors of the titles the user can see, by name ignoring case (ADR-0100).
// Order "first" sorts and files them by the name as written; otherwise by last name (ADR-0101). letter, when set,
// keeps only the authors filed under it.
func (s *Service) Authors(ctx context.Context, userID uuid.UUID, q, order, letter string, page, size int) (wire.DirectoryAuthors, error) {
	q = strings.TrimSpace(q)
	rows, err := s.q.ListAuthors(ctx, sqlcgen.ListAuthorsParams{UserID: userID, Q: q, Sort: order, Letter: letter,
		PageSize: int32(size), PageOffset: int32(page * size)})
	if err != nil {
		return wire.DirectoryAuthors{}, unavailable(err)
	}
	letters, err := s.q.CountAuthorLetters(ctx, sqlcgen.CountAuthorLettersParams{UserID: userID, Q: q, Sort: order})
	if err != nil {
		return wire.DirectoryAuthors{}, unavailable(err)
	}
	out := wire.DirectoryAuthors{Items: []wire.DirectoryAuthor{}, Letters: []string{}, Page: int64(page), Size: int64(size)}
	for _, l := range letters {
		if l.Letter != "" {
			out.Letters = append(out.Letters, l.Letter)
		}
		if letter == "" || letter == l.Letter {
			out.Total += l.Authors
		}
	}
	for _, r := range rows {
		item := wire.DirectoryAuthor{Name: r.Name, Titles: r.Titles, CoverTitleID: r.CoverTitleID.String(), SeriesCount: r.SeriesCount,
			LastName: r.LastName}
		if r.PhotoVersion.Valid {
			v := r.PhotoVersion.UUID.String()
			item.PhotoVersion = &v
		}
		out.Items = append(out.Items, item)
	}
	return out, nil
}

// Series lists the series of the titles the user can see, by name ignoring case (ADR-0100). Sort "titles" puts the
// series with the most visible titles first.
func (s *Service) Series(ctx context.Context, userID uuid.UUID, q, order string, page, size int) (wire.DirectorySeriesPage, error) {
	q = strings.TrimSpace(q)
	rows, err := s.q.ListSeries(ctx, sqlcgen.ListSeriesParams{UserID: userID, Q: q, Sort: order, PageSize: int32(size), PageOffset: int32(page * size)})
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
		covers := []wire.DirectoryCover{}
		if err := json.Unmarshal(r.Covers, &covers); err != nil {
			return wire.DirectorySeriesPage{}, unavailable(err)
		}
		out.Items = append(out.Items, wire.DirectorySeries{Name: r.Name, Titles: r.Titles, CoverTitleID: r.CoverTitleID.String(), Authors: authors,
			Covers: covers, Finished: r.Finished})
	}
	return out, nil
}

// continueSQL picks what to continue among an author's or a series' visible, unfinished titles (ADR-0104): the one in
// progress that was used most recently, otherwise the first unread one in the order the page lists them.
const continueSQL = `WITH mine AS (
  SELECT b.* FROM title_rows($1) b
  WHERE b.edition_count + b.recording_count > 0 AND b.status <> 'finished'
    AND CASE WHEN $2::text = 'author' THEN EXISTS (SELECT 1 FROM unnest(b.authors) AS a(name) WHERE lower(a.name) = lower($3::text))
             ELSE lower(b.series_name) = lower($3::text) END
)
SELECT m.id, m.title, m.status, m.edition_count, ebook.at, audio.at
FROM mine m
LEFT JOIN LATERAL (SELECT max(s.captured_at) AS at FROM edition_position_state s JOIN editions e ON e.id = s.edition_id
  JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = $1 WHERE s.user_id = $1 AND e.title_id = m.id) ebook ON true
LEFT JOIN LATERAL (SELECT max(s.captured_at) AS at FROM position_state s JOIN active_recordings r ON r.id = s.recording_id
  JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = $1 WHERE s.user_id = $1 AND r.title_id = m.id) audio ON true
ORDER BY (m.status = 'reading') DESC, GREATEST(ebook.at, audio.at) DESC NULLS LAST,
         (m.series_name IS NULL OR btrim(m.series_name) = ''), lower(m.series_name), m.series_index NULLS LAST, lower(m.title), m.id
LIMIT 1`

// ContinueReading is the title to continue for an author or a series, by name ignoring case.
func (s *Service) ContinueReading(ctx context.Context, userID uuid.UUID, by, name string) (wire.ContinueReading, error) {
	var (
		id               uuid.UUID
		title, status    string
		editions         int64
		ebookAt, audioAt *time.Time
	)
	err := s.pool.QueryRow(ctx, continueSQL, userID, by, name).Scan(&id, &title, &status, &editions, &ebookAt, &audioAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return wire.ContinueReading{}, nil
	}
	if err != nil {
		return wire.ContinueReading{}, unavailable(err)
	}
	medium := "ebook"
	if editions == 0 || (audioAt != nil && (ebookAt == nil || audioAt.After(*ebookAt))) {
		medium = "audio"
	}
	state := "unread"
	if status == "reading" {
		state = "reading"
	}
	idText := id.String()
	return wire.ContinueReading{TitleID: &idText, Title: &title, Medium: &medium, State: &state}, nil
}
