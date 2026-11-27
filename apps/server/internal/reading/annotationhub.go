package reading

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// The annotations hub (ADR-0099) lists, searches and exports the caller's own live annotations across every edition
// they can still see. Annotations on libraries whose grant was removed are left out of all three, not deleted.

// HubFilter narrows the hub. Query is a case-insensitive substring of the note, quote, book title or an author; an
// empty field does not filter.
type HubFilter struct {
	Query   string
	Kind    string
	TitleID uuid.UUID
}

const exportPage = 1000

// likePattern makes a search an ILIKE substring pattern, with the wildcards and the escape character taken literally.
func likePattern(q string) string {
	q = strings.TrimSpace(q)
	if q == "" {
		return ""
	}
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(q) + "%"
}

func (f HubFilter) params(userID uuid.UUID, page, size int) sqlcgen.ListHubAnnotationsParams {
	p := sqlcgen.ListHubAnnotationsParams{UserID: userID, Kind: f.Kind, Pattern: likePattern(f.Query), PageSize: int32(size), PageOffset: int32(page * size)}
	if f.TitleID != uuid.Nil {
		p.TitleID = uuid.NullUUID{UUID: f.TitleID, Valid: true}
	}
	return p
}

func hubItem(r sqlcgen.ListHubAnnotationsRow) (wire.AnnotationHubItem, error) {
	a, err := annotationWire(sqlcgen.Annotation{ID: r.ID, EditionID: r.EditionID, Revision: r.Revision, Kind: r.Kind, FileID: r.FileID,
		ContentVersion: r.ContentVersion, Locator: r.Locator, Selection: r.Selection, Text: r.Text, Quote: r.Quote, Color: r.Color,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt})
	authors := r.Authors
	if authors == nil {
		authors = []string{}
	}
	return wire.AnnotationHubItem{Annotation: a, CreatedAt: rfc(r.CreatedAt), TitleID: r.TitleID.String(), Title: r.TitleName,
		Authors: authors, EditionLabel: r.EditionLabel, Format: r.Format}, err
}

