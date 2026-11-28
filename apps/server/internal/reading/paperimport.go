package reading

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/paperimport"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// CSV import of paper books (ADR-0117): uploaded, reviewed, then applied by a durable job. Who may import into a
// library is the caller's check. Only the uploader ever sees a plan, because the file holds their private reviews.

const (
	paperImportKept = 7 * 24 * time.Hour
	maxOpenImports  = 10
)

var errImportNotFound = apperr.ErrNotFound

// CreatePaperImport reads a file into a plan to review. Nothing in the catalogue changes, and the file is not kept.
func (s *Service) CreatePaperImport(ctx context.Context, userID, libraryID uuid.UUID, data []byte) (wire.PaperImport, error) {
	source, rows, err := paperimport.Read(data)
	var refused paperimport.FileError
	if errors.As(err, &refused) {
		return wire.PaperImport{}, apperr.New(http.StatusUnprocessableEntity, "import_file_refused", refused.Reason)
	}
	if err != nil {
		return wire.PaperImport{}, err
	}
	if _, err := s.ExpirePaperImports(ctx); err != nil {
		return wire.PaperImport{}, err
	}
	open, err := s.q.CountOpenPaperImports(ctx, userID)
	if err != nil {
		return wire.PaperImport{}, dbErr(err)
	}
	if open >= maxOpenImports {
		return wire.PaperImport{}, apperr.New(http.StatusConflict, "too_many_imports", "You have ten imports waiting. Finish or cancel one first.")
	}
	id := uuid.New()
	now := s.now()
	params := make([]sqlcgen.InsertPaperImportRowParams, 0, len(rows))
	for _, r := range rows {
		author := ""
		if len(r.Authors) > 0 {
			author = r.Authors[0]
		}
		params = append(params, sqlcgen.InsertPaperImportRowParams{ImportID: id, RowNo: int32(r.Number), Title: r.Title, Author: author, Data: wire.Raw(r)})
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if err := q.InsertPaperImport(ctx, sqlcgen.InsertPaperImportParams{ID: id, UserID: userID, LibraryID: libraryID, Source: source,
			RowCount: int32(len(rows)), CreatedAt: now, ExpiresAt: now.Add(paperImportKept)}); err != nil {
			return err
		}
		_, err := q.InsertPaperImportRow(ctx, params)
		return err
	})
	if err != nil {
		return wire.PaperImport{}, dbErr(err)
	}
	return s.PaperImport(ctx, userID, id)
}

// ExpirePaperImports deletes unapplied imports that are past their time, with the private text in them.
func (s *Service) ExpirePaperImports(ctx context.Context) (int64, error) {
	n, err := s.q.DeleteExpiredPaperImports(ctx, s.now())
	if err != nil {
		return 0, dbErr(err)
	}
	return n, nil
}

