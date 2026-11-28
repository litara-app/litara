package catalog

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// TitleListParams: Q is a case-insensitive literal substring over title,
// authors and series (never SQL or a regular expression). The other text filters work the same way; Language and
// Format are exact. Sort is one of the keys in SortKeys.
type TitleListParams struct {
	Q          *string
	LibraryID  *uuid.UUID
	MediaKind  *string // "ebook" or "audio"
	Author     *string
	Series     *string
	Publisher  *string
	Language   *string
	Format     *string // an ebook format such as "epub", or "audio"
	Status     *string // unread, reading or finished (the caller's own)
	Rated      *string // rated or unrated (the caller's own)
	Sort       string
	Descending bool
	Filter     *wire.TitleFilter // an optional filter tree (ADR-0085), ANDed with the other filters
	Page, Size int
}

// SortKeys are the columns the library list can be ordered by.
var SortKeys = []string{"title", "author", "series", "series_index", "publisher", "published", "language", "status", "pages", "rating", "editions", "added"}

func titleWire(id uuid.UUID, title string, authors []string, series *string, languages []string, editions, recordings, copies int64) wire.Title {
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
	return wire.Title{ID: id.String(), Title: title, Authors: auth, Series: ser, Languages: langs,
		EditionCount: editions, RecordingCount: recordings, PhysicalCopyCount: copies}
}

func optStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Titles lists titles that hold at least one edition, recording or paper copy (ADR-0116) in a library
// the caller can read, with the columns the library table shows, filtered and ordered as asked. Counts, formats
// and libraries include only granted libraries. The single-value filters and the filter tree (ADR-0085) share one
// compiler, so they cannot disagree.
func (s *Service) Titles(ctx context.Context, userID uuid.UUID, p TitleListParams) (wire.TitleRows, error) {
	sort := p.Sort
	if sort == "" {
		sort = "title"
	}
	tree := p.tree()
	rows, total, err := s.queryTitles(ctx, userID, p, sort, tree, p.Page*p.Size, p.Size)
	if err != nil {
		return wire.TitleRows{}, err
	}
	out := wire.TitleRows{Items: []wire.TitleRow{}, Page: int64(p.Page), Size: int64(p.Size), Total: total}
	if len(rows) == 0 && p.Page > 0 {
		// A page past the end has no rows to carry the total; ask for the first row of the same set.
		if first, t, err := s.queryTitles(ctx, userID, p, sort, tree, 0, 1); err == nil && len(first) > 0 {
			out.Total = t
		}
	}
	for _, r := range rows {
		row := wire.TitleRow{
			Title:       titleWire(r.id, r.title, r.authors, r.seriesName, r.languages, r.editionCount, r.recordingCount, r.copyCount),
			LibraryIDs:  make([]string, 0, len(r.libraryIDs)),
			Formats:     append([]string{}, r.formats...),
			AddedAt:     r.addedAt.UTC().Format(time.RFC3339),
			SeriesIndex: r.seriesIndex,
			Publisher:   optStr(r.publisher),
			Published:   optStr(r.published),
			Status:      r.status,
		}
		for _, l := range r.libraryIDs {
			row.LibraryIDs = append(row.LibraryIDs, l.String())
		}
		if r.pageCount > 0 {
			n := int64(r.pageCount)
			row.PageCount = &n
		}
		if r.ratingHalves > 0 {
			n := int64(r.ratingHalves)
			row.RatingHalves = &n
		}
		out.Items = append(out.Items, row)
	}
	return out, nil
}

// tree combines the single-value filters and the optional filter tree into one AND group.
func (p TitleListParams) tree() *wire.TitleFilter {
	var rules []wire.TitleFilter
	add := func(field, op string, v *string) {
		if v != nil {
			rules = append(rules, wire.TitleFilter{Type: "rule", Field: field, Operator: op, Value: *v})
		}
	}
	add("author", "contains", p.Author)
	add("series", "contains", p.Series)
	add("publisher", "contains", p.Publisher)
	add("language", "is", p.Language)
	add("format", "is", p.Format)
	add("status", "is", p.Status)
	if p.Rated != nil {
		op := "is_empty"
		if *p.Rated == "rated" {
			op = "not_empty"
		}
		rules = append(rules, wire.TitleFilter{Type: "rule", Field: "rating", Operator: op})
	}
	if p.Filter != nil {
		rules = append(rules, *p.Filter)
	}
	if len(rules) == 0 {
		return nil
	}
	return &wire.TitleFilter{Type: "group", Join: "AND", Rules: rules}
}

