package koreader

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
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
	"github.com/deranjer/ebooker/apps/server/internal/integrations"
	"github.com/deranjer/ebooker/apps/server/internal/receipts"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// WireError is the stock-protocol failure envelope: a numeric code and a
// bounded message. It never carries private IDs, paths or book text.
type WireError struct {
	HTTP    int    `json:"-"`
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *WireError) Error() string { return strconv.Itoa(e.Code) + " " + e.Message }

// Protocol codes from contracts/t006/README.md.
var (
	ErrUnauthorized  = &WireError{http.StatusUnauthorized, 2001, "Unauthorized"}
	ErrInvalidFields = &WireError{http.StatusBadRequest, 2003, "Invalid request fields"}
	ErrBadDigest     = &WireError{http.StatusBadRequest, 2004, "Invalid or missing document"}
	ErrRegistration  = &WireError{http.StatusForbidden, 2005, "User registration is disabled"}
	ErrNoDocument    = &WireError{http.StatusNotFound, 2006, "Document not available"}
	ErrRetained      = &WireError{http.StatusConflict, 2007, "Progress was retained for review in Litara"}
	ErrChanged       = &WireError{http.StatusPreconditionFailed, 2008, "The document content changed"}
	ErrUnavailable   = &WireError{http.StatusServiceUnavailable, 2009, "Service unavailable"}
	ErrRateLimited   = &WireError{http.StatusTooManyRequests, 2010, "Too many requests"}
)

// Service owns the KOReader source, baselines, receipts and conflicts.
type Service struct {
	pool *pgxpool.Pool
	q    *sqlcgen.Queries
	rc   *receipts.Runner
	cat  *catalog.Service
	now  func() time.Time
}

func New(pool *pgxpool.Pool, cat *catalog.Service, clock func() time.Time) *Service {
	if clock == nil {
		clock = time.Now
	}
	return &Service{pool: pool, q: sqlcgen.New(pool), rc: receipts.New(pool), cat: cat, now: func() time.Time { return clock().UTC() }}
}

// ---- wire bodies -----------------------------------------------------------

// PutIn is the validated upstream PUT body. Metadata is deliberately absent:
// supplied filenames and titles never select a file or alter the catalog.
type PutIn struct {
	Document   string  `json:"document"`
	Progress   string  `json:"progress"`
	Percentage float64 `json:"percentage"`
	Device     string  `json:"device"`
	DeviceID   *string `json:"device_id,omitempty"`
}

// ProgressBody is a returned position envelope.
type ProgressBody struct {
	Document   string  `json:"document"`
	Progress   string  `json:"progress"`
	Percentage float64 `json:"percentage"`
	Device     string  `json:"device"`
	DeviceID   *string `json:"device_id,omitempty"`
	Timestamp  int64   `json:"timestamp"`
}

// Accepted is the PUT success body.
type Accepted struct {
	Document  string `json:"document"`
	Timestamp int64  `json:"timestamp"`
}