// PaperImportRecord is the uploader's own import. Another account's import does not exist to the caller.
func (s *Service) PaperImportRecord(ctx context.Context, userID, id uuid.UUID) (sqlcgen.PaperImport, error) {
	if _, err := s.ExpirePaperImports(ctx); err != nil {
		return sqlcgen.PaperImport{}, err
	}
	imp, err := s.q.GetPaperImport(ctx, sqlcgen.GetPaperImportParams{ID: id, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return imp, errImportNotFound
	}
	if err != nil {
		return imp, dbErr(err)
	}
	return imp, nil
}

// reviewed is one row with what it would do as the import stands.
type reviewed struct {
	stored   sqlcgen.PaperImportRow
	row      paperimport.Row
	selected bool
	plan     paperimport.Plan
}

func paperIndex(ctx context.Context, q *sqlcgen.Queries, userID, libraryID uuid.UUID) (*paperimport.Index, error) {
	found, err := q.ListPaperImportIndex(ctx, sqlcgen.ListPaperImportIndexParams{UserID: userID, LibraryID: libraryID})
	if err != nil {
		return nil, err
	}
	titles := make([]paperimport.Title, 0, len(found))
	for _, t := range found {
		titles = append(titles, paperimport.Title{ID: t.ID, Title: t.Title, Authors: t.Authors, ISBNs: t.Isbns, LibraryCopies: t.LibraryCopies})
	}
	return paperimport.NewIndex(titles), nil
}

func parsedRow(stored sqlcgen.PaperImportRow) (paperimport.Row, error) {
	var r paperimport.Row
	if stored.Data == nil { // applied: only what the report shows is kept
		return paperimport.Row{Number: int(stored.RowNo), Title: stored.Title, Authors: nonEmpty(stored.Author)}, nil
	}
	return r, json.Unmarshal(stored.Data, &r)
}

func nonEmpty(s string) []string {
	if s == "" {
		return nil
	}
	return []string{s}
}

func decision(imp sqlcgen.PaperImport, stored sqlcgen.PaperImportRow, r paperimport.Row) paperimport.Decision {
	d := paperimport.Decision{}
	if imp.Ownership != nil {
		d.Selected = paperimport.Selected(r, *imp.Ownership, imp.Shelves)
	}
	if stored.Selected != nil {
		d.Selected = *stored.Selected && r.Usable()
	}
	if stored.Choice != nil {
		d.Choice = *stored.Choice
		d.TitleID = stored.ChoiceTitleID.UUID
	}
	return d
}

func evaluate(ctx context.Context, q *sqlcgen.Queries, imp sqlcgen.PaperImport) ([]reviewed, error) {
	rows, err := q.ListPaperImportRows(ctx, imp.ID)
	if err != nil {
		return nil, err
	}
	var index *paperimport.Index
	if imp.State == "review" {
		if index, err = paperIndex(ctx, q, imp.UserID, imp.LibraryID); err != nil {
			return nil, err
		}
	}
	out := make([]reviewed, 0, len(rows))
	for _, stored := range rows {
		r, err := parsedRow(stored)
		if err != nil {
			return nil, err
		}
		v := reviewed{stored: stored, row: r}
		d := decision(imp, stored, r)
		v.selected = d.Selected
		if index != nil {
			v.plan = paperimport.Decide(index, r, d, imp.IncludeReading)
		} else if stored.PlannedAction != nil {
			v.plan = paperimport.Plan{Action: *stored.PlannedAction, TitleID: stored.PlannedTitleID.UUID}
		}
		out = append(out, v)
	}
	return out, nil
}

func (s *Service) importWire(ctx context.Context, imp sqlcgen.PaperImport) (wire.PaperImport, error) {
	out := wire.PaperImport{ID: imp.ID.String(), LibraryID: imp.LibraryID.String(), Source: imp.Source, State: imp.State,
		Revision: strconv.FormatInt(imp.Revision, 10), Rows: int64(imp.RowCount), Ownership: imp.Ownership,
		Shelves: append([]string{}, imp.Shelves...), IncludeReading: imp.IncludeReading, FileShelves: []wire.PaperImportShelf{},
		CreatedAt: rfc(imp.CreatedAt)}
	if imp.State != "completed" {
		out.ExpiresAt = rfcp(&imp.ExpiresAt)
	}
	if imp.State != "review" {
		counts, err := s.q.CountPaperImportOutcomes(ctx, imp.ID)
		if err != nil {
			return out, dbErr(err)
		}
		res := &wire.PaperImportResult{}
		for _, c := range counts {
			switch c.Outcome {
			case "added":
				res.Added = c.Rows
			case "attached":
				res.Attached = c.Rows
			case "reading_added":
				res.ReadingAdded = c.Rows
			case "skipped":
				res.Skipped = c.Rows
			case "failed":
				res.Failed = c.Rows
			default:
				res.Waiting = c.Rows
			}
		}
		out.Result = res
		return out, nil
	}
	rows, err := evaluate(ctx, s.q, imp)
	if err != nil {
		return out, dbErr(err)
	}
	plan := &wire.PaperImportPlan{}
	shelves := map[string]int64{}
	for _, v := range rows {
		for _, name := range v.row.Shelves {
			shelves[name]++
		}
		if v.row.OwnedCopies >= 1 && v.row.Usable() {
			out.MarkedOwned++
		}
		if v.row.HasReading() && v.row.Usable() {
			out.WithReading++
		}
		switch v.plan.Action {
		case paperimport.ActionNewBook:
			plan.NewBook++
			plan.Copies += int64(v.row.Copies())
		case paperimport.ActionAddCopy:
			plan.AddCopy++
			plan.Copies += int64(v.row.Copies())
		case paperimport.ActionReadingOnly:
			plan.ReadingOnly++
		case paperimport.ActionNeedsChoice:
			plan.NeedsChoice++
		case paperimport.ActionAlready:
			plan.Already++
		case paperimport.ActionNotOwned:
			plan.NotOwned++
		case paperimport.ActionSkip:
			plan.Skipped++
		default:
			plan.Unusable++
		}
	}
	out.Plan = plan
	for name, n := range shelves {
		out.FileShelves = append(out.FileShelves, wire.PaperImportShelf{Name: name, Rows: n})
	}
	sort.Slice(out.FileShelves, func(i, j int) bool {
		a, b := out.FileShelves[i], out.FileShelves[j]
		return a.Rows > b.Rows || a.Rows == b.Rows && a.Name < b.Name
	})
	out.FileShelves = out.FileShelves[:min(len(out.FileShelves), 200)]
	return out, nil
}

// PaperImport is the uploader's import with what applying it would do, or what it has done.
func (s *Service) PaperImport(ctx context.Context, userID, id uuid.UUID) (wire.PaperImport, error) {
	imp, err := s.PaperImportRecord(ctx, userID, id)
	if err != nil {
		return wire.PaperImport{}, err
	}
	return s.importWire(ctx, imp)
}

// PaperImports lists the uploader's imports, newest first, without counting each plan.
func (s *Service) PaperImports(ctx context.Context, userID uuid.UUID) (wire.PaperImports, error) {
	if _, err := s.ExpirePaperImports(ctx); err != nil {
		return wire.PaperImports{}, err
	}
	rows, err := s.q.ListPaperImports(ctx, userID)
	if err != nil {
		return wire.PaperImports{}, dbErr(err)
	}
	out := wire.PaperImports{Items: []wire.PaperImport{}}
	for _, imp := range rows {
		item := wire.PaperImport{ID: imp.ID.String(), LibraryID: imp.LibraryID.String(), Source: imp.Source, State: imp.State,
			Revision: strconv.FormatInt(imp.Revision, 10), Rows: int64(imp.RowCount), Ownership: imp.Ownership,
			Shelves: append([]string{}, imp.Shelves...), IncludeReading: imp.IncludeReading, FileShelves: []wire.PaperImportShelf{},
			CreatedAt: rfc(imp.CreatedAt)}
		if imp.State != "completed" {
			item.ExpiresAt = rfcp(&imp.ExpiresAt)
		}
		out.Items = append(out.Items, item)
	}
	return out, nil
}

// rowShown reports whether a row belongs to one of the review's lists.
func rowShown(filter string, v reviewed) bool {
	outcome := ""
	if v.stored.Outcome != nil {
		outcome = *v.stored.Outcome
	}
	switch filter {
	case "choose":
		return v.plan.Action == paperimport.ActionNeedsChoice
	case "copies":
		return v.plan.Action == paperimport.ActionNewBook || v.plan.Action == paperimport.ActionAddCopy
	case "reading":
		return v.plan.Action == paperimport.ActionReadingOnly
	case "left":
		switch v.plan.Action {
		case paperimport.ActionAlready, paperimport.ActionNotOwned, paperimport.ActionSkip, paperimport.ActionUnusable:
			return true
		}
		return false
	case "problems":
		return len(v.row.Problems) > 0 || outcome == "failed"
	}
	return true
}

// PaperImportRows lists a page of rows with what each would do, or did.
func (s *Service) PaperImportRows(ctx context.Context, userID, id uuid.UUID, filter string, page, size int) (wire.PaperImportRows, error) {
	imp, err := s.PaperImportRecord(ctx, userID, id)
	if err != nil {
		return wire.PaperImportRows{}, err
	}
	rows, err := evaluate(ctx, s.q, imp)
	if err != nil {
		return wire.PaperImportRows{}, dbErr(err)
	}
	shown := rows[:0:0]
	for _, v := range rows {
		if rowShown(filter, v) {
			shown = append(shown, v)
		}
	}
	out := wire.PaperImportRows{Items: []wire.PaperImportRow{}, Total: int64(len(shown)), Page: int64(page), Size: int64(size)}
	for i := page * size; i >= 0 && i < len(shown) && i < (page+1)*size; i++ {
		out.Items = append(out.Items, importRowWire(shown[i]))
	}
	return out, nil
}

func importRowWire(v reviewed) wire.PaperImportRow {
	r := wire.PaperImportRow{Row: int64(v.stored.RowNo), Title: v.stored.Title, Authors: []wire.Str512{}, Shelves: append([]string{}, v.row.Shelves...),
		Selected: v.selected, Action: v.plan.Action, Choice: v.stored.Choice, Matches: []wire.PaperTitleMatch{},
		Problems: append([]string{}, v.row.Problems...), Outcome: v.stored.Outcome, Detail: v.stored.OutcomeDetail, HasReading: v.row.HasReading()}
	if r.Action == "" {
		r.Action = paperimport.ActionSkip
	}
	for _, a := range v.row.Authors {
		r.Authors = append(r.Authors, wire.Str512(a))
	}
	if v.row.ISBN != "" {
		isbn := v.row.ISBN
		r.ISBN = &isbn
	}
	if v.row.Usable() {
		r.Copies = int64(v.row.Copies())
	}
	target := v.plan.TitleID
	if v.stored.ResultTitleID.Valid {
		target = v.stored.ResultTitleID.UUID
	}
	if target != uuid.Nil {
		t := target.String()
		r.TitleID = &t
	}
	for _, m := range v.plan.Matches {
		w := wire.PaperTitleMatch{TitleID: m.Title.ID.String(), Title: m.Title.Title, Authors: []wire.Str512{}, SameISBN: m.SameISBN}
		for _, a := range m.Title.Authors {
			w.Authors = append(w.Authors, wire.Str512(a))
		}
		r.Matches = append(r.Matches, w)
	}
	return r
}

// changeImport runs a change to an import that is still being reviewed.
func (s *Service) changeImport(ctx context.Context, userID, id uuid.UUID, change func(q *sqlcgen.Queries, imp sqlcgen.PaperImport) error) error {
	if _, err := s.PaperImportRecord(ctx, userID, id); err != nil {
		return err
	}
	return dbErr(pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		imp, err := q.LockPaperImport(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return errImportNotFound
		}
		if err != nil {
			return err
		}
		if imp.State != "review" {
			return apperr.New(http.StatusConflict, "import_applied", "This import has already been applied.")
		}
		return change(q, imp)
	}))
}