// Hub returns one page of the caller's live annotations, newest change first.
func (s *Service) Hub(ctx context.Context, userID uuid.UUID, f HubFilter, page, size int) (wire.AnnotationHub, error) {
	p := f.params(userID, page, size)
	rows, err := s.q.ListHubAnnotations(ctx, p)
	if err != nil {
		return wire.AnnotationHub{}, dbErr(err)
	}
	total, err := s.q.CountHubAnnotations(ctx, sqlcgen.CountHubAnnotationsParams{UserID: p.UserID, Kind: p.Kind, TitleID: p.TitleID, Pattern: p.Pattern})
	if err != nil {
		return wire.AnnotationHub{}, dbErr(err)
	}
	out := wire.AnnotationHub{Items: []wire.AnnotationHubItem{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, r := range rows {
		it, err := hubItem(r)
		if err != nil {
			return out, dbErr(err)
		}
		out.Items = append(out.Items, it)
	}
	return out, nil
}

// HubTitles lists the books the caller has live annotations on, by title.
func (s *Service) HubTitles(ctx context.Context, userID uuid.UUID) (wire.AnnotationHubTitles, error) {
	rows, err := s.q.ListHubAnnotationTitles(ctx, userID)
	if err != nil {
		return wire.AnnotationHubTitles{}, dbErr(err)
	}
	out := wire.AnnotationHubTitles{Items: []wire.AnnotationHubTitle{}}
	for _, r := range rows {
		authors := r.Authors
		if authors == nil {
			authors = []string{}
		}
		out.Items = append(out.Items, wire.AnnotationHubTitle{TitleID: r.TitleID.String(), Title: r.TitleName, Authors: authors, Annotations: r.Annotations})
	}
	return out, nil
}

// HubExport is a finished export file.
type HubExport struct {
	Body        []byte
	ContentType string
	Filename    string
}

// ExportHub renders every annotation matching f as Markdown, CSV or JSON (ADR-0099).
func (s *Service) ExportHub(ctx context.Context, userID uuid.UUID, f HubFilter, format string) (HubExport, error) {
	var rows []sqlcgen.ListHubAnnotationsRow
	for page := 0; ; page++ {
		batch, err := s.q.ListHubAnnotations(ctx, f.params(userID, page, exportPage))
		if err != nil {
			return HubExport{}, dbErr(err)
		}
		rows = append(rows, batch...)
		if len(batch) < exportPage {
			break
		}
	}
	now := s.now()
	name := "litara-annotations-" + now.Format("2006-01-02")
	switch format {
	case "markdown":
		return HubExport{Body: exportMarkdown(rows, now.Format("2006-01-02")), ContentType: "text/markdown; charset=utf-8", Filename: name + ".md"}, nil
	case "csv":
		b, err := exportCSV(rows)
		return HubExport{Body: b, ContentType: "text/csv; charset=utf-8", Filename: name + ".csv"}, err
	case "json":
		b, err := exportJSON(rows, rfc(now))
		return HubExport{Body: b, ContentType: "application/json", Filename: name + ".json"}, err
	}
	return HubExport{}, apperr.Validation("format must be markdown, csv or json.")
}

var kindLabel = map[string]string{"highlight": "Highlight", "note": "Note", "bookmark": "Bookmark"}

func editionName(r sqlcgen.ListHubAnnotationsRow) string {
	if r.EditionLabel != "" {
		return r.EditionLabel
	}
	return strings.ToUpper(r.Format)
}

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

// exportMarkdown groups entries by book (by title), oldest first within a book, quote as a block quote, note beneath.
func exportMarkdown(rows []sqlcgen.ListHubAnnotationsRow, date string) []byte {
	type book struct {
		title   string
		authors []string
		rows    []sqlcgen.ListHubAnnotationsRow
	}
	books := map[uuid.UUID]*book{}
	var order []*book
	for _, r := range rows {
		b := books[r.TitleID]
		if b == nil {
			b = &book{title: r.TitleName, authors: r.Authors}
			books[r.TitleID] = b
			order = append(order, b)
		}
		b.rows = append(b.rows, r)
	}
	sort.SliceStable(order, func(i, j int) bool { return strings.ToLower(order[i].title) < strings.ToLower(order[j].title) })
	var w bytes.Buffer
	plural := "entries"
	if len(rows) == 1 {
		plural = "entry"
	}
	fmt.Fprintf(&w, "# Annotations\n\nExported from Litara on %s: %d %s.\n", date, len(rows), plural)
	for _, b := range order {
		fmt.Fprintf(&w, "\n## %s\n", oneLine(b.title))
		if len(b.authors) > 0 {
			fmt.Fprintf(&w, "\n*%s*\n", oneLine(strings.Join(b.authors, ", ")))
		}
		sort.SliceStable(b.rows, func(i, j int) bool { return b.rows[i].CreatedAt.Before(b.rows[j].CreatedAt) })
		for _, r := range b.rows {
			w.WriteString("\n")
			if q := strings.TrimSpace(r.Quote); q != "" {
				for _, line := range strings.Split(strings.ReplaceAll(q, "\r\n", "\n"), "\n") {
					w.WriteString(strings.TrimRight("> "+line, " ") + "\n")
				}
				w.WriteString("\n")
			}
			if t := strings.TrimSpace(r.Text); t != "" {
				w.WriteString(strings.ReplaceAll(t, "\r\n", "\n") + "\n\n")
			}
			fmt.Fprintf(&w, "— %s · %s · %s\n", kindLabel[r.Kind], oneLine(editionName(r)), r.CreatedAt.UTC().Format("2006-01-02"))
		}
	}
	return w.Bytes()
}

// csvCell keeps a spreadsheet from running a cell as a formula.
func csvCell(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}

func exportCSV(rows []sqlcgen.ListHubAnnotationsRow) ([]byte, error) {
	var b bytes.Buffer
	w := csv.NewWriter(&b)
	_ = w.Write([]string{"title", "authors", "kind", "quote", "note", "edition", "created_at", "updated_at", "title_id", "edition_id", "annotation_id"})
	for _, r := range rows {
		rec := []string{r.TitleName, strings.Join(r.Authors, "; "), r.Kind, r.Quote, r.Text, editionName(r), rfc(r.CreatedAt), rfc(r.UpdatedAt),
			r.TitleID.String(), r.EditionID.String(), r.ID.String()}
		for i := range rec {
			rec[i] = csvCell(rec[i])
		}
		if err := w.Write(rec); err != nil {
			return nil, err
		}
	}
	w.Flush()
	return b.Bytes(), w.Error()
}

type exportEntry struct {
	ID        string   `json:"id"`
	TitleID   string   `json:"titleId"`
	EditionID string   `json:"editionId"`
	Title     string   `json:"title"`
	Authors   []string `json:"authors"`
	Kind      string   `json:"kind"`
	Quote     string   `json:"quote"`
	Note      string   `json:"note"`
	Edition   string   `json:"edition"`
	Format    string   `json:"format"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
}

func exportJSON(rows []sqlcgen.ListHubAnnotationsRow, exportedAt string) ([]byte, error) {
	items := make([]exportEntry, 0, len(rows))
	for _, r := range rows {
		authors := r.Authors
		if authors == nil {
			authors = []string{}
		}
		items = append(items, exportEntry{ID: r.ID.String(), TitleID: r.TitleID.String(), EditionID: r.EditionID.String(), Title: r.TitleName,
			Authors: authors, Kind: r.Kind, Quote: r.Quote, Note: r.Text, Edition: editionName(r), Format: r.Format,
			CreatedAt: rfc(r.CreatedAt), UpdatedAt: rfc(r.UpdatedAt)})
	}
	return json.MarshalIndent(struct {
		ExportedAt string        `json:"exportedAt"`
		Items      []exportEntry `json:"items"`
	}{exportedAt, items}, "", "  ")
}
