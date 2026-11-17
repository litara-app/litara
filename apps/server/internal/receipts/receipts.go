// Package receipts runs T006 management mutations under the authenticated
// user's existing cross-operation namespace (t005_receipts: user + operation
// ID), so an operation UUID cannot be reused across T003/T005/T006 resources.
// A durable problem is persisted as the receipt and replayed. Receipts are
// never pruned automatically (contracts/t006/README.md).
package receipts

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Runner executes receipt-guarded transactions.
type Runner struct {
	Pool *pgxpool.Pool
	Q    *sqlcgen.Queries
}

func New(pool *pgxpool.Pool) *Runner { return &Runner{Pool: pool, Q: sqlcgen.New(pool)} }

// Fingerprint binds method, resource identity and the normalized request.
func Fingerprint(method, resource string, payload any) []byte {
	b, _ := json.Marshal(struct {
		M string `json:"m"`
		R string `json:"r"`
		P any    `json:"p"`
	}{method, resource, payload})
	h := sha256.Sum256(b)
	return h[:]
}

// SecretDigest is a keyed deterministic digest for a supplied secret field. The
// receipt never contains the plaintext, and without the server key the digest
// cannot be used to test guesses.
func SecretDigest(key []byte, secret string) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte("litara-t006-receipt-secret-v1"))
	m.Write([]byte(secret))
	return hex.EncodeToString(m.Sum(nil))
}

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

// OperationReused is the 409 for a changed semantic payload.
func OperationReused() *apperr.Error {
	return apperr.New(http.StatusConflict, "operation_id_reused", "That operation ID was already used for a different request.")
}

// Work runs inside the transaction after the optional lock and the receipt
// lookup. It returns the success status and body, a durable problem (stored as
// the receipt; the transaction commits) or an error (rolled back; no receipt).
type Work func(tx pgx.Tx, q *sqlcgen.Queries) (status int, body []byte, durable *apperr.Error, err error)

// Run executes w once per (user, operation). Identical retries replay the
// original status and body; a different fingerprint is operation_id_reused.
func (r *Runner) Run(ctx context.Context, userID, op uuid.UUID, fp []byte,
	lock func(tx pgx.Tx, q *sqlcgen.Queries) error, w Work) (int, []byte, error) {
	// Two identical requests can race to insert the same receipt. The loser's insert fails only after the winner
	// commits, so one more pass finds that receipt: identical retries replay it, a different payload is reused.
	for attempt := 0; ; attempt++ {
		status, body, err, lost := r.run(ctx, userID, op, fp, lock, w)
		if !lost || attempt >= 2 {
			if lost {
				return 0, nil, OperationReused()
			}
			return status, body, err
		}
	}
}

func (r *Runner) run(ctx context.Context, userID, op uuid.UUID, fp []byte,
	lock func(tx pgx.Tx, q *sqlcgen.Queries) error, w Work) (status int, body []byte, err error, lost bool) {
	var replay *sqlcgen.T005Receipt
	var durable *apperr.Error

	err = pgx.BeginFunc(ctx, r.Pool, func(tx pgx.Tx) error {
		replay, status, body, durable = nil, 0, nil, nil
		q := r.Q.WithTx(tx)
		if lock != nil {
			if err := lock(tx, q); err != nil {
				return err
			}
		}
		rc, err := q.GetT005Receipt(ctx, sqlcgen.GetT005ReceiptParams{UserID: userID, OperationID: op})
		if err == nil {
			replay = &rc
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		st, b, d, err := w(tx, q)
		if err != nil {
			return err
		}
		stored, sbody := st, b
		if d != nil {
			stored, sbody = d.Status, encodeProblem(d)
		}
		if err := q.InsertT005Receipt(ctx, sqlcgen.InsertT005ReceiptParams{UserID: userID, OperationID: op, Fingerprint: fp,
			Status: int32(stored), Body: sbody}); err != nil {
			return err
		}
		status, body, durable = st, b, d
		return nil
	})
	if err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23505" && pe.ConstraintName == "t005_receipts_pkey" {
			return 0, nil, nil, true // a concurrent request claimed this operation ID
		}
		if _, ok := apperr.As(err); ok {
			return 0, nil, err, false
		}
		return 0, nil, fmt.Errorf("database: %w", err), false
	}
	if replay != nil {
		if !bytes.Equal(replay.Fingerprint, fp) {
			return 0, nil, OperationReused(), false
		}
		if replay.Status >= 400 {
			return 0, nil, decodeProblem(replay.Body), false
		}
		return int(replay.Status), replay.Body, nil, false
	}
	if durable != nil {
		return 0, nil, durable, false
	}
	return status, body, nil, false
}