// SetPaperImportOptions answers the questions about the whole file.
func (s *Service) SetPaperImportOptions(ctx context.Context, userID, id uuid.UUID, in wire.PaperImportOptions) (wire.PaperImport, error) {
	if in.Ownership != nil {
		switch *in.Ownership {
		case paperimport.OwnAll, paperimport.OwnMarked, paperimport.OwnShelves, paperimport.OwnPick:
		default:
			return wire.PaperImport{}, apperr.Validation("ownership must be all, owned, shelves or pick.")
		}
	}
	shelves := []string{}
	if in.Ownership != nil && *in.Ownership == paperimport.OwnShelves {
		for _, name := range in.Shelves {
			if name = strings.ToLower(strings.TrimSpace(name)); name != "" && len(name) <= 400 && !slices.Contains(shelves, name) && len(shelves) < 200 {
				shelves = append(shelves, name)
			}
		}
		sort.Strings(shelves)
	}
	err := s.changeImport(ctx, userID, id, func(q *sqlcgen.Queries, imp sqlcgen.PaperImport) error {
		same := (in.Ownership == nil) == (imp.Ownership == nil) && (in.Ownership == nil || *in.Ownership == *imp.Ownership) && slices.Equal(shelves, imp.Shelves)
		if !same {
			if err := q.ClearPaperImportSelections(ctx, id); err != nil {
				return err
			}
		}
		return q.SetPaperImportOptions(ctx, sqlcgen.SetPaperImportOptionsParams{ID: id, Ownership: in.Ownership, Shelves: shelves, IncludeReading: in.IncludeReading})
	})
	if err != nil {
		return wire.PaperImport{}, err
	}
	return s.PaperImport(ctx, userID, id)
}

