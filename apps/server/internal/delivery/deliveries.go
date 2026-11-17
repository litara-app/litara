package delivery

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/media"
	"github.com/deranjer/ebooker/apps/server/internal/receipts"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

func nullUUID(id *uuid.UUID) uuid.NullUUID {
	if id == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *id, Valid: true}
}

func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func deliveryView(d sqlcgen.Delivery) wire.T006Delivery {
	out := wire.T006Delivery{ID: d.ID.String(), Revision: rev(d.Revision), FileID: d.FileID.String(), ContentVersion: d.ContentVersion.String(),
		RecipientID: d.RecipientID.String(), RecipientName: d.RecipientName, RecipientAddress: d.RecipientAddress, Transport: d.Transport,
		State: d.State, Attempts: int(d.Attempts), CreatedAt: rfc(d.CreatedAt), UpdatedAt: rfc(d.UpdatedAt), Code: d.Code}
	if d.ResendOf.Valid {
		s := d.ResendOf.UUID.String()
		out.ResendOf = &s
	}
	return out
}

func (s *Service) configFor(ctx context.Context, q *sqlcgen.Queries, transport string, userID uuid.UUID) (sqlcgen.SmtpConfig, Owner, bool, error) {
	o := Owner{}
	if transport == "personal" {
		o = Owner{Personal: true, User: userID}
	}
	row, found, err := s.load(ctx, q, o, false)
	return row, o, found, err
}

// Create records an explicit, immutable send intent. The delivery row, its
// operation receipt and the job are written in one transaction, so an identical
// API retry returns the same delivery and never a second job.
func (s *Service) Create(ctx context.Context, userID uuid.UUID, in wire.T006DeliveryCreate) (wire.T006Delivery, error) {
	op, err := parseOp(in.OperationID)
	if err != nil {
		return wire.T006Delivery{}, err
	}
	fileID, e1 := uuid.Parse(in.FileID)
	version, e2 := uuid.Parse(in.ContentVersion)
	recipientID, e3 := uuid.Parse(in.RecipientID)
	if e1 != nil || e2 != nil || e3 != nil || (in.Transport != "server" && in.Transport != "personal") {
		return wire.T006Delivery{}, apperr.Validation("fileId, contentVersion, recipientId and transport must be valid")
	}
	recRev, err := parseRev("recipientRevision", in.RecipientRevision)
	if err != nil {
		return wire.T006Delivery{}, err
	}
	trRev, err := parseRev("transportRevision", in.TransportRevision)
	if err != nil {
		return wire.T006Delivery{}, err
	}
	var resendOf uuid.NullUUID
	if in.ResendOf != nil {
		id, err := uuid.Parse(*in.ResendOf)
		if err != nil {
			return wire.T006Delivery{}, apperr.Validation("resendOf must be a UUID")
		}
		if !in.AcknowledgePossibleDuplicate {
			return wire.T006Delivery{}, apperr.New(http.StatusUnprocessableEntity, "duplicate_acknowledgement_required",
				"Resending may deliver a duplicate; acknowledge that explicitly.")
		}
		resendOf = uuid.NullUUID{UUID: id, Valid: true}
	}
	fp := receipts.Fingerprint("POST", "deliveries", map[string]any{"f": fileID, "v": version, "r": recipientID, "rr": recRev, "t": in.Transport,
		"tr": trRev, "x": resendOf, "a": in.AcknowledgePossibleDuplicate})
	lock := func(_ pgx.Tx, q *sqlcgen.Queries) error { _, err := q.LockUserRow(ctx, userID); return err }
	st, body, err := s.rc.Run(ctx, userID, op, fp, lock, func(tx pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
		if err := s.integ.Enabled(ctx, "email"); err != nil {
			return 0, nil, nil, err
		}
		settings, err := s.integ.Current(ctx)
		if err != nil {
			return 0, nil, nil, err
		}
		target, err := s.cat.ResolveOriginal(ctx, userID, fileID, version)
		if err != nil {
			return 0, nil, nil, err
		}
		if target.Size > settings.MaxAttachmentBytes {
			return 0, nil, nil, apperr.New(http.StatusUnprocessableEntity, "attachment_too_large", "The file exceeds the attachment limit.")
		}
		rec, err := q.GetOwnRecipientForUpdate(ctx, sqlcgen.GetOwnRecipientForUpdateParams{ID: recipientID, UserID: userID})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && rec.Deleted) {
			return 0, nil, nil, apperr.ErrNotFound
		}
		if err != nil {
			return 0, nil, nil, err
		}
		if rec.Revision != recRev {
			return 0, nil, nil, stale(rec.Revision)
		}
		cfg, _, found, err := s.configFor(ctx, q, in.Transport, userID)
		if err != nil {
			return 0, nil, nil, err
		}
		if !found || cfg.Revision == 0 {
			return 0, nil, nil, apperr.New(http.StatusConflict, "transport_unavailable", "That transport is not configured.")
		}
		if cfg.Revision != trRev {
			return 0, nil, nil, stale(cfg.Revision)
		}
		if cfg.Ciphertext != nil && !s.ring().Has(derefStr(cfg.KeyID)) {
			return 0, nil, nil, unavailable("The SMTP encryption key is unavailable.")
		}
		if !s.usable(cfg, found) {
			return 0, nil, nil, apperr.New(http.StatusConflict, "transport_unavailable", "That transport is not enabled.")
		}
		if resendOf.Valid {
			if _, err := q.GetOwnDelivery(ctx, sqlcgen.GetOwnDeliveryParams{ID: resendOf.UUID, UserID: userID}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return 0, nil, nil, apperr.ErrNotFound
				}
				return 0, nil, nil, err
			}
		}
		now := s.now()
		recent, err := q.CountRecentDeliveries(ctx, sqlcgen.CountRecentDeliveriesParams{UserID: userID, CreatedAt: now.Add(-time.Hour)})
		if err != nil {
			return 0, nil, nil, err
		}
		if recent >= int64(settings.MaxPerHour) {
			e := apperr.New(http.StatusTooManyRequests, "rate_limited", "The hourly delivery limit was reached.")
			e.RetryAfterSeconds = 60
			return 0, nil, nil, e
		}
		d, err := q.InsertDelivery(ctx, sqlcgen.InsertDeliveryParams{UserID: userID, FileID: fileID, ContentVersion: version, RecipientID: recipientID,
			RecipientRevision: rec.Revision, RecipientName: rec.Name, RecipientAddress: rec.Address, Transport: in.Transport,
			TransportRevision: cfg.Revision, ResendOf: resendOf, NextAttemptAt: now})
		if err != nil {
			return 0, nil, nil, err
		}
		if err := s.sched.Schedule(ctx, tx, d.ID, now); err != nil {
			return 0, nil, nil, err
		}
		return http.StatusAccepted, wire.Raw(deliveryView(d)), nil, nil
	})
	if err != nil {
		return wire.T006Delivery{}, err
	}
	_ = st
	var out wire.T006Delivery
	return out, json.Unmarshal(body, &out)
}

