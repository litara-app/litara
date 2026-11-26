package reading

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/catalog"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Shelves (ADR-0066): private or shared, manual or smart. Only the owner edits.
// Administrator status confers nothing here. A shelf that is private or deleted
// is invisible (404) to everyone but its owner; a shared shelf is readable by
// any signed-in user but editable only by its owner (403 for others).

func shelfKey(id uuid.UUID) string { return "shelf:" + id.String() }

// readableShelf resolves a shelf for a viewer without leaking private shelves.
func (s *Service) readableShelf(ctx context.Context, q *sqlcgen.Queries, viewer, id uuid.UUID) (sqlcgen.Shelf, error) {
	sh, err := q.GetShelf(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return sh, apperr.ErrNotFound
	}
	if err != nil {
		return sh, dbErr(err)
	}
	if sh.OwnerID == viewer || (sh.Visibility == "shared" && !sh.Deleted) {
		return sh, nil
	}
	return sh, apperr.ErrNotFound
}

// ownedShelf additionally requires the owner (403 for readable shelves of others).
func (s *Service) ownedShelf(ctx context.Context, q *sqlcgen.Queries, viewer, id uuid.UUID) (sqlcgen.Shelf, error) {
	sh, err := s.readableShelf(ctx, q, viewer, id)
	if err != nil {
		return sh, err
	}
	if sh.OwnerID != viewer {
		return sh, apperr.ErrAccessDenied
	}
	return sh, nil
}

func (s *Service) visibleMembers(ctx context.Context, q *sqlcgen.Queries, viewer uuid.UUID, shelf uuid.UUID) ([]uuid.UUID, error) {
	return q.ListVisibleShelfMembers(ctx, sqlcgen.ListVisibleShelfMembersParams{ShelfID: shelf, UserID: viewer})
}

func (s *Service) shelfWire(ctx context.Context, q *sqlcgen.Queries, sh sqlcgen.Shelf, viewer uuid.UUID) (wire.Shelf, error) {
	out := wire.Shelf{ID: sh.ID.String(), Revision: strconv.FormatInt(sh.Revision, 10), OwnerID: sh.OwnerID.String(),
		CanEdit: sh.OwnerID == viewer && !sh.Deleted, Deleted: sh.Deleted, UpdatedAt: rfc(sh.UpdatedAt), Evaluation: "manual"}
	if sh.Kind == "smart" {
		out.Evaluation = "viewer-specific"
	}
	if sh.Deleted {
		return out, nil
	}
	d := wire.ShelfData{Name: sh.Name, Visibility: sh.Visibility, Kind: sh.Kind}
	if len(sh.Filter) > 0 {
		var f wire.TitleFilter
		if err := json.Unmarshal(sh.Filter, &f); err != nil {
			return out, err
		}
		d.Filter = wire.Some(&f)
		_, n, err := s.cat.SmartShelfTitleIDs(ctx, viewer, f, 0, 0)
		if err != nil {
			return out, err
		}
		out.VisibleTitleCount = n
	} else {
		ids, err := s.visibleMembers(ctx, q, viewer, sh.ID)
		if err != nil {
			return out, dbErr(err)
		}
		out.VisibleTitleCount = int64(len(ids))
	}
	out.Data = wire.Some(&d)
	return out, nil
}