// SetPaperImportRow records the person's own choices for one row.
func (s *Service) SetPaperImportRow(ctx context.Context, userID, id uuid.UUID, number int, in wire.PaperImportRowChange) (wire.PaperImportRow, error) {
	var out wire.PaperImportRow
	err := s.changeImport(ctx, userID, id, func(q *sqlcgen.Queries, imp sqlcgen.PaperImport) error {
		stored, err := q.GetPaperImportRow(ctx, sqlcgen.GetPaperImportRowParams{ImportID: id, RowNo: int32(number)})
		if errors.Is(err, pgx.ErrNoRows) {
			return errImportNotFound
		}
		if err != nil {
			return err
		}
		r, err := parsedRow(stored)
		if err != nil {
			return err
		}
		index, err := paperIndex(ctx, q, userID, imp.LibraryID)
		if err != nil {
			return err
		}
		if in.Selected != nil {
			if *in.Selected && !r.Usable() {
				return apperr.Validation("This row has no title and cannot be imported.")
			}
			stored.Selected = in.Selected
		}
		if in.Choice != nil {
			stored.Choice, stored.ChoiceTitleID = nil, uuid.NullUUID{}
			switch *in.Choice {
			case "auto":
			case paperimport.ChoiceSeparate, paperimport.ChoiceSkip:
				stored.Choice = in.Choice
			case paperimport.ChoiceAttach:
				if in.TitleID == nil {
					return apperr.Validation("titleId is required to add the copy to a book.")
				}
				target, err := parseUUID("titleId", *in.TitleID)
				if err != nil {
					return err
				}
				if !slices.ContainsFunc(index.Matches(r), func(m paperimport.Match) bool { return m.Title.ID == target }) {
					return apperr.Validation("That book is not one of this row's matches.")
				}
				stored.Choice, stored.ChoiceTitleID = in.Choice, uuid.NullUUID{UUID: target, Valid: true}
			default:
				return apperr.Validation("choice must be auto, attach, separate or skip.")
			}
		}
		if err := q.SetPaperImportRowDecision(ctx, sqlcgen.SetPaperImportRowDecisionParams{ImportID: id, RowNo: stored.RowNo,
			Selected: stored.Selected, Choice: stored.Choice, ChoiceTitleID: stored.ChoiceTitleID}); err != nil {
			return err
		}
		d := decision(imp, stored, r)
		out = importRowWire(reviewed{stored: stored, row: r, selected: d.Selected, plan: paperimport.Decide(index, r, d, imp.IncludeReading)})
		return q.BumpPaperImport(ctx, id)
	})
	return out, err
}