// List pages the caller's own deliveries, newest first.
func (s *Service) List(ctx context.Context, userID uuid.UUID, page, size int) (wire.T006DeliveryList, error) {
	rows, err := s.q.ListDeliveries(ctx, sqlcgen.ListDeliveriesParams{UserID: userID, Limit: int32(size), Offset: int32(page * size)})
	if err != nil {
		return wire.T006DeliveryList{}, err
	}
	total, err := s.q.CountDeliveries(ctx, userID)
	if err != nil {
		return wire.T006DeliveryList{}, err
	}
	out := wire.T006DeliveryList{Items: []wire.T006Delivery{}, Page: page, Size: size, Total: total}
	for _, r := range rows {
		out.Items = append(out.Items, deliveryView(r))
	}
	return out, nil
}

// Get returns one delivery; another account's ID is 404.
func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (wire.T006Delivery, error) {
	d, err := s.q.GetOwnDelivery(ctx, sqlcgen.GetOwnDeliveryParams{ID: id, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return wire.T006Delivery{}, apperr.ErrNotFound
	}
	if err != nil {
		return wire.T006Delivery{}, err
	}
	return deliveryView(d), nil
}

// Cancel withdraws a request that has not started submission. It races the
// worker's claim on the same row lock, so exactly one of them wins.
func (s *Service) Cancel(ctx context.Context, userID, id uuid.UUID, in wire.T006Mutation) (wire.T006Delivery, error) {
	op, err := parseOp(in.OperationID)
	if err != nil {
		return wire.T006Delivery{}, err
	}
	base, err := parseRev("baseRevision", in.BaseRevision)
	if err != nil {
		return wire.T006Delivery{}, err
	}
	fp := receipts.Fingerprint("POST", "deliveries/"+id.String()+"/cancel", map[string]any{"b": base})
	_, body, err := s.rc.Run(ctx, userID, op, fp, nil, func(_ pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
		d, err := q.GetOwnDeliveryForUpdate(ctx, sqlcgen.GetOwnDeliveryForUpdateParams{ID: id, UserID: userID})
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil, apperr.ErrNotFound, nil
		}
		if err != nil {
			return 0, nil, nil, err
		}
		if d.State != "queued" && d.State != "retry_wait" {
			return 0, nil, apperr.New(http.StatusConflict, "delivery_not_cancellable", "Only a request that has not started submission can be cancelled.").With("currentRevision", rev(d.Revision)), nil
		}
		if d.Revision != base {
			return 0, nil, stale(d.Revision), nil
		}
		code := "cancelled_by_owner"
		u, err := q.SetDeliveryState(ctx, sqlcgen.SetDeliveryStateParams{ID: id, State: "cancelled", Code: &code, Attempts: d.Attempts,
			AttemptOpen: false, NextAttemptAt: d.NextAttemptAt, UpdatedAt: s.now()})
		if err != nil {
			return 0, nil, nil, err
		}
		return http.StatusOK, wire.Raw(deliveryView(u)), nil, nil
	})
	if err != nil {
		return wire.T006Delivery{}, err
	}
	var out wire.T006Delivery
	return out, json.Unmarshal(body, &out)
}