func isDigest(s string) bool {
	if len(s) != 32 {
		return false
	}
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// Validate applies the contract bounds.
func (in PutIn) Validate() *WireError {
	if !isDigest(in.Document) {
		return ErrBadDigest
	}
	if n := len(in.Progress); n < 1 || n > 8192 || in.Percentage < 0 || in.Percentage > 1 || in.Percentage != in.Percentage {
		return ErrInvalidFields
	}
	if n := len(in.Device); n < 1 || n > 256 {
		return ErrInvalidFields
	}
	if in.DeviceID != nil {
		if n := len(*in.DeviceID); n < 1 || n > 256 {
			return ErrInvalidFields
		}
	}
	return nil
}

func fingerprint(cred, file, ver uuid.UUID, in PutIn) []byte {
	b, _ := json.Marshal([]any{cred, file, ver, in.Document, in.Progress, strconv.FormatFloat(in.Percentage, 'g', -1, 64), in.Device, in.DeviceID})
	h := sha256.Sum256(b)
	return h[:]
}

// ---- target lookup ---------------------------------------------------------

type target struct {
	edition, file, version uuid.UUID
	superseded             bool // a binding names a version that is no longer current
}

// resolve selects the exact file version for a digest. Candidates are joined to
// the caller's grants first; a unique match is implicit, several need a
// per-credential binding, and none is the same 404 as an inaccessible file.
func (s *Service) resolve(ctx context.Context, q *sqlcgen.Queries, cred *integrations.Protocol, doc string) (target, error) {
	b, err := q.GetActiveBinding(ctx, sqlcgen.GetActiveBindingParams{CredentialID: cred.CredentialID, Document: doc})
	if err == nil {
		ed, err := q.FileCurrentGranted(ctx, sqlcgen.FileCurrentGrantedParams{UserID: cred.UserID, FileID: b.FileID, ContentVersion: b.ContentVersion})
		if err == nil {
			return target{edition: ed, file: b.FileID, version: b.ContentVersion}, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return target{}, err
		}
		cur, cerr := q.CurrentVersionOf(ctx, b.FileID)
		if cerr == nil && cur != b.ContentVersion {
			if _, gerr := q.FileCurrentGranted(ctx, sqlcgen.FileCurrentGrantedParams{UserID: cred.UserID, FileID: b.FileID, ContentVersion: cur}); gerr == nil {
				return target{file: b.FileID, version: b.ContentVersion, superseded: true}, nil
			}
		}
		return target{}, ErrNoDocument
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return target{}, err
	}
	cands, err := q.ListDigestCandidates(ctx, sqlcgen.ListDigestCandidatesParams{UserID: cred.UserID, Digest: doc})
	if err != nil {
		return target{}, err
	}
	if len(cands) != 1 {
		return target{}, ErrNoDocument // missing, ambiguous or inaccessible: one envelope
	}
	return target{edition: cands[0].EditionID, file: cands[0].FileID, version: cands[0].ContentVersion}, nil
}

func isUniqueViolation(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

func asWire(err error) error {
	if err == nil {
		return nil
	}
	var we *WireError
	if errors.As(err, &we) {
		return err
	}
	return err
}

// ---- GET -------------------------------------------------------------------

// GetProgress implements the read half. It never advances an existing stale
// baseline: only an empty source (baseline zero) or an explicit owner
// resolution (adoptable == current revision) lets a read adopt a baseline.
func (s *Service) GetProgress(ctx context.Context, cred *integrations.Protocol, doc string) (*ProgressBody, error) {
	if !isDigest(doc) {
		return nil, ErrBadDigest
	}
	var out *ProgressBody
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		t, err := s.resolve(ctx, q, cred, doc)
		if err != nil {
			return err
		}
		if t.superseded {
			return ErrChanged
		}
		if err := q.EnsureSource(ctx, sqlcgen.EnsureSourceParams{UserID: cred.UserID, FileID: t.file, ContentVersion: t.version}); err != nil {
			return err
		}
		src, err := q.LockSource(ctx, sqlcgen.LockSourceParams{UserID: cred.UserID, FileID: t.file, ContentVersion: t.version})
		if err != nil {
			return err
		}
		base, berr := q.GetBaseline(ctx, sqlcgen.GetBaselineParams{CredentialID: cred.CredentialID, FileID: t.file, ContentVersion: t.version})
		hasBase := berr == nil
		if berr != nil && !errors.Is(berr, pgx.ErrNoRows) {
			return berr
		}
		set := func(rev int64) error {
			return q.SetBaseline(ctx, sqlcgen.SetBaselineParams{CredentialID: cred.CredentialID, FileID: t.file, ContentVersion: t.version, Revision: &rev})
		}
		if src.Revision == 0 {
			if !hasBase || base.Revision == nil {
				return set(0)
			}
			return nil
		}
		if hasBase && base.Adoptable != nil && *base.Adoptable == src.Revision {
			if err := set(src.Revision); err != nil {
				return err
			}
		}
		out = &ProgressBody{Document: derefStr(src.Document), Progress: derefStr(src.Progress), Percentage: derefF(src.Percentage),
			Device: derefStr(src.Device), DeviceID: src.DeviceID, Timestamp: derefI(src.AcceptedTs)}
		return nil
	})
	if err != nil {
		return nil, asWire(err)
	}
	return out, nil
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
func derefF(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}
func derefI(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

// ---- PUT -------------------------------------------------------------------

type putOutcome struct {
	ok  *Accepted
	err *WireError
}

// PutProgress applies the conservative adapter. A refusal commits its retained
// candidate and immutable receipt (so it is never lost to a rollback) and then
// reports 409/412; canonical source state changes only on an accepted write.
func (s *Service) PutProgress(ctx context.Context, cred *integrations.Protocol, in PutIn) (*Accepted, error) {
	if werr := in.Validate(); werr != nil {
		return nil, werr
	}
	var res putOutcome
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		res = putOutcome{}
		q := s.q.WithTx(tx)
		t, err := s.resolve(ctx, q, cred, in.Document)
		if err != nil {
			return err
		}
		if err := q.EnsureSource(ctx, sqlcgen.EnsureSourceParams{UserID: cred.UserID, FileID: t.file, ContentVersion: t.version}); err != nil {
			return err
		}
		src, err := q.LockSource(ctx, sqlcgen.LockSourceParams{UserID: cred.UserID, FileID: t.file, ContentVersion: t.version})
		if err != nil {
			return err
		}
		fp := fingerprint(cred.CredentialID, t.file, t.version, in)
		refuse := func(reason string, w *WireError) error {
			c, err := q.InsertKoConflict(ctx, sqlcgen.InsertKoConflictParams{UserID: cred.UserID, CredentialID: cred.CredentialID, FileID: t.file,
				ContentVersion: t.version, Reason: reason, Fingerprint: fp, Document: in.Document, Progress: in.Progress, Percentage: in.Percentage,
				Device: in.Device, DeviceID: in.DeviceID, CreatedSourceRevision: src.Revision})
			if err != nil {
				return err
			}
			code := int32(w.Code)
			if err := q.InsertKoReceipt(ctx, sqlcgen.InsertKoReceiptParams{CredentialID: cred.CredentialID, FileID: t.file, ContentVersion: t.version,
				Fingerprint: fp, Accepted: false, WireStatus: int32(w.HTTP), WireCode: &code, ConflictID: uuid.NullUUID{UUID: c.ID, Valid: true}}); err != nil {
				return err
			}
			res.err = w
			return nil
		}
		if t.superseded {
			return refuse("content_changed", ErrChanged)
		}
		// Re-check the exact version under the lock: a replacement may have landed since the lookup.
		if _, err := q.FileCurrentGranted(ctx, sqlcgen.FileCurrentGrantedParams{UserID: cred.UserID, FileID: t.file, ContentVersion: t.version}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrChanged
			}
			return err
		}
		if rc, err := q.GetKoReceipt(ctx, sqlcgen.GetKoReceiptParams{CredentialID: cred.CredentialID, FileID: t.file, ContentVersion: t.version, Fingerprint: fp}); err == nil {
			if rc.Accepted {
				if rc.SourceRevision != nil && *rc.SourceRevision == src.Revision {
					res.ok = &Accepted{Document: in.Document, Timestamp: derefI(rc.AcceptedTs)}
					return nil
				}
				// The accepted place is no longer canonical: retain it rather than claim it is saved.
				return refuse("stale_revision", ErrRetained)
			}
			code := 2007
			if rc.WireCode != nil {
				code = int(*rc.WireCode)
			}
			res.err = &WireError{HTTP: int(rc.WireStatus), Code: code, Message: messageFor(code)}
			return nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		base, berr := q.GetBaseline(ctx, sqlcgen.GetBaselineParams{CredentialID: cred.CredentialID, FileID: t.file, ContentVersion: t.version})
		if berr != nil && !errors.Is(berr, pgx.ErrNoRows) {
			return berr
		}
		unresolved, err := q.HasUnresolvedKoConflict(ctx, sqlcgen.HasUnresolvedKoConflictParams{CredentialID: cred.CredentialID, FileID: t.file, ContentVersion: t.version})
		if err != nil {
			return err
		}
		switch {
		case berr != nil || base.Revision == nil:
			return refuse("baseline_required", ErrRetained)
		case *base.Revision != src.Revision:
			return refuse("stale_revision", ErrRetained)
		case unresolved:
			return refuse("unresolved_candidate", ErrRetained)
		}
		ts := s.now().Unix()
		upd, err := q.SetSource(ctx, sqlcgen.SetSourceParams{UserID: cred.UserID, FileID: t.file, ContentVersion: t.version, Document: &in.Document,
			Progress: &in.Progress, Percentage: &in.Percentage, Device: &in.Device, DeviceID: in.DeviceID, AcceptedTs: &ts})
		if err != nil {
			return err
		}
		rev := upd.Revision
		if err := q.SetBaseline(ctx, sqlcgen.SetBaselineParams{CredentialID: cred.CredentialID, FileID: t.file, ContentVersion: t.version, Revision: &rev}); err != nil {
			return err
		}
		if err := q.InsertKoReceipt(ctx, sqlcgen.InsertKoReceiptParams{CredentialID: cred.CredentialID, FileID: t.file, ContentVersion: t.version,
			Fingerprint: fp, Accepted: true, WireStatus: http.StatusOK, SourceRevision: &rev, AcceptedTs: &ts}); err != nil {
			return err
		}
		res.ok = &Accepted{Document: in.Document, Timestamp: ts}
		return nil
	})
	if err != nil {
		return nil, asWire(err)
	}
	if res.err != nil {
		return nil, res.err
	}
	return res.ok, nil
}