func (s *Service) ListShelves(ctx context.Context, viewer uuid.UUID, scope string, includeDeleted bool, page, size int) (wire.Shelves, error) {
	if scope != "mine" && scope != "shared" {
		return wire.Shelves{}, apperr.Validation("scope must be mine or shared.")
	}
	rows, err := s.q.ListShelvesPage(ctx, sqlcgen.ListShelvesPageParams{Scope: scope, UserID: viewer, IncludeDeleted: includeDeleted,
		PageSize: int32(size), PageOffset: int32(page * size)})
	if err != nil {
		return wire.Shelves{}, dbErr(err)
	}
	total, err := s.q.CountShelvesPage(ctx, sqlcgen.CountShelvesPageParams{Scope: scope, UserID: viewer, IncludeDeleted: includeDeleted})
	if err != nil {
		return wire.Shelves{}, dbErr(err)
	}
	out := wire.Shelves{Items: []wire.Shelf{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, r := range rows {
		w, err := s.shelfWire(ctx, s.q, r, viewer)
		if err != nil {
			return out, dbErr(err)
		}
		out.Items = append(out.Items, w)
	}
	return out, nil
}

func (s *Service) GetShelf(ctx context.Context, viewer, id uuid.UUID) (wire.Shelf, error) {
	sh, err := s.readableShelf(ctx, s.q, viewer, id)
	if err != nil {
		return wire.Shelf{}, err
	}
	w, err := s.shelfWire(ctx, s.q, sh, viewer)
	return w, dbErr(err)
}

// ShelfTitles lists a shelf's titles as the viewer sees them: manual members in
// stored order, smart results by title UUID, both limited to the viewer's grants.
func (s *Service) ShelfTitles(ctx context.Context, viewer, id uuid.UUID, page, size int) (wire.Titles, error) {
	sh, err := s.readableShelf(ctx, s.q, viewer, id)
	if err != nil {
		return wire.Titles{}, err
	}
	if sh.Deleted {
		return wire.Titles{}, apperr.ErrNotFound
	}
	var ids []uuid.UUID
	var total int64
	if len(sh.Filter) > 0 {
		var f wire.TitleFilter
		if err := json.Unmarshal(sh.Filter, &f); err != nil {
			return wire.Titles{}, dbErr(err)
		}
		if ids, total, err = s.cat.SmartShelfTitleIDs(ctx, viewer, f, size, page*size); err != nil {
			return wire.Titles{}, err
		}
	} else {
		all, err := s.visibleMembers(ctx, s.q, viewer, sh.ID)
		if err != nil {
			return wire.Titles{}, dbErr(err)
		}
		total = int64(len(all))
		lo, hi := min(page*size, len(all)), min(page*size+size, len(all))
		ids = all[lo:hi]
	}
	titles, err := s.cat.TitlesByIDs(ctx, viewer, ids)
	if err != nil {
		return wire.Titles{}, err
	}
	return wire.Titles{Items: titles, Total: total, Page: int64(page), Size: int64(size)}, nil
}

func validateShelfData(d wire.ShelfData) error {
	name := strings.TrimSpace(d.Name)
	if name == "" || utf8.RuneCountInString(d.Name) > 256 {
		return apperr.Validation("name must be 1 to 256 characters.")
	}
	if d.Visibility != "private" && d.Visibility != "shared" {
		return apperr.Validation("visibility must be private or shared.")
	}
	switch d.Kind {
	case "manual":
		if d.Filter.Value != nil {
			return apperr.Validation("A manual shelf must have filter null.")
		}
	case "smart":
		if d.Filter.Value == nil {
			return apperr.Validation("A smart shelf requires a filter.")
		}
		return catalog.ValidateShelfFilter(*d.Filter.Value)
	default:
		return apperr.Validation("kind must be manual or smart.")
	}
	return nil
}

// PutShelf creates (base 0) or updates a shelf. Kind never changes.
func (s *Service) PutShelf(ctx context.Context, a Actor, id uuid.UUID, w wire.ShelfWrite) (wire.Shelf, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.Shelf{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.Shelf{}, err
	}
	if _, err = parseTime("capturedAt", w.CapturedAt); err != nil {
		return wire.Shelf{}, err
	}
	if err := validateShelfData(w.Data); err != nil {
		return wire.Shelf{}, err
	}
	// Ownership is checked before any receipt so a denied request leaves no trace.
	if _, err := s.ownedShelfOrNew(ctx, s.q, a.UserID, id); err != nil {
		return wire.Shelf{}, err
	}
	fp := fingerprint(http.MethodPut, "/shelves/"+id.String(), w)
	body, err := s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error { return q.LockPersonalKey(ctx, shelfKey(id)) },
		func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
			cur, err := s.ownedShelfOrNew(ctx, q, a.UserID, id)
			if err != nil {
				return nil, nil, err
			}
			d, err := s.applyShelf(ctx, q, a, id, w, op, base, cur, true)
			if err != nil || d != nil {
				return nil, d, err
			}
			row, err := q.GetShelf(ctx, id)
			if err != nil {
				return nil, nil, err
			}
			out, err := s.shelfWire(ctx, q, row, a.UserID)
			if err != nil {
				return nil, nil, err
			}
			return wire.Raw(out), nil, nil
		})
	if err != nil {
		return wire.Shelf{}, err
	}
	var out wire.Shelf
	return out, json.Unmarshal(body, &out)
}