// leftOut explains, for the report, a row that applying leaves alone.
func leftOut(action string, r paperimport.Row) (string, bool) {
	switch action {
	case paperimport.ActionNeedsChoice:
		return "It may be a book already in the catalogue, and no choice was made.", true
	case paperimport.ActionAlready:
		return "This paper copy is already recorded in the library.", true
	case paperimport.ActionNotOwned:
		return "Not marked as owned on paper.", true
	case paperimport.ActionSkip:
		return "You chose to leave this row out.", true
	case paperimport.ActionUnusable:
		if len(r.Problems) > 0 {
			return strings.Join(r.Problems, " "), true
		}
		return "There is no title.", true
	}
	return "", false
}

// ApplyPaperImport fixes what the reviewed plan does and queues the work. Applying again changes nothing.
func (s *Service) ApplyPaperImport(ctx context.Context, userID, id uuid.UUID, base int64, enqueue func(pgx.Tx) error) (wire.PaperImport, error) {
	if _, err := s.PaperImportRecord(ctx, userID, id); err != nil {
		return wire.PaperImport{}, err
	}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		imp, err := q.LockPaperImport(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return errImportNotFound
		}
		if err != nil {
			return err
		}
		if imp.State != "review" {
			return nil
		}
		if imp.Revision != base {
			return apperr.New(http.StatusConflict, "stale_revision", "The import changed since that revision; look again and retry.").
				With("currentRevision", strconv.FormatInt(imp.Revision, 10))
		}
		if imp.Ownership == nil {
			return apperr.New(http.StatusConflict, "ownership_unanswered", "Say which books in this file you own on paper first.")
		}
		rows, err := evaluate(ctx, q, imp)
		if err != nil {
			return err
		}
		for _, v := range rows {
			action := v.plan.Action
			if err := q.SetPaperImportRowPlan(ctx, sqlcgen.SetPaperImportRowPlanParams{ImportID: id, RowNo: v.stored.RowNo, PlannedAction: &action,
				PlannedTitleID: uuid.NullUUID{UUID: v.plan.TitleID, Valid: v.plan.TitleID != uuid.Nil}}); err != nil {
				return err
			}
			if why, left := leftOut(action, v.row); left {
				if err := setOutcome(ctx, q, id, v.stored.RowNo, "skipped", why, uuid.Nil, nil); err != nil {
					return err
				}
			}
		}
		now := s.now()
		if err := q.StartPaperImport(ctx, sqlcgen.StartPaperImportParams{ID: id, Now: &now, ExpiresAt: now.Add(paperImportKept)}); err != nil {
			return err
		}
		return enqueue(tx)
	})
	if err != nil {
		return wire.PaperImport{}, dbErr(err)
	}
	return s.PaperImport(ctx, userID, id)
}

func setOutcome(ctx context.Context, q *sqlcgen.Queries, id uuid.UUID, row int32, outcome, detail string, title uuid.UUID, copies []uuid.UUID) error {
	if r := []rune(detail); len(r) > 1024 {
		detail = string(r[:1024])
	}
	if copies == nil {
		copies = []uuid.UUID{}
	}
	return q.SetPaperImportRowOutcome(ctx, sqlcgen.SetPaperImportRowOutcomeParams{ImportID: id, RowNo: row, Outcome: &outcome, OutcomeDetail: &detail,
		ResultTitleID: uuid.NullUUID{UUID: title, Valid: title != uuid.Nil}, CopyIds: copies})
}

// importRun is what one run of the job carries between rows. It is rebuilt from the stored rows, so an interrupted
// import continues where it stopped.
type importRun struct {
	groups  map[string]uuid.UUID // new books this import has made, by what rows share
	copies  []uuid.UUID          // copies this import has made
	manages bool
}