// ---- worker ----------------------------------------------------------------

func (s *Service) finish(ctx context.Context, tx pgx.Tx, id uuid.UUID, state, code string, attempts int32, next time.Time) error {
	q := s.q.WithTx(tx)
	_, err := q.SetDeliveryState(ctx, sqlcgen.SetDeliveryStateParams{ID: id, State: state, Code: &code, Attempts: attempts, AttemptOpen: false,
		NextAttemptAt: next, UpdatedAt: s.now()})
	return err
}

// terminal moves a delivery to a final state in its own transaction.
func (s *Service) terminal(ctx context.Context, id uuid.UUID, state, code string, attempts int32) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := s.q.WithTx(tx).GetDeliveryForUpdate(ctx, id); err != nil {
			return err
		}
		return s.finish(ctx, tx, id, state, code, attempts, s.now())
	})
}

// Process runs one submission attempt. It is safe to call repeatedly: it claims
// the attempt under a row lock, never resubmits a delivery whose earlier attempt
// reached the DATA boundary, and recovers a crashed attempt as outcome_unknown.
func (s *Service) Process(ctx context.Context, id uuid.UUID) error {
	var d sqlcgen.Delivery
	claimed := false
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		cur, err := q.GetDeliveryForUpdate(ctx, id)
		if err != nil {
			return err
		}
		now := s.now()
		switch cur.State {
		case "queued", "retry_wait":
			if now.Before(cur.NextAttemptAt) {
				return s.sched.Schedule(ctx, tx, id, cur.NextAttemptAt) // woken early: run again when due
			}
			lease := now.Add(s.net.sendTimeout() + 30*time.Second)
			u, err := q.SetDeliveryStateSending(ctx, sqlcgen.SetDeliveryStateSendingParams{ID: id, UpdatedAt: now, LeaseUntil: &lease})
			if err != nil {
				return err
			}
			d, claimed = u, true
		case "sending":
			// A live attempt holds its lease: leave it alone and look again when the lease ends.
			if cur.LeaseUntil != nil && now.Before(*cur.LeaseUntil) {
				return s.sched.Schedule(ctx, tx, id, *cur.LeaseUntil)
			}
			// The lease expired without an outcome: the worker crashed and the message may or may not have been submitted.
			return s.finish(ctx, tx, id, "outcome_unknown", "attempt_interrupted", cur.Attempts, now)
		}
		return nil
	})
	if err != nil || !claimed {
		return err
	}
	fail := func(code string) error { return s.terminal(ctx, id, "failed", code, d.Attempts) }

	// Recheck everything that could have changed since the intent was queued.
	if active, err := s.q.GetUserActive(ctx, d.UserID); err != nil || !active {
		return fail("account_disabled")
	}
	if err := s.integ.Enabled(ctx, "email"); err != nil {
		return fail("integration_disabled")
	}
	settings, err := s.integ.Current(ctx)
	if err != nil {
		return s.retryable(ctx, d, "settings_unavailable")
	}
	target, err := s.cat.ResolveOriginal(ctx, d.UserID, d.FileID, d.ContentVersion)
	if err != nil {
		var ae *apperr.Error
		if errors.As(err, &ae) && ae.Status == http.StatusPreconditionFailed {
			return fail("content_changed")
		}
		if errors.As(err, &ae) && (ae.Status == http.StatusForbidden || ae.Status == http.StatusNotFound) {
			return fail("access_revoked")
		}
		return fail("file_unavailable")
	}
	if target.Size > settings.MaxAttachmentBytes {
		return fail("attachment_too_large")
	}
	rec, err := s.q.GetRecipientAny(ctx, d.RecipientID)
	if err != nil || rec.UserID != d.UserID || rec.Deleted || rec.Revision != d.RecipientRevision {
		return fail("recipient_changed")
	}
	row, o, found, err := s.configFor(ctx, s.q, d.Transport, d.UserID)
	if err != nil || !found || row.Revision != d.TransportRevision || !row.Enabled {
		return fail("transport_changed")
	}
	cfg, err := s.open(row, o)
	if err != nil {
		return fail("configuration_unavailable") // missing or wrong key: stored data is left untouched
	}
	f, err := media.Open(s.root, target.Locator, target.Size)
	if err != nil {
		return fail("file_unavailable")
	}
	defer f.Close()

	msg := &Message{From: mail.Address{Address: cfg.From}, To: mail.Address{Name: d.RecipientName, Address: d.RecipientAddress},
		Filename: SafeFilename(target.Filename), MIME: target.MIME, Body: f, Date: s.now(),
		MessageID: uuid.NewString() + "@litara.invalid", Boundary: "litara-" + uuid.NewString()}
	boundary := func() error {
		_, err := s.q.MarkSubmissionBoundary(ctx, id)
		return err
	}
	res := s.net.Send(ctx, cfg, o.Personal, msg.To, msg, boundary, s.hooks)
	if res == nil {
		return s.terminal(ctx, id, "accepted", "smtp_accepted", d.Attempts)
	}
	switch res.Kind {
	case KindTransient:
		return s.retryable(ctx, d, res.Code)
	case KindPermanent:
		return fail(res.Code)
	default:
		if res.Code == "attempt_interrupted" {
			return nil // simulated crash: leave the claimed attempt for recovery
		}
		return s.terminal(ctx, id, "outcome_unknown", res.Code, d.Attempts)
	}
}