func messageFor(code int) string {
	switch code {
	case 2008:
		return ErrChanged.Message
	default:
		return ErrRetained.Message
	}
}

// ---- management: position, conflicts, bindings ------------------------------

func rev(n int64) string { return strconv.FormatInt(n, 10) }

func positionOf(file, ver uuid.UUID, src sqlcgen.KoreaderSource) wire.T006KoPosition {
	out := wire.T006KoPosition{Revision: rev(src.Revision), FileID: file.String(), ContentVersion: ver.String(), Source: "koreader"}
	if src.Revision > 0 {
		out.Position = wire.Some(&wire.T006KoPositionData{Document: derefStr(src.Document), Progress: derefStr(src.Progress), Percentage: derefF(src.Percentage),
			Device: derefStr(src.Device), DeviceID: src.DeviceID, Timestamp: derefI(src.AcceptedTs)})
	}
	return out
}

// Position reports the separate KOReader source for an edition's current file.
func (s *Service) Position(ctx context.Context, userID, editionID uuid.UUID) (wire.T006KoPosition, error) {
	if _, err := s.cat.AuthorizeEdition(ctx, userID, editionID); err != nil {
		return wire.T006KoPosition{}, err
	}
	cur, err := s.q.GetEditionCurrentFile(ctx, editionID)
	if err != nil {
		return wire.T006KoPosition{}, apperr.ErrNotFound
	}
	src, err := s.q.GetSource(ctx, sqlcgen.GetSourceParams{UserID: userID, FileID: cur.FileID, ContentVersion: cur.ContentVersion})
	if errors.Is(err, pgx.ErrNoRows) {
		src = sqlcgen.KoreaderSource{UserID: userID, FileID: cur.FileID, ContentVersion: cur.ContentVersion}
	} else if err != nil {
		return wire.T006KoPosition{}, err
	}
	return positionOf(cur.FileID, cur.ContentVersion, src), nil
}