func (s *Service) startImportRun(ctx context.Context, imp sqlcgen.PaperImport) (*importRun, error) {
	run := &importRun{groups: map[string]uuid.UUID{}}
	rows, err := s.q.ListPaperImportRows(ctx, imp.ID)
	if err != nil {
		return nil, err
	}
	for _, stored := range rows {
		run.copies = append(run.copies, stored.CopyIds...)
		if stored.PlannedAction != nil && *stored.PlannedAction == paperimport.ActionNewBook && stored.ResultTitleID.Valid {
			r, err := parsedRow(stored)
			if err != nil {
				return nil, err
			}
			for _, k := range paperimport.GroupKeys(r) {
				run.groups[k] = stored.ResultTitleID.UUID
			}
		}
	}
	run.manages, err = s.q.ManagesLibrary(ctx, sqlcgen.ManagesLibraryParams{UserID: imp.UserID, LibraryID: imp.LibraryID})
	return run, err
}

// RunPaperImport applies an import row by row, each in its own transaction. A row that cannot be applied does not
// undo the others. An error that is not about one row is returned, and the job is tried again.
func (s *Service) RunPaperImport(ctx context.Context, id uuid.UUID) error {
	imp, err := s.q.GetPaperImportByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // deleted, nothing left to do
	}
	if err != nil || imp.State != "applying" {
		return err
	}
	run, err := s.startImportRun(ctx, imp)
	if err != nil {
		return err
	}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		done := false
		err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
			q := s.q.WithTx(tx)
			current, err := q.LockPaperImport(ctx, id)
			if errors.Is(err, pgx.ErrNoRows) || err == nil && current.State != "applying" {
				done = true
				return nil
			}
			if err != nil {
				return err
			}
			stored, err := q.NextPaperImportRow(ctx, id)
			if errors.Is(err, pgx.ErrNoRows) {
				done = true
				now := s.now()
				if err := q.CompletePaperImport(ctx, sqlcgen.CompletePaperImportParams{ID: id, Now: &now}); err != nil {
					return err
				}
				// The private text of the file goes as soon as it has been used.
				return q.ScrubPaperImportRows(ctx, id)
			}
			if err != nil {
				return err
			}
			if !run.manages {
				return setOutcome(ctx, q, id, stored.RowNo, "skipped", "You no longer manage this library.", uuid.Nil, nil)
			}
			r, err := parsedRow(stored)
			if err != nil {
				return err
			}
			// A savepoint, so that a failed row leaves nothing of itself behind.
			var made rowResult
			rowErr := pgx.BeginFunc(ctx, tx, func(sp pgx.Tx) error {
				made, err = s.applyImportRow(ctx, sp, s.q.WithTx(sp), current, stored, r, run)
				return err
			})
			var about *pgconn.PgError
			if refused, ok := apperr.As(rowErr); ok {
				return setOutcome(ctx, q, id, stored.RowNo, "skipped", refused.Detail, uuid.Nil, nil)
			}
			if errors.As(rowErr, &about) && (strings.HasPrefix(about.Code, "22") || strings.HasPrefix(about.Code, "23")) {
				return setOutcome(ctx, q, id, stored.RowNo, "failed", "The database would not accept this row.", uuid.Nil, nil)
			}
			if rowErr != nil {
				return rowErr
			}
			if err := setOutcome(ctx, q, id, stored.RowNo, made.outcome, made.detail, made.title, made.copies); err != nil {
				return err
			}
			run.copies = append(run.copies, made.copies...)
			for _, k := range made.groupKeys {
				run.groups[k] = made.title
			}
			return nil
		})
		if err != nil {
			return err
		}
		if done {
			return nil
		}
	}
}

type rowResult struct {
	outcome, detail string
	title           uuid.UUID
	copies          []uuid.UUID
	groupKeys       []string
}

func refuseRow(why string) error {
	return apperr.New(http.StatusConflict, "import_row_changed", why)
}

