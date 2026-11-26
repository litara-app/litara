package reading

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/metadata"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Authors and series keep shared details under their name, ignoring case (ADR-0102 to ADR-0105).
const (
	KindAuthor = "author"
	KindSeries = "series"
	photoField = "photo"
)

var directoryFields = map[string][]string{
	KindAuthor: {"last_name", "introduction", "biography"},
	KindSeries: {"description", "book_count", "status"},
}

var directoryTextLimits = map[string]int{"last_name": 200, "introduction": 500, "biography": 8000, "description": 8000}

func validDirectoryField(kind, field string) bool {
	for _, f := range directoryFields[kind] {
		if f == field {
			return true
		}
	}
	return false
}

// directoryValue checks one new value and returns it as stored; nil is a deliberate clear.
func directoryValue(c metadata.Change) (json.RawMessage, error) {
	if c.Clear {
		if t := bytes.TrimSpace(c.Value); len(t) != 0 && string(t) != "null" {
			return nil, apperr.Validation("A clear takes no value.")
		}
		if c.Field == "last_name" {
			return nil, apperr.Validation("An author always has a last name; reset it to return to the guess.")
		}
		return nil, nil
	}
	if c.Field == "book_count" {
		var n float64
		if json.Unmarshal(c.Value, &n) != nil || n < 1 || n > 10000 || n != float64(int(n)) {
			return nil, apperr.Validation("book_count must be a whole number from 1 to 10000.")
		}
		return wire.Raw(int(n)), nil
	}
	var s string
	if json.Unmarshal(c.Value, &s) != nil {
		return nil, apperr.Validation(c.Field + " must be text.")
	}
	s = strings.TrimSpace(s)
	if c.Field == "status" {
		if s != "ongoing" && s != "complete" {
			return nil, apperr.Validation("status must be ongoing or complete.")
		}
		return wire.Raw(s), nil
	}
	if s == "" {
		return nil, apperr.Validation(c.Field + " must not be empty; clear it instead.")
	}
	if limit := directoryTextLimits[c.Field]; utf8.RuneCountInString(s) > limit {
		return nil, apperr.Validation(c.Field + " is too long; the limit is " + strconv.Itoa(limit) + " characters.")
	}
	return wire.Raw(s), nil
}

// directoryName finds the author or series among the titles the user can see. Anything else is not found, so details
// never reveal a name held only in a library without a grant (ADR-0013).
func (s *Service) directoryName(ctx context.Context, userID uuid.UUID, kind, name string) (sqlcgen.DirectoryNameRow, error) {
	row, err := s.q.DirectoryName(ctx, sqlcgen.DirectoryNameParams{Kind: kind, Name: name, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, apperr.ErrNotFound
	}
	if err != nil {
		return row, dbErr(err)
	}
	return row, nil
}

func (s *Service) directoryReport(ctx context.Context, q *sqlcgen.Queries, kind string, n sqlcgen.DirectoryNameRow) (wire.DirectoryDetails, error) {
	out := wire.DirectoryDetails{Name: n.Name, Fields: []wire.DirectoryField{}}
	rev, err := q.GetDirectoryRevision(ctx, sqlcgen.GetDirectoryRevisionParams{Kind: kind, NameKey: n.NameKey})
	if err != nil {
		return out, err
	}
	out.Revision = strconv.FormatInt(rev, 10)
	rows, err := q.ListDirectoryValues(ctx, sqlcgen.ListDirectoryValuesParams{Kind: kind, NameKey: n.NameKey})
	if err != nil {
		return out, err
	}
	saved := map[string]sqlcgen.ListDirectoryValuesRow{}
	for _, r := range rows {
		saved[r.Field] = r
	}
	for _, field := range directoryFields[kind] {
		f := wire.DirectoryField{Field: field, Source: "none"}
		if r, ok := saved[field]; ok {
			f.Source, f.Value.Raw, f.Cleared, f.Locked = "user", r.Value, r.Value == nil, r.Locked
		} else if field == "last_name" {
			guess, err := q.GuessLastName(ctx, n.Name)
			if err != nil {
				return out, err
			}
			f.Source, f.Value.Raw = "guessed", wire.Raw(guess)
		}
		out.Fields = append(out.Fields, f)
	}
	if kind == KindAuthor {
		photo := wire.AuthorPhoto{Source: "none"}
		p, err := q.GetAuthorPhotoMeta(ctx, n.NameKey)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return out, err
		}
		if err == nil {
			photo.Source, photo.Locked = p.Source, p.Locked
			if p.Source != "none" {
				v := p.Version.String()
				photo.Version = &v
			}
		}
		out.Photo = &photo
	}
	return out, nil
}