type titleRow struct {
	id                           uuid.UUID
	title                        string
	authors                      []string
	seriesName                   *string
	seriesIndex                  *float64
	editionCount, recordingCount int64
	languages, formats           []string
	libraryIDs                   []uuid.UUID
	addedAt                      time.Time
	publisher, published         string
	pageCount                    int32
	ratingHalves                 int16
	status                       string
	copyCount                    int64
}

// queryTitles runs the one list query. Every value is a bound parameter; only the compiled tree's shape, built from the
// fixed field catalogue, becomes SQL text.
func (s *Service) queryTitles(ctx context.Context, userID uuid.UUID, p TitleListParams, sort string, tree *wire.TitleFilter, offset, limit int) ([]titleRow, int64, error) {
	c := &filterCompiler{}
	c.arg(userID) // $1
	cond, err := c.compile(tree, 1)
	if err != nil {
		return nil, 0, err
	}
	where := []string{"b.edition_count + b.recording_count + b.copy_count > 0", cond}
	if p.Q != nil {
		where = append(where, "position(lower("+c.arg(*p.Q)+"::text) in lower(b.title || chr(10) || array_to_string(b.authors, chr(10)) || chr(10) || COALESCE(b.series_name, ''))) > 0")
	}
	if p.LibraryID != nil {
		where = append(where, c.arg(*p.LibraryID)+"::uuid = ANY (b.library_ids)")
	}
	if p.MediaKind != nil {
		switch *p.MediaKind {
		case "ebook":
			where = append(where, "b.edition_count > 0")
		case "audio":
			where = append(where, "b.recording_count > 0")
		}
	}
	dir := "ASC"
	if p.Descending {
		dir = "DESC"
	}
	sql := `WITH base AS (SELECT * FROM title_rows($1)), filtered AS (
  SELECT b.* FROM base b WHERE ` + strings.Join(where, " AND ") + `
), keyed AS (
  SELECT f.*,
    CASE ` + c.arg(sort) + `::text
      WHEN 'title' THEN lower(f.title) WHEN 'author' THEN lower(COALESCE(f.authors[1], ''))
      WHEN 'series' THEN lower(f.series_name) WHEN 'publisher' THEN lower(f.publisher) WHEN 'published' THEN f.published
      WHEN 'language' THEN f.languages[1] WHEN 'status' THEN f.status END AS sort_text,
    CASE $` + fmt.Sprint(len(c.args)) + `::text
      WHEN 'pages' THEN f.page_count::double precision WHEN 'rating' THEN f.rating_halves::double precision
      WHEN 'series_index' THEN f.series_index WHEN 'editions' THEN f.edition_count::double precision END AS sort_num,
    CASE $` + fmt.Sprint(len(c.args)) + `::text WHEN 'added' THEN f.added_at END AS sort_ts
  FROM filtered f
)
SELECT k.id, k.title, k.authors, k.series_name, k.series_index, k.edition_count, k.recording_count, k.languages, k.formats, k.library_ids,
       COALESCE(k.added_at, 'epoch'::timestamptz)::timestamptz, COALESCE(k.publisher, '')::text, COALESCE(k.published, '')::text,
       COALESCE(k.page_count, 0)::int, COALESCE(k.rating_halves, 0)::smallint, k.status, k.copy_count, count(*) OVER ()::bigint
FROM keyed k
ORDER BY k.sort_text ` + dir + ` NULLS LAST, k.sort_num ` + dir + ` NULLS LAST, k.sort_ts ` + dir + ` NULLS LAST, lower(k.title), k.id
LIMIT ` + c.arg(limit) + ` OFFSET ` + c.arg(offset)
	rs, err := s.pool.Query(ctx, sql, c.args...)
	if err != nil {
		return nil, 0, unavailable(err)
	}
	defer rs.Close()
	var out []titleRow
	var total int64
	for rs.Next() {
		var r titleRow
		if err := rs.Scan(&r.id, &r.title, &r.authors, &r.seriesName, &r.seriesIndex, &r.editionCount, &r.recordingCount, &r.languages, &r.formats,
			&r.libraryIDs, &r.addedAt, &r.publisher, &r.published, &r.pageCount, &r.ratingHalves, &r.status, &r.copyCount, &total); err != nil {
			return nil, 0, unavailable(err)
		}
		out = append(out, r)
	}
	if err := rs.Err(); err != nil {
		return nil, 0, unavailable(err)
	}
	return out, total, nil
}

