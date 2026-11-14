// Package reading implements revisioned ebook/comic edition position and
// completion writes, durable personal conflicts and the per-user operation
// receipts that make retries safe (ADR-0065, contracts/t005/README.md).
// Every write is one PostgreSQL transaction that locks the state row, so a
// revision never commits without its receipt and a 409/412 never commits
// without its durable candidate. Caller identity comes only from Actor.
package reading

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/catalog"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

type Service struct {
	pool *pgxpool.Pool
	q    *sqlcgen.Queries
	cat  *catalog.Service
	now  func() time.Time
}

func New(pool *pgxpool.Pool, cat *catalog.Service, clock func() time.Time) *Service {
	if clock == nil {
		clock = time.Now
	}
	return &Service{pool: pool, q: sqlcgen.New(pool), cat: cat, now: func() time.Time { return clock().UTC().Truncate(time.Microsecond) }}
}

// Actor is the authenticated writer; IDs never come from request bodies.
type Actor struct {
	UserID     uuid.UUID
	SessionID  uuid.UUID
	DeviceName string
}

func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func rfcp(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := rfc(*t)
	return &s
}

func dbErr(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := apperr.As(err); ok {
		return err
	}
	return fmt.Errorf("database: %w", err)
}

func parseRev(s string) (int64, error) {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n < 0 || (len(s) > 1 && s[0] == '0') {
		return 0, apperr.Validation("baseRevision must be a nonnegative decimal string")
	}
	return n, nil
}

func parseUUID(field, s string) (uuid.UUID, error) {
	id, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil, apperr.Validation(field + " must be a UUID")
	}
	return id, nil
}

func parseTime(field, s string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return time.Time{}, apperr.Validation(field + " must be an RFC 3339 timestamp")
	}
	return t.UTC(), nil
}

// fingerprint binds method, resource identity and the semantic request.
func fingerprint(method, resource string, payload any) []byte {
	b, _ := json.Marshal(struct {
		M string `json:"m"`
		R string `json:"r"`
		P any    `json:"p"`
	}{method, resource, payload})
	h := sha256.Sum256(b)
	return h[:]
}

// ---- receipts ---------------------------------------------------------

type storedProblem struct {
	Status int                        `json:"status"`
	Code   string                     `json:"code"`
	Detail string                     `json:"detail"`
	Extra  map[string]json.RawMessage `json:"extra,omitempty"`
}

func encodeProblem(e *apperr.Error) []byte {
	sp := storedProblem{Status: e.Status, Code: e.Code, Detail: e.Detail, Extra: map[string]json.RawMessage{}}
	for k, v := range e.Extra {
		sp.Extra[k] = wire.Raw(v)
	}
	return wire.Raw(sp)
}

func decodeProblem(b []byte) *apperr.Error {
	var sp storedProblem
	_ = json.Unmarshal(b, &sp)
	e := apperr.New(sp.Status, sp.Code, sp.Detail)
	if len(sp.Extra) > 0 {
		e.Extra = map[string]any{}
		for k, v := range sp.Extra {
			e.Extra[k] = v
		}
	}
	return e
}

func operationReused() *apperr.Error {
	return apperr.New(http.StatusConflict, "operation_id_reused", "That operation ID was already used for a different request.")
}

// work runs inside the transaction after the state row is locked and the
// receipt check passed. It returns a success body, a durable problem
// (persisted as the receipt; the transaction commits) or an error (rolled
// back, no receipt).
type work func(q *sqlcgen.Queries) (body []byte, durable *apperr.Error, err error)

// run executes one mutation with per-user idempotent-receipt semantics.
func (s *Service) run(ctx context.Context, a Actor, op uuid.UUID, fp []byte,
	lock func(q *sqlcgen.Queries) error, w work) ([]byte, error) {
	var replay *sqlcgen.T005Receipt
	var body []byte
	var durable *apperr.Error

	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		replay, body, durable = nil, nil, nil
		q := s.q.WithTx(tx)
		if err := lock(q); err != nil {
			return err
		}
		r, err := q.GetT005Receipt(ctx, sqlcgen.GetT005ReceiptParams{UserID: a.UserID, OperationID: op})
		if err == nil {
			replay = &r
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		b, d, err := w(q)
		if err != nil {
			return err
		}
		status, rbody := http.StatusOK, b
		if d != nil {
			status, rbody = d.Status, encodeProblem(d)
		}
		if err := q.InsertT005Receipt(ctx, sqlcgen.InsertT005ReceiptParams{UserID: a.UserID, OperationID: op, Fingerprint: fp,
			Status: int32(status), Body: rbody}); err != nil {
			return err
		}
		body, durable = b, d
		return nil
	})
	if err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23505" {
			return nil, operationReused() // a concurrent request claimed the same operation ID
		}
		return nil, dbErr(err)
	}
	if replay != nil {
		if !bytes.Equal(replay.Fingerprint, fp) {
			return nil, operationReused()
		}
		if replay.Status != http.StatusOK {
			return nil, decodeProblem(replay.Body)
		}
		return replay.Body, nil
	}
	if durable != nil {
		return nil, durable
	}
	return body, nil
}

// ---- reads --------------------------------------------------------------

func (s *Service) GetPosition(ctx context.Context, userID, editionID uuid.UUID) (wire.T005PositionState, error) {
	if _, err := s.cat.AuthorizeEdition(ctx, userID, editionID); err != nil {
		return wire.T005PositionState{}, err
	}
	return s.cat.PositionState(ctx, userID, editionID)
}

func (s *Service) GetCompletion(ctx context.Context, userID, editionID uuid.UUID) (wire.T005Completion, error) {
	if _, err := s.cat.AuthorizeEdition(ctx, userID, editionID); err != nil {
		return wire.T005Completion{}, err
	}
	return s.cat.CompletionState(ctx, userID, editionID)
}

// History lists the caller own manual finish/unfinish events for a title's
// editions in granted libraries, in receive order. Recording history is separate.
func (s *Service) History(ctx context.Context, userID, titleID uuid.UUID, page, size int) (wire.T005History, error) {
	if err := s.cat.TitleVisible(ctx, userID, titleID); err != nil {
		return wire.T005History{}, err
	}
	rows, err := s.q.ListEditionHistory(ctx, sqlcgen.ListEditionHistoryParams{UserID: userID, TitleID: titleID, Limit: int32(size), Offset: int32(page * size)})
	if err != nil {
		return wire.T005History{}, dbErr(err)
	}
	total, err := s.q.CountEditionHistory(ctx, sqlcgen.CountEditionHistoryParams{UserID: userID, TitleID: titleID})
	if err != nil {
		return wire.T005History{}, dbErr(err)
	}
	out := wire.T005History{Items: []wire.T005HistoryEntry{}, Total: total, Page: int64(page), Size: int64(size)}
	for _, r := range rows {
		out.Items = append(out.Items, wire.T005HistoryEntry{ID: r.ID.String(), EditionID: r.EditionID.String(), TitleID: r.TitleID.String(),
			FileID: r.FileID.String(), ContentVersion: r.ContentVersion.String(), Event: r.Event, CapturedAt: rfc(r.CapturedAt), ReceivedAt: rfc(r.ReceivedAt)})
	}
	return out, nil
}