func (s *Service) applyImportRow(ctx context.Context, tx pgx.Tx, q *sqlcgen.Queries, imp sqlcgen.PaperImport, stored sqlcgen.PaperImportRow,
	r paperimport.Row, run *importRun) (rowResult, error) {
	var out rowResult
	action := ""
	if stored.PlannedAction != nil {
		action = *stored.PlannedAction
	}
	target := stored.PlannedTitleID.UUID
	said := []string{}

	if action == paperimport.ActionAddCopy || action == paperimport.ActionReadingOnly {
		// A book that changed after the review is checked again.
		seen, err := q.UserSeesTitle(ctx, sqlcgen.UserSeesTitleParams{UserID: imp.UserID, TitleID: target})
		if err != nil {
			return out, err
		}
		if !seen {
			return out, refuseRow("The book chosen for this row is no longer in your catalogue.")
		}
		if action == paperimport.ActionAddCopy && stored.Choice == nil {
			others, err := q.CountOtherCopies(ctx, sqlcgen.CountOtherCopiesParams{TitleID: target, LibraryID: imp.LibraryID, Isbn: r.ISBN,
				Ours: append([]uuid.UUID{}, run.copies...)})
			if err != nil {
				return out, err
			}
			if others > 0 {
				return out, refuseRow("This paper copy was added after you reviewed the import.")
			}
		}
	}

	switch action {
	case paperimport.ActionNewBook:
		for _, k := range paperimport.GroupKeys(r) {
			if id, ok := run.groups[k]; ok {
				target = id
				break
			}
		}
		if target == uuid.Nil {
			id, err := insertPaperTitle(ctx, q, newTitleFromRow(r))
			if err != nil {
				return out, err
			}
			target, out.outcome = id, "added"
			said = append(said, "Added the book")
		} else {
			out.outcome = "attached"
			said = append(said, "The same book as an earlier row")
		}
		out.groupKeys = paperimport.GroupKeys(r)
	case paperimport.ActionAddCopy:
		out.outcome = "attached"
		said = append(said, "Found the book in your catalogue")
	case paperimport.ActionReadingOnly:
		out.outcome = "reading_added"
	default:
		return out, refuseRow("There was nothing to do for this row.")
	}
	out.title = target

	if action != paperimport.ActionReadingOnly {
		cols, err := checkCopy(copyFromRow(r))
		if err != nil {
			return out, err
		}
		for range r.Copies() {
			id := uuid.New()
			if err := q.InsertPhysicalCopy(ctx, sqlcgen.InsertPhysicalCopyParams{ID: id, TitleID: target, LibraryID: imp.LibraryID,
				Binding: cols.binding, Isbn: cols.isbn, PageCount: cols.pageCount, Location: cols.location, Now: s.now()}); err != nil {
				return out, err
			}
			out.copies = append(out.copies, id)
		}
		if len(out.copies) == 1 {
			said = append(said, "1 paper copy")
		} else {
			said = append(said, fmt.Sprintf("%d paper copies", len(out.copies)))
		}
	}

	if imp.IncludeReading && r.HasReading() {
		added, err := s.importReading(ctx, tx, q, imp.UserID, target, out.copies, r)
		if err != nil {
			return out, err
		}
		said = append(said, added...)
		if action == paperimport.ActionReadingOnly && len(added) == 0 {
			out.outcome = "skipped"
			said = append(said, "Nothing to add: what the row says is already saved")
		}
	}
	out.detail = strings.Join(said, ". ") + "."
	return out, nil
}

