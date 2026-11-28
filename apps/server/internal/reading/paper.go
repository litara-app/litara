package reading

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/receipts"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Physical copies and paper reading (ADR-0116). Who may manage a library's copies is the caller's check (an
// administrator with access to it); everything here about reading is the caller's own.

func languageTag(s string) bool {
	for _, r := range s {
		if !(r == '-' || r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z') {
			return false
		}
	}
	return true
}

// copyColumns is a copy's details as stored.
type copyColumns struct {
	binding, isbn, language, location, note *string
	pageCount                               *int32
	acquiredOn                              pgtype.Date
}

// cleanText trims an optional text; blank means not given.
func cleanText(field string, v *string, limit int) (*string, error) {
	if v == nil {
		return nil, nil
	}
	s := strings.TrimSpace(*v)
	if s == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(s) > limit {
		return nil, apperr.Validation(field + " must be at most " + strconv.Itoa(limit) + " characters.")
	}
	return &s, nil
}

// paperISBN normalizes an ISBN, refusing anything that is not ten or thirteen characters of one.
func paperISBN(v string) (string, error) {
	isbn, _ := metadata.SplitIdentifier(v)
	if isbn == "" {
		return "", apperr.Validation("isbn must be an ISBN-10 or ISBN-13.")
	}
	return isbn, nil
}

func checkCopy(d wire.CopyDetails) (copyColumns, error) {
	var out copyColumns
	var err error
	if d.Binding != nil && *d.Binding != "" {
		switch *d.Binding {
		case "hardcover", "paperback", "other":
			out.binding = d.Binding
		default:
			return out, apperr.Validation("binding must be hardcover, paperback or other.")
		}
	}
	if d.ISBN != nil && strings.TrimSpace(*d.ISBN) != "" {
		isbn, err := paperISBN(*d.ISBN)
		if err != nil {
			return out, err
		}
		out.isbn = &isbn
	}
	if out.language, err = cleanText("language", d.Language, 35); err != nil {
		return out, err
	}
	if out.language != nil && !languageTag(*out.language) {
		return out, apperr.Validation("language must be a language code such as en or pt-BR.")
	}
	if out.location, err = cleanText("location", d.Location, 200); err != nil {
		return out, err
	}
	if out.note, err = cleanText("note", d.Note, 2000); err != nil {
		return out, err
	}
	if d.PageCount != nil {
		if *d.PageCount < 1 || *d.PageCount > 100000 {
			return out, apperr.Validation("pageCount must be from 1 to 100000.")
		}
		n := int32(*d.PageCount)
		out.pageCount = &n
	}
	if d.AcquiredOn != nil && *d.AcquiredOn != "" {
		t, err := time.Parse("2006-01-02", *d.AcquiredOn)
		if err != nil {
			return out, apperr.Validation("acquiredOn must be a date (YYYY-MM-DD).")
		}
		out.acquiredOn = pgtype.Date{Time: t, Valid: true}
	}
	return out, nil
}

func copyWire(c sqlcgen.PhysicalCopy) wire.PhysicalCopy {
	out := wire.PhysicalCopy{ID: c.ID.String(), TitleID: c.TitleID.String(), LibraryID: c.LibraryID.String(),
		Revision: strconv.FormatInt(c.Revision, 10), AddedAt: rfc(c.CreatedAt),
		CopyDetails: wire.CopyDetails{Binding: c.Binding, ISBN: c.Isbn, Language: c.Language, Location: c.Location, Note: c.Note}}
	if c.PageCount != nil {
		n := int64(*c.PageCount)
		out.PageCount = &n
	}
	if c.AcquiredOn.Valid {
		d := c.AcquiredOn.Time.Format("2006-01-02")
		out.AcquiredOn = &d
	}
	return out
}

// LiveCopy returns a copy that has not been removed, without any permission check.
func (s *Service) LiveCopy(ctx context.Context, id uuid.UUID) (sqlcgen.PhysicalCopy, error) {
	c, err := s.CopyRow(ctx, id)
	if err != nil {
		return c, err
	}
	if c.RemovedAt != nil {
		return c, apperr.ErrNotFound
	}
	return c, nil
}

// CopyRow returns a copy, removed or not. A removal replayed after it succeeded still has to find its library.
func (s *Service) CopyRow(ctx context.Context, id uuid.UUID) (sqlcgen.PhysicalCopy, error) {
	c, err := s.q.GetPhysicalCopy(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, apperr.ErrNotFound
	}
	if err != nil {
		return c, dbErr(err)
	}
	return c, nil
}