// DirectoryDetails returns the details of an author or a series the user can see.
func (s *Service) DirectoryDetails(ctx context.Context, userID uuid.UUID, kind, name string) (wire.DirectoryDetails, error) {
	n, err := s.directoryName(ctx, userID, kind, name)
	if err != nil {
		return wire.DirectoryDetails{}, err
	}
	out, err := s.directoryReport(ctx, s.q, kind, n)
	if err != nil {
		return out, dbErr(err)
	}
	return out, nil
}

// mutateDirectory runs one change under the entry's revision (ADR-0105) with the usual idempotent receipt.
func (s *Service) mutateDirectory(ctx context.Context, a Actor, kind string, n sqlcgen.DirectoryNameRow, opID, baseRevision string,
	fp []byte, change func(q *sqlcgen.Queries) (*apperr.Error, error)) (wire.DirectoryDetails, error) {
	var out wire.DirectoryDetails
	op, err := parseUUID("operationId", opID)
	if err != nil {
		return out, err
	}
	base, err := parseRev(baseRevision)
	if err != nil {
		return out, err
	}
	var revision int64
	body, err := s.run(ctx, a, op, fp, func(q *sqlcgen.Queries) error {
		if err := q.EnsureDirectoryEntry(ctx, sqlcgen.EnsureDirectoryEntryParams{Kind: kind, NameKey: n.NameKey}); err != nil {
			return err
		}
		var err error
		revision, err = q.LockDirectoryEntry(ctx, sqlcgen.LockDirectoryEntryParams{Kind: kind, NameKey: n.NameKey})
		return err
	}, func(q *sqlcgen.Queries) ([]byte, *apperr.Error, error) {
		if base != revision {
			return nil, metadata.StaleRevision(revision), nil
		}
		if d, err := change(q); err != nil || d != nil {
			return nil, d, err
		}
		if err := q.BumpDirectoryEntry(ctx, sqlcgen.BumpDirectoryEntryParams{Kind: kind, NameKey: n.NameKey}); err != nil {
			return nil, nil, err
		}
		rep, err := s.directoryReport(ctx, q, kind, n)
		return wire.Raw(rep), nil, err
	})
	if err != nil {
		return out, err
	}
	return out, json.Unmarshal(body, &out)
}

// SaveDirectoryDetails applies a save's changes together or not at all. A locked field, or a locked photo, refuses to
// be set or reset until it is unlocked (ADR-0097). The photo takes only reset (remove), lock and unlock here.
func (s *Service) SaveDirectoryDetails(ctx context.Context, a Actor, kind, name string, w wire.MetadataSave) (wire.DirectoryDetails, error) {
	var none wire.DirectoryDetails
	changes := MetadataChanges(w.Changes)
	if d := metadata.CheckChanges(changes, func(f string) bool {
		return validDirectoryField(kind, f) || (kind == KindAuthor && f == photoField)
	}); d != nil {
		return none, d
	}
	stored := map[string]json.RawMessage{}
	for _, c := range changes {
		if c.Action != metadata.ActionSet {
			continue
		}
		if c.Field == photoField {
			return none, apperr.Validation("A photo is set by uploading it or giving its address.")
		}
		raw, err := directoryValue(c)
		if err != nil {
			return none, err
		}
		stored[c.Field] = raw
	}
	n, err := s.directoryName(ctx, a.UserID, kind, name)
	if err != nil {
		return none, err
	}
	fp := fingerprint(http.MethodPatch, "/directory/"+kind+"/"+n.NameKey, w)
	return s.mutateDirectory(ctx, a, kind, n, w.OperationID, w.BaseRevision, fp, func(q *sqlcgen.Queries) (*apperr.Error, error) {
		rep, err := s.directoryReport(ctx, q, kind, n)
		if err != nil {
			return nil, err
		}
		current := map[string]wire.DirectoryField{}
		for _, f := range rep.Fields {
			current[f.Field] = f
		}
		// Every lock is checked before anything is written, because a refusal's transaction commits its receipt.
		for _, c := range changes {
			if c.Action != metadata.ActionSet && c.Action != metadata.ActionReset {
				continue
			}
			if current[c.Field].Locked || (c.Field == photoField && rep.Photo.Locked) {
				return metadata.FieldLocked(c.Field), nil
			}
		}
		for _, c := range changes {
			var err error
			if c.Field == photoField {
				err = changePhoto(ctx, q, n.NameKey, a.UserID, c.Action)
			} else {
				err = changeDirectoryField(ctx, q, kind, n.NameKey, a.UserID, c.Action, current[c.Field], c.Field, stored[c.Field])
			}
			if err != nil {
				return nil, err
			}
		}
		return nil, nil
	})
}