// ownedShelfOrNew returns a nil-ID shelf for a never-seen ID. A shelf of another
// user is 404 when private (including a colliding creation) and 403 when shared.
func (s *Service) ownedShelfOrNew(ctx context.Context, q *sqlcgen.Queries, viewer, id uuid.UUID) (*sqlcgen.Shelf, error) {
	sh, err := q.GetShelf(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, dbErr(err)
	}
	if sh.OwnerID != viewer {
		if sh.Visibility == "shared" && !sh.Deleted {
			return nil, apperr.ErrAccessDenied
		}
		return nil, apperr.ErrNotFound
	}
	return &sh, nil
}

func (s *Service) applyShelf(ctx context.Context, q *sqlcgen.Queries, a Actor, id uuid.UUID, w wire.ShelfWrite, op uuid.UUID,
	base int64, cur *sqlcgen.Shelf, checkBase bool) (*apperr.Error, error) {
	var currentRev int64
	if cur != nil {
		currentRev = cur.Revision
		if cur.Kind != w.Data.Kind {
			return nil, apperr.Validation("A shelf kind cannot change.")
		}
	}
	none := uuid.NullUUID{}
	switch {
	case cur != nil && cur.Deleted:
		return s.recordFor(ctx, q, a, "shelf", id, none, nil, op, w, base, currentRev, specDeleted)
	case checkBase && base != currentRev:
		return s.recordFor(ctx, q, a, "shelf", id, none, nil, op, w, base, currentRev, specStale)
	}
	var filter []byte
	if w.Data.Filter.Value != nil {
		var err error
		if filter, err = json.Marshal(w.Data.Filter.Value); err != nil {
			return nil, err
		}
	}
	now := s.now()
	if cur == nil {
		return nil, q.InsertShelf(ctx, sqlcgen.InsertShelfParams{ID: id, OwnerID: a.UserID, Kind: w.Data.Kind, Visibility: w.Data.Visibility,
			Name: strings.TrimSpace(w.Data.Name), Filter: filter, CreatedAt: now})
	}
	return nil, q.UpdateShelf(ctx, sqlcgen.UpdateShelfParams{ID: id, Visibility: w.Data.Visibility, Name: strings.TrimSpace(w.Data.Name), Filter: filter, UpdatedAt: now})
}

// DeleteShelf tombstones an owned shelf; members are retained as private evidence.
func (s *Service) DeleteShelf(ctx context.Context, a Actor, id uuid.UUID, w wire.RevisionedDelete) (wire.Shelf, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.Shelf{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.Shelf{}, err
	}
	if _, err = parseTime("capturedAt", w.CapturedAt); err != nil {
		return wire.Shelf{}, err
	}
	if _, err := s.ownedShelf(ctx, s.q, a.UserID, id); err != nil {
		return wire.Shelf{}, err
	}
	fp := fingerprint(http.MethodDelete, "/shelves/"+id.String(), w)
	body, err := s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error { return q.LockPersonalKey(ctx, shelfKey(id)) },
		func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
			cur, err := s.ownedShelf(ctx, q, a.UserID, id)
			if err != nil {
				return nil, nil, err
			}
			d, err := s.applyShelfDelete(ctx, q, a, cur, w, op, base, true)
			if err != nil || d != nil {
				return nil, d, err
			}
			row, err := q.GetShelf(ctx, id)
			if err != nil {
				return nil, nil, err
			}
			out, err := s.shelfWire(ctx, q, row, a.UserID)
			if err != nil {
				return nil, nil, err
			}
			return wire.Raw(out), nil, nil
		})
	if err != nil {
		return wire.Shelf{}, err
	}
	var out wire.Shelf
	return out, json.Unmarshal(body, &out)
}

func (s *Service) applyShelfDelete(ctx context.Context, q *sqlcgen.Queries, a Actor, cur sqlcgen.Shelf, w wire.RevisionedDelete, op uuid.UUID,
	base int64, checkBase bool) (*apperr.Error, error) {
	if checkBase && base != cur.Revision {
		return s.recordFor(ctx, q, a, "shelf", cur.ID, uuid.NullUUID{}, nil, op, w, base, cur.Revision, specStale)
	}
	if cur.Deleted {
		return nil, nil
	}
	return nil, q.TombstoneShelf(ctx, sqlcgen.TombstoneShelfParams{ID: cur.ID, UpdatedAt: s.now()})
}