func (s *Service) conflictView(ctx context.Context, q *sqlcgen.Queries, c sqlcgen.KoreaderConflict) (wire.T006KoConflict, error) {
	var cur int64
	if src, err := q.GetSource(ctx, sqlcgen.GetSourceParams{UserID: c.UserID, FileID: c.FileID, ContentVersion: c.ContentVersion}); err == nil {
		cur = src.Revision
	}
	return wire.T006KoConflict{ID: c.ID.String(), Revision: rev(c.Revision), FileID: c.FileID.String(), ContentVersion: c.ContentVersion.String(),
		CredentialID: c.CredentialID.String(), Reason: c.Reason, CurrentRevision: rev(cur), Resolved: c.ResolvedAt != nil,
		Candidate: wire.T006KoCandidate{Progress: c.Progress, Percentage: c.Percentage, Device: c.Device, DeviceID: c.DeviceID}}, nil
}

// ListConflicts pages the caller's own retained candidates.
func (s *Service) ListConflicts(ctx context.Context, userID uuid.UUID, page, size int) (wire.T006KoConflictList, error) {
	rows, err := s.q.ListKoConflicts(ctx, sqlcgen.ListKoConflictsParams{UserID: userID, Limit: int32(size), Offset: int32(page * size)})
	if err != nil {
		return wire.T006KoConflictList{}, err
	}
	total, err := s.q.CountKoConflicts(ctx, userID)
	if err != nil {
		return wire.T006KoConflictList{}, err
	}
	out := wire.T006KoConflictList{Items: []wire.T006KoConflict{}, Page: page, Size: size, Total: total}
	for _, r := range rows {
		v, err := s.conflictView(ctx, s.q, r)
		if err != nil {
			return out, err
		}
		out.Items = append(out.Items, v)
	}
	return out, nil
}