// ReadableCopy returns a live copy in a library the caller is granted.
func (s *Service) ReadableCopy(ctx context.Context, userID, id uuid.UUID) (sqlcgen.PhysicalCopy, error) {
	c, err := s.LiveCopy(ctx, id)
	if err != nil {
		return c, err
	}
	ok, err := s.q.UserHasLibraryGrant(ctx, sqlcgen.UserHasLibraryGrantParams{UserID: userID, LibraryID: c.LibraryID})
	if err != nil {
		return c, dbErr(err)
	}
	if !ok {
		return c, apperr.ErrAccessDenied
	}
	return c, nil
}

// TitleCopies lists a title's live copies in the caller's libraries.
func (s *Service) TitleCopies(ctx context.Context, userID, titleID uuid.UUID, page, size int) (wire.PhysicalCopies, error) {
	if _, err := s.cat.Title(ctx, userID, titleID); err != nil {
		return wire.PhysicalCopies{}, err
	}
	rows, err := s.q.ListTitleCopies(ctx, sqlcgen.ListTitleCopiesParams{UserID: userID, TitleID: titleID})
	if err != nil {
		return wire.PhysicalCopies{}, dbErr(err)
	}
	out := wire.PhysicalCopies{Items: []wire.PhysicalCopy{}, Total: int64(len(rows)), Page: int64(page), Size: int64(size)}
	for i := page * size; i >= 0 && i < len(rows) && i < (page+1)*size; i++ {
		out.Items = append(out.Items, copyWire(rows[i]))
	}
	return out, nil
}

func (s *Service) CopyLocations(ctx context.Context, userID uuid.UUID, libraryID *uuid.UUID) (wire.CopyLocations, error) {
	var lib uuid.NullUUID
	if libraryID != nil {
		lib = uuid.NullUUID{UUID: *libraryID, Valid: true}
	}
	rows, err := s.q.ListCopyLocations(ctx, sqlcgen.ListCopyLocationsParams{UserID: userID, LibraryID: lib})
	if err != nil {
		return wire.CopyLocations{}, dbErr(err)
	}
	return wire.CopyLocations{Items: append([]string{}, rows...)}, nil
}