// ChangeMember adds or removes one title of a manual shelf at the stated revision.
func (s *Service) ChangeMember(ctx context.Context, a Actor, shelfID, titleID uuid.UUID, action string, w wire.MemberChange) (wire.Shelf, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.Shelf{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.Shelf{}, err
	}
	if _, err = parseTime("capturedAt", w.CapturedAt); err != nil {
		return wire.Shelf{}, err
	}
	sh, err := s.ownedShelf(ctx, s.q, a.UserID, shelfID)
	if err != nil {
		return wire.Shelf{}, err
	}
	if sh.Kind != "manual" {
		return wire.Shelf{}, apperr.Validation("A smart shelf has no manual membership.")
	}
	if action == "add" {
		if err := s.cat.TitleVisible(ctx, a.UserID, titleID); err != nil { // the owner needs current access
			return wire.Shelf{}, err
		}
	} else if saw, err := s.q.UserSeesTitle(ctx, sqlcgen.UserSeesTitleParams{UserID: a.UserID, TitleID: titleID}); err != nil {
		return wire.Shelf{}, dbErr(err)
	} else if !saw {
		return wire.Shelf{}, apperr.ErrNotFound // a hidden member is not addressable by its ID
	}
	cand := wire.MembershipCandidate{OperationID: w.OperationID, BaseRevision: w.BaseRevision, CapturedAt: w.CapturedAt, Action: action, TitleID: titleID.String()}
	method := http.MethodPut
	if action == "remove" {
		method = http.MethodDelete
	}
	fp := fingerprint(method, "/shelves/"+shelfID.String()+"/titles/"+titleID.String(), w)
	body, err := s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error { return q.LockPersonalKey(ctx, shelfKey(shelfID)) },
		func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
			cur, err := s.ownedShelf(ctx, q, a.UserID, shelfID)
			if err != nil {
				return nil, nil, err
			}
			d, err := s.applyMember(ctx, q, a, cur, cand, op, base, true)
			if err != nil || d != nil {
				return nil, d, err
			}
			row, err := q.GetShelf(ctx, shelfID)
			if err != nil {
				return nil, nil, err
			}
			out, err := s.shelfWire(ctx, q, row, a.UserID)
			if err != nil {
				return nil, nil, err
			}
			return wire.Raw(out), nil, nil
		})
	if err != nil {
		return wire.Shelf{}, err
	}
	var out wire.Shelf
	return out, json.Unmarshal(body, &out)
}

func (s *Service) applyMember(ctx context.Context, q *sqlcgen.Queries, a Actor, cur sqlcgen.Shelf, c wire.MembershipCandidate, op uuid.UUID,
	base int64, checkBase bool) (*apperr.Error, error) {
	none := uuid.NullUUID{}
	switch {
	case cur.Deleted:
		return s.recordFor(ctx, q, a, "membership", cur.ID, none, nil, op, c, base, cur.Revision, specDeleted)
	case cur.Kind != "manual":
		return nil, apperr.Validation("A smart shelf has no manual membership.")
	case checkBase && base != cur.Revision:
		return s.recordFor(ctx, q, a, "membership", cur.ID, none, nil, op, c, base, cur.Revision, specStale)
	}
	title, _ := uuid.Parse(c.TitleID)
	has, err := q.HasShelfMember(ctx, sqlcgen.HasShelfMemberParams{ShelfID: cur.ID, TitleID: title})
	if err != nil {
		return nil, err
	}
	if c.Action == "add" {
		if saw, err := q.UserSeesTitle(ctx, sqlcgen.UserSeesTitleParams{UserID: a.UserID, TitleID: title}); err != nil {
			return nil, err
		} else if !saw {
			return s.recordFor(ctx, q, a, "membership", cur.ID, none, nil, op, c, base, cur.Revision, specAccess)
		}
		if has {
			return nil, nil // already a member: no revision is spent
		}
		if err := q.AppendShelfMember(ctx, sqlcgen.AppendShelfMemberParams{ShelfID: cur.ID, TitleID: title}); err != nil {
			return nil, err
		}
	} else {
		if !has {
			return nil, nil
		}
		if err := q.DeleteShelfMember(ctx, sqlcgen.DeleteShelfMemberParams{ShelfID: cur.ID, TitleID: title}); err != nil {
			return nil, err
		}
	}
	return nil, q.BumpShelf(ctx, sqlcgen.BumpShelfParams{ID: cur.ID, UpdatedAt: s.now()})
}