func changeDirectoryField(ctx context.Context, q *sqlcgen.Queries, kind, key string, user uuid.UUID, action string,
	current wire.DirectoryField, field string, value json.RawMessage) error {
	upsert := sqlcgen.UpsertDirectoryValueParams{Kind: kind, NameKey: key, Field: field, Value: value,
		UpdatedBy: uuid.NullUUID{UUID: user, Valid: true}}
	lock := sqlcgen.SetDirectoryValueLockParams{Kind: kind, NameKey: key, Field: field, Locked: action == metadata.ActionLock}
	switch action {
	case metadata.ActionSet:
		return q.UpsertDirectoryValue(ctx, upsert)
	case metadata.ActionReset:
		return q.DeleteDirectoryValue(ctx, sqlcgen.DeleteDirectoryValueParams{Kind: kind, NameKey: key, Field: field})
	case metadata.ActionLock:
		// Locking freezes what is shown: a guess is copied, and an empty field is frozen empty.
		if current.Source != "user" {
			if current.Source == "guessed" {
				upsert.Value = current.Value.Raw
			}
			if err := q.UpsertDirectoryValue(ctx, upsert); err != nil {
				return err
			}
		}
	}
	return q.SetDirectoryValueLock(ctx, lock)
}

func changePhoto(ctx context.Context, q *sqlcgen.Queries, key string, user uuid.UUID, action string) error {
	switch action {
	case metadata.ActionReset:
		return q.DeleteAuthorPhoto(ctx, key)
	case metadata.ActionLock:
		_, err := q.GetAuthorPhotoMeta(ctx, key)
		if errors.Is(err, pgx.ErrNoRows) {
			err = q.UpsertAuthorPhoto(ctx, sqlcgen.UpsertAuthorPhotoParams{NameKey: key, Source: "none",
				UpdatedBy: uuid.NullUUID{UUID: user, Valid: true}})
		}
		if err != nil {
			return err
		}
	}
	return q.SetAuthorPhotoLock(ctx, sqlcgen.SetAuthorPhotoLockParams{NameKey: key, Locked: action == metadata.ActionLock})
}

// SetAuthorPhoto stores an image the caller has already re-encoded. request is the uploaded bytes or the address, so
// a retried operation is recognized.
func (s *Service) SetAuthorPhoto(ctx context.Context, a Actor, name, source string, image, request []byte, opID, baseRevision string) (wire.DirectoryDetails, error) {
	n, err := s.directoryName(ctx, a.UserID, KindAuthor, name)
	if err != nil {
		return wire.DirectoryDetails{}, err
	}
	sum := sha256.Sum256(request)
	fp := fingerprint(http.MethodPut, "/directory/author/"+n.NameKey+"/photo/"+source, []any{baseRevision, sum[:]})
	return s.mutateDirectory(ctx, a, KindAuthor, n, opID, baseRevision, fp, func(q *sqlcgen.Queries) (*apperr.Error, error) {
		p, err := q.GetAuthorPhotoMeta(ctx, n.NameKey)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if err == nil && p.Locked {
			return metadata.FieldLocked(photoField), nil
		}
		return nil, q.UpsertAuthorPhoto(ctx, sqlcgen.UpsertAuthorPhotoParams{NameKey: n.NameKey, Source: source, Image: image,
			UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: true}})
	})
}

// AuthorPhoto returns the stored photo of an author the user can see.
func (s *Service) AuthorPhoto(ctx context.Context, userID uuid.UUID, name string) ([]byte, uuid.UUID, error) {
	n, err := s.directoryName(ctx, userID, KindAuthor, name)
	if err != nil {
		return nil, uuid.Nil, err
	}
	p, err := s.q.GetAuthorPhoto(ctx, n.NameKey)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && p.Image == nil) {
		return nil, uuid.Nil, apperr.ErrNotFound
	}
	if err != nil {
		return nil, uuid.Nil, dbErr(err)
	}
	return p.Image, p.Version, nil
}