func parseRev(field, v string) (int64, error) {
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n < 0 || (len(v) > 1 && v[0] == '0') {
		return 0, apperr.Validation(field + " must be a nonnegative decimal string")
	}
	return n, nil
}

func staleRevision(cur int64) *apperr.Error {
	return apperr.New(http.StatusConflict, "stale_revision", "The KOReader position changed; reload and retry.").With("currentRevision", rev(cur))
}

// Resolve settles a retained candidate against the current source revision.
func (s *Service) Resolve(ctx context.Context, userID, id uuid.UUID, in wire.T006KoResolve) (wire.T006KoPosition, error) {
	if in.Action != "keep_server" && in.Action != "use_candidate" {
		return wire.T006KoPosition{}, apperr.Validation("action must be keep_server or use_candidate")
	}
	return s.settle(ctx, userID, id, in.OperationID, in.BaseRevision, "resolve:"+in.Action, in.Action)
}

// Reapply deliberately applies an already-resolved retained place as a new event.
func (s *Service) Reapply(ctx context.Context, userID, id uuid.UUID, in wire.T006Mutation) (wire.T006KoPosition, error) {
	return s.settle(ctx, userID, id, in.OperationID, in.BaseRevision, "reapply", "reapply")
}

func (s *Service) settle(ctx context.Context, userID, id uuid.UUID, opStr, baseStr, kind, action string) (wire.T006KoPosition, error) {
	op, err := uuid.Parse(opStr)
	if err != nil {
		return wire.T006KoPosition{}, apperr.Validation("operationId must be a UUID")
	}
	base, err := parseRev("baseRevision", baseStr)
	if err != nil {
		return wire.T006KoPosition{}, err
	}
	fp := receipts.Fingerprint("POST", "koreader/conflicts/"+id.String()+"/"+kind, map[string]any{"base": base})
	_, body, err := s.rc.Run(ctx, userID, op, fp, nil, func(tx pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
		// Lock order is source first (as PUT does), then the conflict row: read without a lock here.
		if _, err := q.GetOwnKoConflict(ctx, sqlcgen.GetOwnKoConflictParams{ID: id, UserID: userID}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, nil, apperr.ErrNotFound, nil
			}
			return 0, nil, nil, err
		}
		return s.settleLocked(ctx, q, userID, id, base, action)
	})
	if err != nil {
		return wire.T006KoPosition{}, err
	}
	var out wire.T006KoPosition
	return out, json.Unmarshal(body, &out)
}

func (s *Service) settleLocked(ctx context.Context, q *sqlcgen.Queries, userID, id uuid.UUID, base int64, action string) (int, []byte, *apperr.Error, error) {
	pre, err := q.GetOwnKoConflict(ctx, sqlcgen.GetOwnKoConflictParams{ID: id, UserID: userID})
	if err != nil {
		return 0, nil, nil, err
	}
	if err := q.EnsureSource(ctx, sqlcgen.EnsureSourceParams{UserID: userID, FileID: pre.FileID, ContentVersion: pre.ContentVersion}); err != nil {
		return 0, nil, nil, err
	}
	src, err := q.LockSource(ctx, sqlcgen.LockSourceParams{UserID: userID, FileID: pre.FileID, ContentVersion: pre.ContentVersion})
	if err != nil {
		return 0, nil, nil, err
	}
	c, err := q.GetOwnKoConflictForUpdate(ctx, sqlcgen.GetOwnKoConflictForUpdateParams{ID: id, UserID: userID})
	if err != nil {
		return 0, nil, nil, err
	}
	resolved := c.ResolvedAt != nil
	switch {
	case action == "reapply" && !resolved:
		return 0, nil, apperr.New(http.StatusConflict, "conflict_unresolved", "Resolve the retained candidate before reapplying it.").With("conflictId", c.ID.String()), nil
	case action != "reapply" && resolved:
		return 0, nil, apperr.New(http.StatusConflict, "conflict_resolved", "That retained candidate was already resolved.").With("conflictId", c.ID.String()), nil
	}
	if base != src.Revision {
		return 0, nil, staleRevision(src.Revision), nil
	}
	apply := action == "use_candidate" || action == "reapply"
	if apply {
		if _, err := q.FileCurrentGranted(ctx, sqlcgen.FileCurrentGrantedParams{UserID: userID, FileID: c.FileID, ContentVersion: c.ContentVersion}); err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				return 0, nil, nil, err
			}
			if cur, cerr := q.CurrentVersionOf(ctx, c.FileID); cerr == nil && cur != c.ContentVersion {
				return 0, nil, apperr.New(http.StatusPreconditionFailed, "content_changed", "The file changed; this candidate cannot be applied to new bytes."), nil
			}
			return 0, nil, apperr.ErrAccessDenied, nil
		}
		ts := s.now().Unix()
		upd, err := q.SetSource(ctx, sqlcgen.SetSourceParams{UserID: userID, FileID: c.FileID, ContentVersion: c.ContentVersion, Document: &c.Document,
			Progress: &c.Progress, Percentage: &c.Percentage, Device: &c.Device, DeviceID: c.DeviceID, AcceptedTs: &ts})
		if err != nil {
			return 0, nil, nil, err
		}
		src = upd
	}
	switch action {
	case "reapply":
		if _, err := q.BumpKoConflict(ctx, c.ID); err != nil {
			return 0, nil, nil, err
		}
	default:
		if _, err := q.ResolveKoConflict(ctx, sqlcgen.ResolveKoConflictParams{ID: c.ID, Resolution: &action}); err != nil {
			return 0, nil, nil, err
		}
	}
	// The candidate's device may adopt this exact revision on its next read, and no other.
	if err := q.SetAdoptable(ctx, sqlcgen.SetAdoptableParams{CredentialID: c.CredentialID, FileID: c.FileID, ContentVersion: c.ContentVersion, Adoptable: &src.Revision}); err != nil {
		return 0, nil, nil, err
	}
	return http.StatusOK, wire.Raw(positionOf(c.FileID, c.ContentVersion, src)), nil, nil
}