// OrderShelfTitles reorders the owner's visible members. Hidden members keep
// their relative slots and their IDs are never returned.
func (s *Service) OrderShelfTitles(ctx context.Context, a Actor, shelfID uuid.UUID, w wire.ShelfOrder) (wire.Shelf, error) {
	op, err := parseUUID("operationId", w.OperationID)
	if err != nil {
		return wire.Shelf{}, err
	}
	base, err := parseRev(w.BaseRevision)
	if err != nil {
		return wire.Shelf{}, err
	}
	if _, err = parseTime("capturedAt", w.CapturedAt); err != nil {
		return wire.Shelf{}, err
	}
	seen := map[string]bool{}
	for _, id := range w.VisibleTitleIDs {
		u, err := uuid.Parse(string(id))
		if err != nil || seen[u.String()] {
			return wire.Shelf{}, apperr.Validation("visibleTitleIds must be distinct UUIDs.")
		}
		seen[u.String()] = true
	}
	sh, err := s.ownedShelf(ctx, s.q, a.UserID, shelfID)
	if err != nil {
		return wire.Shelf{}, err
	}
	if sh.Kind != "manual" {
		return wire.Shelf{}, apperr.Validation("A smart shelf has no manual order.")
	}
	fp := fingerprint(http.MethodPut, "/shelves/"+shelfID.String()+"/order", w)
	body, err := s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error { return q.LockPersonalKey(ctx, shelfKey(shelfID)) },
		func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
			cur, err := s.ownedShelf(ctx, q, a.UserID, shelfID)
			if err != nil {
				return nil, nil, err
			}
			d, err := s.applyOrder(ctx, q, a, cur, w, op, base, true)
			if err != nil || d != nil {
				return nil, d, err
			}
			row, err := q.GetShelf(ctx, shelfID)
			if err != nil {
				return nil, nil, err
			}
			out, err := s.shelfWire(ctx, q, row, a.UserID)
			if err != nil {
				return nil, nil, err
			}
			return wire.Raw(out), nil, nil
		})
	if err != nil {
		return wire.Shelf{}, err
	}
	var out wire.Shelf
	return out, json.Unmarshal(body, &out)
}

func (s *Service) applyOrder(ctx context.Context, q *sqlcgen.Queries, a Actor, cur sqlcgen.Shelf, w wire.ShelfOrder, op uuid.UUID,
	base int64, checkBase bool) (*apperr.Error, error) {
	none := uuid.NullUUID{}
	switch {
	case cur.Deleted:
		return s.recordFor(ctx, q, a, "shelf-order", cur.ID, none, nil, op, w, base, cur.Revision, specDeleted)
	case checkBase && base != cur.Revision:
		return s.recordFor(ctx, q, a, "shelf-order", cur.ID, none, nil, op, w, base, cur.Revision, specStale)
	}
	visible, err := s.visibleMembers(ctx, q, a.UserID, cur.ID)
	if err != nil {
		return nil, err
	}
	want := make(map[uuid.UUID]bool, len(visible))
	for _, id := range visible {
		want[id] = true
	}
	if len(w.VisibleTitleIDs) != len(visible) {
		return s.recordFor(ctx, q, a, "shelf-order", cur.ID, none, nil, op, w, base, cur.Revision, specAccess)
	}
	order := make([]uuid.UUID, 0, len(visible))
	for _, id := range w.VisibleTitleIDs {
		u, _ := uuid.Parse(string(id))
		if !want[u] {
			return s.recordFor(ctx, q, a, "shelf-order", cur.ID, none, nil, op, w, base, cur.Revision, specAccess)
		}
		order = append(order, u)
	}
	rows, err := q.ListShelfMemberRows(ctx, cur.ID)
	if err != nil {
		return nil, err
	}
	// The visible members occupy a subset of slots; refill exactly those slots.
	var slots []int64
	for _, r := range rows {
		if want[r.TitleID] {
			slots = append(slots, r.Position)
		}
	}
	for i, id := range order {
		if err := q.SetShelfMemberPosition(ctx, sqlcgen.SetShelfMemberPositionParams{ShelfID: cur.ID, TitleID: id, Position: slots[i]}); err != nil {
			return nil, err
		}
	}
	return nil, q.BumpShelf(ctx, sqlcgen.BumpShelfParams{ID: cur.ID, UpdatedAt: s.now()})
}