func optional(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

func newTitleFromRow(r paperimport.Row) wire.NewPaperTitle {
	t := wire.NewPaperTitle{Title: r.Title, Series: optional(r.Series), SeriesIndex: r.SeriesIndex, Publisher: optional(r.Publisher), Published: optional(r.Published)}
	for _, a := range r.Authors {
		t.Authors = append(t.Authors, wire.Str512(a))
	}
	if t.Series == nil {
		t.SeriesIndex = nil
	}
	return t
}

func copyFromRow(r paperimport.Row) wire.CopyDetails {
	d := wire.CopyDetails{Binding: optional(r.Binding), ISBN: optional(r.ISBN), Location: optional(r.Location)}
	if r.Pages > 0 {
		n := int64(r.Pages)
		d.PageCount = &n
	}
	return d
}

// importReading adds the person's own reading. It fills what is empty and replaces nothing. It says what it added.
func (s *Service) importReading(ctx context.Context, _ pgx.Tx, q *sqlcgen.Queries, userID, title uuid.UUID, copies []uuid.UUID, r paperimport.Row) ([]string, error) {
	if err := q.LockPersonalKey(ctx, personalKey(userID, title)); err != nil {
		return nil, err
	}
	finishedBefore, err := q.HasFinishedTitle(ctx, sqlcgen.HasFinishedTitleParams{UserID: userID, TitleID: title})
	if err != nil {
		return nil, err
	}
	var readOn *time.Time
	if r.Exclusive == "read" && r.DateRead != "" {
		d, err := time.Parse("2006-01-02", r.DateRead)
		if err != nil {
			return nil, err
		}
		noon := d.Add(12 * time.Hour) // the same calendar day nearly everywhere
		readOn = &noon
	}
	said := []string{}

	// Reading state belongs to a copy, so only a row that made one can set it, and never after an earlier finish.
	status := map[string]string{"read": "finished", "currently-reading": "reading"}[r.Exclusive]
	if len(copies) > 0 && status != "" && !finishedBefore {
		now := s.now()
		if err := q.EnsurePaperState(ctx, sqlcgen.EnsurePaperStateParams{UserID: userID, CopyID: copies[0]}); err != nil {
			return nil, err
		}
		changed := now
		if readOn != nil {
			changed = *readOn
		}
		if _, err := q.SetPaperState(ctx, sqlcgen.SetPaperStateParams{UserID: userID, CopyID: copies[0], Status: status, ChangedAt: &changed}); err != nil {
			return nil, err
		}
		// Only a known date makes history: an unknown one would count the book as read on the day of the import.
		if readOn != nil {
			if err := q.InsertPaperHistory(ctx, sqlcgen.InsertPaperHistoryParams{UserID: userID, TitleID: title, CopyID: copies[0], Event: "finished",
				OperationID: uuid.New(), CapturedAt: *readOn, ReceivedAt: now}); err != nil {
				return nil, err
			}
		}
		if status == "finished" {
			said = append(said, "Marked finished for you")
		} else {
			said = append(said, "Marked as one you are reading")
		}
	}

	cur, err := q.GetTitlePersonal(ctx, sqlcgen.GetTitlePersonalParams{UserID: userID, TitleID: title})
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	rating, review, finished := cur.RatingHalves, cur.Review, cur.FinishedAt
	changed := false
	if rating == nil && r.Rating > 0 {
		v := int16(r.Rating * 2)
		rating, changed = &v, true
		said = append(said, "Added your rating")
	}
	if review == nil && r.Review != "" {
		v := r.Review
		review, changed = &v, true
		said = append(said, "Added your review")
	}
	// Without a copy, a finish date is kept as the person's own date.
	if len(copies) == 0 && readOn != nil && !finishedBefore && (cur.StartedAt == nil || !readOn.Before(*cur.StartedAt)) {
		finished, changed = readOn, true
		said = append(said, "Added the date you finished it")
	}
	if !changed {
		return said, nil
	}
	if exists {
		err = q.UpdateTitlePersonal(ctx, sqlcgen.UpdateTitlePersonalParams{UserID: userID, TitleID: title, RatingHalves: rating, Review: review,
			StartedAt: cur.StartedAt, FinishedAt: finished, UpdatedAt: s.now()})
	} else {
		err = q.InsertTitlePersonal(ctx, sqlcgen.InsertTitlePersonalParams{UserID: userID, TitleID: title, RatingHalves: rating, Review: review,
			StartedAt: nil, FinishedAt: finished, UpdatedAt: s.now()})
	}
	return said, err
}

// DeletePaperImport cancels a review, or removes the report of a finished import. It never undoes what was applied.
func (s *Service) DeletePaperImport(ctx context.Context, userID, id uuid.UUID) error {
	if _, err := s.PaperImportRecord(ctx, userID, id); err != nil {
		return err
	}
	return dbErr(pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		imp, err := q.LockPaperImport(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if imp.State == "applying" {
			return apperr.New(http.StatusConflict, "import_running", "This import is being applied. Wait for it to finish.")
		}
		return q.DeletePaperImport(ctx, id)
	}))
}

var outcomeWords = map[string]string{"added": "Added", "attached": "Added to a book", "reading_added": "Reading added", "skipped": "Skipped", "failed": "Failed", "": "Waiting"}

// PaperImportReport is what an applied import did, as CSV: titles and outcomes, never review text.
func (s *Service) PaperImportReport(ctx context.Context, userID, id uuid.UUID) ([]byte, error) {
	imp, err := s.PaperImportRecord(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if imp.State == "review" {
		return nil, apperr.New(http.StatusConflict, "import_not_applied", "There is a report once the import has been applied.")
	}
	rows, err := s.q.ListPaperImportRows(ctx, id)
	if err != nil {
		return nil, dbErr(err)
	}
	var b bytes.Buffer
	w := csv.NewWriter(&b)
	_ = w.Write([]string{"Row", "Title", "Author", "Result", "Detail"})
	for _, v := range rows {
		outcome, detail := "", ""
		if v.Outcome != nil {
			outcome = *v.Outcome
		}
		if v.OutcomeDetail != nil {
			detail = *v.OutcomeDetail
		}
		_ = w.Write([]string{strconv.Itoa(int(v.RowNo)), csvCell(v.Title), csvCell(v.Author), outcomeWords[outcome], csvCell(detail)})
	}
	w.Flush()
	return b.Bytes(), w.Error()
}

// PaperImportTemplate is an empty file with the columns Litara reads.
func PaperImportTemplate() []byte {
	return []byte(strings.Join(paperimport.TemplateHeader, ",") + "\r\n")
}