// retryable schedules a bounded retry for a failure proven to precede the
// submission boundary (delays 5 s then 30 s, at most MaxAttempts attempts).
func (s *Service) retryable(ctx context.Context, d sqlcgen.Delivery, code string) error {
	if int(d.Attempts) >= MaxAttempts {
		return s.terminal(ctx, d.ID, "failed", "retries_exhausted:"+code, d.Attempts)
	}
	next := s.now().Add(retryDelays[d.Attempts-1])
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := s.q.WithTx(tx).GetDeliveryForUpdate(ctx, d.ID); err != nil {
			return err
		}
		if err := s.finish(ctx, tx, d.ID, "retry_wait", code, d.Attempts, next); err != nil {
			return err
		}
		return s.sched.Schedule(ctx, tx, d.ID, next)
	})
}

// recoverGrace is how long a due request may wait for its own job before the sweep takes it over.
const recoverGrace = time.Minute

// Recover re-drives deliveries whose durable job was lost (a discarded or rescued job, a crash between the queued row
// and its job, a failure before the claim). Process is idempotent and runs under the delivery row lock, so a live job
// and the sweep cannot both submit: an expired "sending" lease becomes outcome_unknown, never a resubmission.
func (s *Service) Recover(ctx context.Context, limit int) (int, error) {
	now := s.now()
	ids, err := s.q.ListStuckDeliveries(ctx, sqlcgen.ListStuckDeliveriesParams{DueBefore: now.Add(-recoverGrace), Now: &now, Lim: int32(limit)})
	if err != nil {
		return 0, err
	}
	n := 0
	for _, id := range ids {
		if err := s.Process(ctx, id); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}