// Title returns one title the caller can see through a granted library.
// A title that exists but is held only in other libraries is denied (403).
func (s *Service) Title(ctx context.Context, userID, id uuid.UUID) (wire.TitleDetail, error) {
	exists, err := s.q.TitleExists(ctx, id)
	if err != nil {
		return wire.TitleDetail{}, unavailable(err)
	}
	if !exists {
		return wire.TitleDetail{}, apperr.ErrNotFound
	}
	rows, err := s.q.GetTitleForUser(ctx, sqlcgen.GetTitleForUserParams{UserID: userID, ID: id})
	if err != nil {
		return wire.TitleDetail{}, unavailable(err)
	}
	if len(rows) == 0 || rows[0].EditionCount+rows[0].RecordingCount+rows[0].CopyCount == 0 {
		return wire.TitleDetail{}, apperr.ErrAccessDenied
	}
	r := rows[0]
	return wire.TitleDetail{
		Publisher:      optStr(r.Publisher),
		Published:      optStr(r.Published),
		Description:    optStr(r.Description),
		Title:          titleWire(r.ID, r.Title, r.Authors, r.SeriesName, r.Languages, r.EditionCount, r.RecordingCount, r.CopyCount),
		EditionsPath:   fmt.Sprintf("%s/editions?titleId=%s", s.apiBase, id),
		RecordingsPath: fmt.Sprintf("%s/titles/%s/recordings", s.apiBase, id)}, nil
}

// TitleRecordings lists recording links in granted libraries only.
func (s *Service) TitleRecordings(ctx context.Context, userID, titleID uuid.UUID, page, size int) (wire.RecordingLinks, error) {
	if _, err := s.Title(ctx, userID, titleID); err != nil {
		return wire.RecordingLinks{}, err
	}
	rows, err := s.q.ListTitleRecordingsPage(ctx, sqlcgen.ListTitleRecordingsPageParams{UserID: userID, TitleID: titleID,
		PageSize: int32(size), PageOffset: int32(page * size)})
	if err != nil {
		return wire.RecordingLinks{}, unavailable(err)
	}
	total, err := s.q.CountTitleRecordings(ctx, sqlcgen.CountTitleRecordingsParams{UserID: userID, TitleID: titleID})
	if err != nil {
		return wire.RecordingLinks{}, unavailable(err)
	}
	out := wire.RecordingLinks{Items: []wire.RecordingLink{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, r := range rows {
		out.Items = append(out.Items, wire.RecordingLink{ID: r.ID.String(), LibraryID: r.LibraryID.String(), Label: r.Title,
			SnapshotPath: fmt.Sprintf("%s/recordings/%s", s.apiBase, r.ID)})
	}
	return out, nil
}

// TitlesByIDs returns the titles the caller can see among ids, preserving the
// order of ids. Titles the caller cannot see are silently omitted.
func (s *Service) TitlesByIDs(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) ([]wire.Title, error) {
	if len(ids) == 0 {
		return []wire.Title{}, nil
	}
	rows, err := s.q.ListTitlesByIDs(ctx, sqlcgen.ListTitlesByIDsParams{UserID: userID, Ids: ids})
	if err != nil {
		return nil, unavailable(err)
	}
	byID := make(map[uuid.UUID]wire.Title, len(rows))
	for _, r := range rows {
		if r.EditionCount+r.RecordingCount+r.CopyCount > 0 {
			byID[r.ID] = titleWire(r.ID, r.Title, r.Authors, r.SeriesName, r.Languages, r.EditionCount, r.RecordingCount, r.CopyCount)
		}
	}
	out := make([]wire.Title, 0, len(ids))
	for _, id := range ids {
		if t, ok := byID[id]; ok {
			out = append(out, t)
		}
	}
	return out, nil
}