// ---- bindings ---------------------------------------------------------------

func bindingView(b sqlcgen.KoreaderBinding) wire.T006DigestBinding {
	return wire.T006DigestBinding{ID: b.ID.String(), Revision: rev(b.Revision), CredentialID: b.CredentialID.String(), Document: b.Document,
		FileID: b.FileID.String(), ContentVersion: b.ContentVersion.String(), Deleted: b.Deleted}
}

// ListBindings pages the caller's active bindings.
func (s *Service) ListBindings(ctx context.Context, userID uuid.UUID, page, size int) (wire.T006DigestBindingList, error) {
	rows, err := s.q.ListBindings(ctx, sqlcgen.ListBindingsParams{UserID: userID, Limit: int32(size), Offset: int32(page * size)})
	if err != nil {
		return wire.T006DigestBindingList{}, err
	}
	total, err := s.q.CountBindings(ctx, userID)
	if err != nil {
		return wire.T006DigestBindingList{}, err
	}
	out := wire.T006DigestBindingList{Items: []wire.T006DigestBinding{}, Page: page, Size: size, Total: total}
	for _, r := range rows {
		out.Items = append(out.Items, bindingView(r))
	}
	return out, nil
}

// PutBinding creates (base 0) or retargets a per-credential digest binding.
func (s *Service) PutBinding(ctx context.Context, userID, id uuid.UUID, in wire.T006DigestBindingWrite) (wire.T006DigestBinding, error) {
	op, err := uuid.Parse(in.OperationID)
	if err != nil {
		return wire.T006DigestBinding{}, apperr.Validation("operationId must be a UUID")
	}
	base, err := parseRev("baseRevision", in.BaseRevision)
	if err != nil {
		return wire.T006DigestBinding{}, err
	}
	credID, e1 := uuid.Parse(in.CredentialID)
	fileID, e2 := uuid.Parse(in.FileID)
	ver, e3 := uuid.Parse(in.ContentVersion)
	if e1 != nil || e2 != nil || e3 != nil || !isDigest(in.Document) {
		return wire.T006DigestBinding{}, apperr.Validation("credentialId, fileId, contentVersion and document must be valid")
	}
	fp := receipts.Fingerprint("PUT", "koreader/bindings/"+id.String(), map[string]any{"base": base, "c": credID, "d": in.Document, "f": fileID, "v": ver})
	_, body, err := s.rc.Run(ctx, userID, op, fp, nil, func(tx pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
		cred, err := q.GetOwnCredentialForUpdate(ctx, sqlcgen.GetOwnCredentialForUpdateParams{ID: credID, UserID: userID})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (cred.Kind != integrations.KindKOReader || cred.RevokedAt != nil)) {
			return 0, nil, apperr.ErrNotFound, nil
		}
		if err != nil {
			return 0, nil, nil, err
		}
		if _, err := q.FileCurrentGranted(ctx, sqlcgen.FileCurrentGrantedParams{UserID: userID, FileID: fileID, ContentVersion: ver}); err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				return 0, nil, nil, err
			}
			if cur, cerr := q.CurrentVersionOf(ctx, fileID); cerr == nil && cur != ver {
				return 0, nil, apperr.New(http.StatusPreconditionFailed, "content_changed", "That content version is no longer current."), nil
			}
			return 0, nil, apperr.ErrNotFound, nil
		}
		dg, err := q.GetDigest(ctx, sqlcgen.GetDigestParams{FileID: fileID, ContentVersion: ver})
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil, apperr.New(http.StatusConflict, "digest_not_ready", "The document digest for this file is not indexed yet."), nil
		}
		if err != nil {
			return 0, nil, nil, err
		}
		if dg != in.Document {
			return 0, nil, apperr.Validation("document does not match the indexed digest of that file version"), nil
		}
		existing, err := q.GetBindingAny(ctx, id)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			if base != 0 {
				return 0, nil, staleRevision(0), nil
			}
			b, err := q.InsertBinding(ctx, sqlcgen.InsertBindingParams{ID: id, UserID: userID, CredentialID: credID, Document: in.Document, FileID: fileID, ContentVersion: ver})
			if err != nil {
				if isUniqueViolation(err) {
					return 0, nil, apperr.New(http.StatusConflict, "binding_exists", "That credential already has a binding for this document."), nil
				}
				return 0, nil, nil, err
			}
			return http.StatusOK, wire.Raw(bindingView(b)), nil, nil
		case err != nil:
			return 0, nil, nil, err
		}
		if existing.UserID != userID {
			return 0, nil, apperr.ErrNotFound, nil
		}
		if existing.Deleted {
			return 0, nil, apperr.New(http.StatusConflict, "binding_deleted", "That binding was deleted; create a new one."), nil
		}
		if existing.Revision != base {
			return 0, nil, staleRevision(existing.Revision), nil
		}
		b, err := q.UpdateBinding(ctx, sqlcgen.UpdateBindingParams{ID: id, CredentialID: credID, Document: in.Document, FileID: fileID, ContentVersion: ver})
		if err != nil {
			if isUniqueViolation(err) {
				return 0, nil, apperr.New(http.StatusConflict, "binding_exists", "That credential already has a binding for this document."), nil
			}
			return 0, nil, nil, err
		}
		return http.StatusOK, wire.Raw(bindingView(b)), nil, nil
	})
	if err != nil {
		return wire.T006DigestBinding{}, err
	}
	var out wire.T006DigestBinding
	return out, json.Unmarshal(body, &out)
}