func strs(in []wire.Str512) []string {
	out := []string{}
	for _, a := range in {
		if v := strings.TrimSpace(string(a)); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// PaperMatches lists books the caller can see that may be the one described: the same name and first author, or the
// same ISBN. They are offered to the person; nothing is joined without their choice.
func (s *Service) PaperMatches(ctx context.Context, userID uuid.UUID, title string, authors []string, isbn string) ([]wire.PaperTitleMatch, error) {
	return paperMatches(ctx, s.q, userID, title, authors, isbn)
}

func paperMatches(ctx context.Context, q *sqlcgen.Queries, userID uuid.UUID, title string, authors []string, isbn string) ([]wire.PaperTitleMatch, error) {
	author := ""
	if len(authors) > 0 {
		author = authors[0]
	}
	rows, err := q.FindVisibleTitlesForPaper(ctx, sqlcgen.FindVisibleTitlesForPaperParams{UserID: userID, Isbn: isbn,
		NameKey: metadata.NormText(title), AuthorKey: metadata.NormText(author)})
	if err != nil {
		return nil, dbErr(err)
	}
	out := []wire.PaperTitleMatch{}
	for _, r := range rows {
		m := wire.PaperTitleMatch{TitleID: r.ID.String(), Title: r.Title, Authors: []wire.Str512{}, Series: r.SeriesName, SameISBN: r.SameIsbn}
		for _, a := range r.Authors {
			m.Authors = append(m.Authors, wire.Str512(a))
		}
		out = append(out, m)
	}
	return out, nil
}

// paperValues are a new paper title's details as protected user values: the person typed or reviewed them.
func paperValues(t wire.NewPaperTitle) (string, []string, map[string]json.RawMessage, error) {
	name := strings.TrimSpace(t.Title)
	if name == "" {
		return "", nil, nil, apperr.Validation("newTitle.title is required.")
	}
	authors := strs(t.Authors)
	values := map[string]json.RawMessage{metadata.FieldTitle: wire.Raw(name)}
	if len(authors) > 0 {
		values[metadata.FieldAuthors] = wire.Raw(authors)
	}
	for field, v := range map[string]*string{metadata.FieldSeriesName: t.Series, metadata.FieldPublisher: t.Publisher,
		metadata.FieldPublished: t.Published, metadata.FieldDescription: t.Description} {
		if v != nil && strings.TrimSpace(*v) != "" {
			values[field] = wire.Raw(strings.TrimSpace(*v))
		}
	}
	if t.SeriesIndex != nil {
		values[metadata.FieldSeriesIndex] = wire.Raw(*t.SeriesIndex)
	}
	for field, raw := range values {
		if err := metadata.CheckValue(field, raw); err != nil {
			return "", nil, nil, err
		}
	}
	return name, authors, values, nil
}

// insertPaperTitle creates a book that has only paper copies, with its details as protected user values.
func insertPaperTitle(ctx context.Context, q *sqlcgen.Queries, t wire.NewPaperTitle) (uuid.UUID, error) {
	name, authors, values, err := paperValues(t)
	if err != nil {
		return uuid.Nil, err
	}
	id := uuid.New()
	key := metadata.TitleKey(name, authors)
	var series *string
	if t.Series != nil && strings.TrimSpace(*t.Series) != "" {
		v := strings.TrimSpace(*t.Series)
		series = &v
	}
	if err := q.InsertPaperTitle(ctx, sqlcgen.InsertPaperTitleParams{ID: id, Title: name, Authors: authors,
		SeriesName: series, SeriesIndex: t.SeriesIndex, GroupKey: &key}); err != nil {
		return uuid.Nil, err
	}
	for field, raw := range values {
		if _, err := q.UpsertMetadataValue(ctx, sqlcgen.UpsertMetadataValueParams{SubjectKind: "title", SubjectID: id,
			Field: field, Source: metadata.SourceUser, Value: raw}); err != nil {
			return uuid.Nil, err
		}
	}
	return id, nil
}

// adminWrite runs one revisioned, idempotent copy change and decodes the copy it returns.
func (s *Service) adminWrite(ctx context.Context, userID, op uuid.UUID, fp []byte, lock func(pgx.Tx, *sqlcgen.Queries) error,
	w func(tx pgx.Tx, q *sqlcgen.Queries) (sqlcgen.PhysicalCopy, *apperr.Error, error)) (wire.PhysicalCopy, error) {
	_, body, err := receipts.New(s.pool).Run(ctx, userID, op, fp, lock,
		func(tx pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
			c, refused, err := w(tx, q)
			if err != nil || refused != nil {
				return 0, nil, refused, err
			}
			return http.StatusOK, wire.Raw(copyWire(c)), nil, nil
		})
	if err != nil {
		return wire.PhysicalCopy{}, dbErr(err)
	}
	var out wire.PhysicalCopy
	return out, json.Unmarshal(body, &out)
}

// AddCopy adds a copy to a title the caller can see, or creates the title with it. The caller has checked that the
// person manages the library.
func (s *Service) AddCopy(ctx context.Context, userID uuid.UUID, in wire.AddPhysicalCopy) (wire.PhysicalCopy, error) {
	op, err := parseUUID("operationId", in.OperationID)
	if err != nil {
		return wire.PhysicalCopy{}, err
	}
	library, err := parseUUID("libraryId", in.LibraryID)
	if err != nil {
		return wire.PhysicalCopy{}, err
	}
	cols, err := checkCopy(in.Copy)
	if err != nil {
		return wire.PhysicalCopy{}, err
	}
	if (in.TitleID == nil) == (in.NewTitle == nil) {
		return wire.PhysicalCopy{}, apperr.Validation("Send exactly one of titleId and newTitle.")
	}
	var existing uuid.UUID
	var name, key string
	var authors []string
	if in.TitleID != nil {
		if existing, err = parseUUID("titleId", *in.TitleID); err != nil {
			return wire.PhysicalCopy{}, err
		}
	} else {
		if name, authors, _, err = paperValues(*in.NewTitle); err != nil {
			return wire.PhysicalCopy{}, err
		}
		key = metadata.TitleKey(name, authors)
	}
	fp := receipts.Fingerprint(http.MethodPost, "/admin/physical-copies", in)
	return s.adminWrite(ctx, userID, op, fp,
		func(tx pgx.Tx, _ *sqlcgen.Queries) error {
			if key == "" {
				return nil
			}
			// Two people adding the same new book at once must not both be told there is no match.
			_, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", "paper-title:"+key)
			return err
		},
		func(_ pgx.Tx, q *sqlcgen.Queries) (sqlcgen.PhysicalCopy, *apperr.Error, error) {
			var none sqlcgen.PhysicalCopy
			title := existing
			if in.TitleID != nil {
				seen, err := q.UserSeesTitle(ctx, sqlcgen.UserSeesTitleParams{UserID: userID, TitleID: existing})
				if err != nil {
					return none, nil, err
				}
				if !seen {
					return none, nil, apperr.Validation("That title is not in your libraries.")
				}
			} else {
				if !in.SeparateFromMatches {
					isbn := ""
					if cols.isbn != nil {
						isbn = *cols.isbn
					}
					matches, err := paperMatches(ctx, q, userID, name, authors, isbn)
					if err != nil {
						return none, nil, err
					}
					if len(matches) > 0 {
						// Not stored as the operation's result: the person answers and sends the same book again.
						return none, nil, apperr.New(http.StatusConflict, "title_match",
							"Your catalogue has a book that may be this one. Add the copy to it, or confirm that this is a separate book.")
					}
				}
				created, err := insertPaperTitle(ctx, q, *in.NewTitle)
				if err != nil {
					return none, nil, err
				}
				title = created
			}
			id := uuid.New()
			if err := q.InsertPhysicalCopy(ctx, sqlcgen.InsertPhysicalCopyParams{ID: id, TitleID: title, LibraryID: library,
				Binding: cols.binding, Isbn: cols.isbn, Language: cols.language, PageCount: cols.pageCount, Location: cols.location,
				Note: cols.note, AcquiredOn: cols.acquiredOn, Now: s.now()}); err != nil {
				return none, nil, err
			}
			c, err := q.GetPhysicalCopy(ctx, id)
			return c, nil, err
		})
}

// lockCopy holds the copy for a change.
func lockCopy(ctx context.Context, id uuid.UUID) func(pgx.Tx, *sqlcgen.Queries) error {
	return func(_ pgx.Tx, q *sqlcgen.Queries) error {
		_, err := q.LockPhysicalCopy(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.ErrNotFound
		}
		return err
	}
}

// currentCopy is the locked copy, if it is live and still at the revision the change was made from.
func currentCopy(ctx context.Context, q *sqlcgen.Queries, id uuid.UUID, base int64) (sqlcgen.PhysicalCopy, *apperr.Error, error) {
	c, err := q.GetPhysicalCopy(ctx, id)
	if err != nil {
		return c, nil, err
	}
	if c.RemovedAt != nil {
		return c, apperr.ErrNotFound, nil
	}
	if c.Revision != base {
		return c, apperr.New(http.StatusConflict, "stale_revision", "The copy changed since that revision; refetch and retry.").
			With("currentRevision", strconv.FormatInt(c.Revision, 10)), nil
	}
	return c, nil, nil
}

// UpdateCopy replaces a copy's title, library and details. The caller has checked that the person manages both the
// copy's library and the one it moves to.
func (s *Service) UpdateCopy(ctx context.Context, userID, copyID uuid.UUID, in wire.UpdatePhysicalCopy) (wire.PhysicalCopy, error) {
	op, err := parseUUID("operationId", in.OperationID)
	if err != nil {
		return wire.PhysicalCopy{}, err
	}
	base, err := parseRev(in.BaseRevision)
	if err != nil {
		return wire.PhysicalCopy{}, err
	}
	title, err := parseUUID("titleId", in.TitleID)
	if err != nil {
		return wire.PhysicalCopy{}, err
	}
	library, err := parseUUID("libraryId", in.LibraryID)
	if err != nil {
		return wire.PhysicalCopy{}, err
	}
	cols, err := checkCopy(in.Copy)
	if err != nil {
		return wire.PhysicalCopy{}, err
	}
	fp := receipts.Fingerprint(http.MethodPut, "/admin/physical-copies/"+copyID.String(), in)
	return s.adminWrite(ctx, userID, op, fp, lockCopy(ctx, copyID),
		func(_ pgx.Tx, q *sqlcgen.Queries) (sqlcgen.PhysicalCopy, *apperr.Error, error) {
			c, refused, err := currentCopy(ctx, q, copyID, base)
			if err != nil || refused != nil {
				return c, refused, err
			}
			if title != c.TitleID {
				seen, err := q.UserSeesTitle(ctx, sqlcgen.UserSeesTitleParams{UserID: userID, TitleID: title})
				if err != nil {
					return c, nil, err
				}
				if !seen {
					return c, nil, apperr.Validation("That title is not in your libraries.")
				}
				if err := q.MovePaperHistory(ctx, sqlcgen.MovePaperHistoryParams{CopyID: copyID, TitleID: title}); err != nil {
					return c, nil, err
				}
			}
			next, err := q.UpdatePhysicalCopy(ctx, sqlcgen.UpdatePhysicalCopyParams{ID: copyID, TitleID: title, LibraryID: library,
				Binding: cols.binding, Isbn: cols.isbn, Language: cols.language, PageCount: cols.pageCount, Location: cols.location,
				Note: cols.note, AcquiredOn: cols.acquiredOn, Now: s.now()})
			return next, nil, err
		})
}

// RemoveCopy hides a copy and keeps its row, so each reader's history stays.
func (s *Service) RemoveCopy(ctx context.Context, userID, copyID uuid.UUID, in wire.RemovePhysicalCopy) (wire.PhysicalCopy, error) {
	op, err := parseUUID("operationId", in.OperationID)
	if err != nil {
		return wire.PhysicalCopy{}, err
	}
	base, err := parseRev(in.BaseRevision)
	if err != nil {
		return wire.PhysicalCopy{}, err
	}
	fp := receipts.Fingerprint(http.MethodPost, "/admin/physical-copies/"+copyID.String()+"/remove", in)
	return s.adminWrite(ctx, userID, op, fp, lockCopy(ctx, copyID),
		func(_ pgx.Tx, q *sqlcgen.Queries) (sqlcgen.PhysicalCopy, *apperr.Error, error) {
			c, refused, err := currentCopy(ctx, q, copyID, base)
			if err != nil || refused != nil {
				return c, refused, err
			}
			next, err := q.RemovePhysicalCopy(ctx, sqlcgen.RemovePhysicalCopyParams{ID: copyID, Now: ptr(s.now())})
			return next, nil, err
		})
}

// ---- reading ------------------------------------------------------------

func paperReadingWire(copyID uuid.UUID, r sqlcgen.PaperReadingState) wire.PaperReading {
	out := wire.PaperReading{CopyID: copyID.String(), Revision: strconv.FormatInt(r.Revision, 10), Status: r.Status, ChangedAt: rfcp(r.ChangedAt)}
	if out.Status == "" {
		out.Status = "not_started"
	}
	if r.Page != nil {
		n := int64(*r.Page)
		out.Page = &n
	}
	return out
}

// PaperReading is the caller's own reading of a copy.
func (s *Service) PaperReading(ctx context.Context, userID, copyID uuid.UUID) (wire.PaperReading, error) {
	if _, err := s.ReadableCopy(ctx, userID, copyID); err != nil {
		return wire.PaperReading{}, err
	}
	r, err := s.q.GetPaperState(ctx, sqlcgen.GetPaperStateParams{UserID: userID, CopyID: copyID})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return wire.PaperReading{}, dbErr(err)
	}
	return paperReadingWire(copyID, r), nil
}

// paperEvent is the history a status change leaves, or "" for none. Reading again after a finish is a new start and
// the finish stays; going back to not started takes the finish back.
func paperEvent(from, to string) string {
	switch {
	case from == to:
		return ""
	case to == "finished":
		return "finished"
	case to == "reading":
		return "started"
	case from == "finished":
		return "unfinished"
	}
	return ""
}

// WritePaperReading applies one revisioned, idempotent change of the caller's reading of a copy.
func (s *Service) WritePaperReading(ctx context.Context, a Actor, copyID uuid.UUID, in wire.PaperReadingWrite) (wire.PaperReading, error) {
	op, err := parseUUID("operationId", in.OperationID)
	if err != nil {
		return wire.PaperReading{}, err
	}
	base, err := parseRev(in.BaseRevision)
	if err != nil {
		return wire.PaperReading{}, err
	}
	captured, err := parseTime("capturedAt", in.CapturedAt)
	if err != nil {
		return wire.PaperReading{}, err
	}
	if in.Status != "not_started" && in.Status != "reading" && in.Status != "finished" {
		return wire.PaperReading{}, apperr.Validation("status must be not_started, reading or finished.")
	}
	if in.Page != nil && (*in.Page < 1 || *in.Page > 100000) {
		return wire.PaperReading{}, apperr.Validation("page must be from 1 to 100000.")
	}
	if in.Page != nil && in.Status == "not_started" {
		return wire.PaperReading{}, apperr.Validation("A book that is not started has no page.")
	}
	// Authorization precedes any receipt so a denied request leaves no trace.
	if _, err := s.ReadableCopy(ctx, a.UserID, copyID); err != nil {
		return wire.PaperReading{}, err
	}
	fp := receipts.Fingerprint(http.MethodPut, "/physical-copies/"+copyID.String()+"/reading", in)
	_, body, err := receipts.New(s.pool).Run(ctx, a.UserID, op, fp,
		func(_ pgx.Tx, q *sqlcgen.Queries) error {
			if err := q.EnsurePaperState(ctx, sqlcgen.EnsurePaperStateParams{UserID: a.UserID, CopyID: copyID}); err != nil {
				return err
			}
			_, err := q.LockPaperState(ctx, sqlcgen.LockPaperStateParams{UserID: a.UserID, CopyID: copyID})
			return err
		},
		func(_ pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
			c, err := q.GetPhysicalCopy(ctx, copyID)
			if err != nil {
				return 0, nil, nil, err
			}
			cur, err := q.GetPaperState(ctx, sqlcgen.GetPaperStateParams{UserID: a.UserID, CopyID: copyID})
			if err != nil {
				return 0, nil, nil, err
			}
			if cur.Revision != base {
				return 0, nil, apperr.New(http.StatusConflict, "stale_revision", "Your reading of this book changed since that revision; refetch and retry.").
					With("currentRevision", strconv.FormatInt(cur.Revision, 10)), nil
			}
			var page *int32
			if in.Page != nil {
				if c.PageCount != nil && *in.Page > int64(*c.PageCount) {
					return 0, nil, nil, apperr.Validation("This copy has " + strconv.Itoa(int(*c.PageCount)) + " pages.")
				}
				n := int32(*in.Page)
				page = &n
			}
			now := s.now()
			next, err := q.SetPaperState(ctx, sqlcgen.SetPaperStateParams{UserID: a.UserID, CopyID: copyID, Status: in.Status, Page: page, ChangedAt: &now})
			if err != nil {
				return 0, nil, nil, err
			}
			if event := paperEvent(cur.Status, in.Status); event != "" {
				if err := q.InsertPaperHistory(ctx, sqlcgen.InsertPaperHistoryParams{UserID: a.UserID, TitleID: c.TitleID, CopyID: copyID,
					Event: event, OperationID: op, CapturedAt: captured, ReceivedAt: now}); err != nil {
					return 0, nil, nil, err
				}
			}
			return http.StatusOK, wire.Raw(paperReadingWire(copyID, next)), nil, nil
		})
	if err != nil {
		return wire.PaperReading{}, dbErr(err)
	}
	var out wire.PaperReading
	return out, json.Unmarshal(body, &out)
}

// PaperHistory lists the caller's own paper events for a title, in receive order.
func (s *Service) PaperHistory(ctx context.Context, userID, titleID uuid.UUID, page, size int) (wire.PaperHistory, error) {
	rows, err := s.q.ListPaperHistory(ctx, sqlcgen.ListPaperHistoryParams{UserID: userID, TitleID: titleID, Limit: int32(size), Offset: int32(page * size)})
	if err != nil {
		return wire.PaperHistory{}, dbErr(err)
	}
	total, err := s.q.CountPaperHistory(ctx, sqlcgen.CountPaperHistoryParams{UserID: userID, TitleID: titleID})
	if err != nil {
		return wire.PaperHistory{}, dbErr(err)
	}
	out := wire.PaperHistory{Items: []wire.PaperHistoryEntry{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, r := range rows {
		out.Items = append(out.Items, wire.PaperHistoryEntry{ID: r.ID.String(), TitleID: r.TitleID.String(), CopyID: r.CopyID.String(),
			Event: r.Event, CapturedAt: rfc(r.CapturedAt), ReceivedAt: rfc(r.ReceivedAt)})
	}
	return out, nil
}

// PaperOnlyTitle checks that a title has no ebook edition or recording, and returns the libraries of its copies.
func (s *Service) PaperOnlyTitle(ctx context.Context, titleID uuid.UUID) ([]uuid.UUID, error) {
	libs, err := s.q.ListTitleCopyLibraries(ctx, titleID)
	if err != nil {
		return nil, dbErr(err)
	}
	if len(libs) == 0 {
		return nil, apperr.ErrNotFound
	}
	files, err := s.q.CountTitleFileHoldings(ctx, titleID)
	if err != nil {
		return nil, dbErr(err)
	}
	if files > 0 {
		return nil, apperr.New(http.StatusConflict, "title_has_files",
			"This book has an ebook or audiobook. Edit its details through that.")
	}
	return libs, nil
}

func ptr[T any](v T) *T { return &v }