// DeleteBinding tombstones a binding at its current revision.
func (s *Service) DeleteBinding(ctx context.Context, userID, id uuid.UUID, in wire.T006Mutation) (wire.T006DigestBinding, error) {
	op, err := uuid.Parse(in.OperationID)
	if err != nil {
		return wire.T006DigestBinding{}, apperr.Validation("operationId must be a UUID")
	}
	base, err := parseRev("baseRevision", in.BaseRevision)
	if err != nil {
		return wire.T006DigestBinding{}, err
	}
	fp := receipts.Fingerprint("DELETE", "koreader/bindings/"+id.String(), map[string]any{"base": base})
	_, body, err := s.rc.Run(ctx, userID, op, fp, nil, func(tx pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
		b, err := q.GetOwnBindingForUpdate(ctx, sqlcgen.GetOwnBindingForUpdateParams{ID: id, UserID: userID})
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil, apperr.ErrNotFound, nil
		}
		if err != nil {
			return 0, nil, nil, err
		}
		if b.Deleted {
			return http.StatusOK, wire.Raw(bindingView(b)), nil, nil
		}
		if b.Revision != base {
			return 0, nil, staleRevision(b.Revision), nil
		}
		d, err := q.DeleteBinding(ctx, id)
		if err != nil {
			return 0, nil, nil, err
		}
		return http.StatusOK, wire.Raw(bindingView(d)), nil, nil
	})
	if err != nil {
		return wire.T006DigestBinding{}, err
	}
	var out wire.T006DigestBinding
	return out, json.Unmarshal(body, &out)
}
