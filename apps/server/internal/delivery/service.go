package delivery

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/catalog"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/integrations"
	"github.com/deranjer/ebooker/apps/server/internal/receipts"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Limits from contracts/t006/README.md.
const (
	MaxActiveRecipients = 100
	MaxAttempts         = 3
)

// retryDelays are the waits after the first and second failed attempt.
var retryDelays = []time.Duration{5 * time.Second, 30 * time.Second}

// Scheduler records the durable job that runs Process, in the caller's
// transaction. The production implementation inserts a River job with
// MaxAttempts 1 so the queue itself can never retry a submission.
type Scheduler interface {
	Schedule(ctx context.Context, tx pgx.Tx, id uuid.UUID, at time.Time) error
}

// Options configures the service.
type Options struct {
	Pool         *pgxpool.Pool
	Keys         *KeyRing
	Net          NetPolicy
	Catalog      *catalog.Service
	Integrations *integrations.Service
	Sched        Scheduler
	MediaRoot    string
	Clock        func() time.Time
	Hooks        SendHooks
}

// Service implements SMTP configuration, recipients and deliveries.
type Service struct {
	pool  *pgxpool.Pool
	q     *sqlcgen.Queries
	rc    *receipts.Runner
	keys  atomic.Pointer[KeyRing]
	net   NetPolicy
	cat   *catalog.Service
	integ *integrations.Service
	sched Scheduler
	root  string
	now   func() time.Time
	hooks SendHooks
}

func New(o Options) *Service {
	clock := o.Clock
	if clock == nil {
		clock = time.Now
	}
	svc := &Service{pool: o.Pool, q: sqlcgen.New(o.Pool), rc: receipts.New(o.Pool), net: o.Net, cat: o.Catalog,
		integ: o.Integrations, sched: o.Sched, root: o.MediaRoot, hooks: o.Hooks,
		now: func() time.Time { return clock().UTC().Truncate(time.Microsecond) }}
	svc.keys.Store(o.Keys)
	return svc
}

func (s *Service) ring() *KeyRing { return s.keys.Load() }

// SetKeys replaces the key ring. It exists so tests can model a removed or
// wrong key; the server sets the ring once at startup.
func (s *Service) SetKeys(k *KeyRing) { s.keys.Store(k) }

func rev(n int64) string { return strconv.FormatInt(n, 10) }

func parseRev(field, v string) (int64, error) {
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n < 0 || (len(v) > 1 && v[0] == '0') {
		return 0, apperr.Validation(field + " must be a nonnegative decimal string")
	}
	return n, nil
}

func parseOp(v string) (uuid.UUID, error) {
	id, err := uuid.Parse(v)
	if err != nil {
		return uuid.Nil, apperr.Validation("operationId must be a UUID")
	}
	return id, nil
}

func stale(cur int64) *apperr.Error {
	return apperr.New(http.StatusConflict, "stale_revision", "The resource changed; reload and retry.").With("currentRevision", rev(cur))
}

func unavailable(detail string) *apperr.Error {
	return apperr.New(http.StatusServiceUnavailable, "configuration_unavailable", detail)
}

// ---- SMTP configuration ----------------------------------------------------

// Owner names whose transport is addressed: the server's, or one user's.
type Owner struct {
	Personal bool
	User     uuid.UUID
}

func (o Owner) kind() string {
	if o.Personal {
		return "personal"
	}
	return "server"
}

func (o Owner) idStr() string {
	if o.Personal {
		return o.User.String()
	}
	return "server"
}

func (o Owner) scope() string { return "delivery/smtp:" + o.idStr() }

func (s *Service) load(ctx context.Context, q *sqlcgen.Queries, o Owner, lock bool) (sqlcgen.SmtpConfig, bool, error) {
	var row sqlcgen.SmtpConfig
	var err error
	switch {
	case o.Personal && lock:
		row, err = q.LockPersonalSmtp(ctx, nullUUID(&o.User))
	case o.Personal:
		row, err = q.GetPersonalSmtp(ctx, nullUUID(&o.User))
	case lock:
		row, err = q.LockServerSmtp(ctx)
	default:
		row, err = q.GetServerSmtp(ctx)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return row, false, nil
	}
	return row, err == nil, err
}

func (s *Service) report(row sqlcgen.SmtpConfig, found bool) wire.SmtpReport {
	r := wire.SmtpReport{Revision: "0", Port: 587, TLSMode: TLSStartTLS, KeyAvailable: s.ring().Available()}
	if !found {
		return r
	}
	r.Revision, r.Configured, r.Enabled = rev(row.Revision), row.Revision > 0, row.Enabled
	r.Host, r.Port, r.TLSMode, r.Username, r.FromAddress = row.Host, int(row.Port), row.TlsMode, row.Username, row.FromAddress
	r.HasPassword = row.Ciphertext != nil
	if row.Ciphertext != nil {
		r.KeyAvailable = s.ring().Has(derefStr(row.KeyID))
	}
	return r
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// Report returns the transport's own report; secrets never appear, only their presence.
func (s *Service) Report(ctx context.Context, o Owner) (wire.SmtpReport, error) {
	row, found, err := s.load(ctx, s.q, o, false)
	if err != nil {
		return wire.SmtpReport{}, err
	}
	return s.report(row, found), nil
}

var hostRe = regexp.MustCompile(`^[A-Za-z0-9.\-:\[\]_]{1,253}$`)

func (s *Service) validateWrite(o Owner, in wire.SmtpWrite) error {
	if !hostRe.MatchString(in.Host) {
		return apperr.Validation("host must be a plain host name or address")
	}
	if in.Port < 1 || in.Port > 65535 {
		return apperr.Validation("port is out of range")
	}
	if _, ok := ValidMailbox(in.FromAddress); !ok {
		return apperr.Validation("fromAddress must be a single plain mailbox")
	}
	if len(in.Username) > 320 || strings.ContainsAny(in.Username, "\r\n\x00") || !utf8.ValidString(in.Username) {
		return apperr.Validation("username is invalid")
	}
	ip := net.ParseIP(strings.Trim(in.Host, "[]"))
	loop := in.Host == "localhost" || (ip != nil && ip.IsLoopback())
	switch in.TLSMode {
	case TLSStartTLS, TLSImplicit:
	case TLSLocalTest:
		if !s.net.AllowLocalTest || !loop {
			return apperr.Validation("plaintext is only available in explicit local test mode against a loopback sink")
		}
	default:
		return apperr.Validation("tlsMode is not supported")
	}
	if o.Personal {
		// Literal addresses are checked now; names are resolved and pinned at every connection.
		if loop && !s.net.AllowLocalTest || ip != nil && !PublicIP(ip) && !(s.net.AllowLocalTest && ip.IsLoopback()) {
			return apperr.Validation("that address is not permitted for a personal transport")
		}
	}
	switch in.SecretAction {
	case "replace":
		if in.Password == nil || *in.Password == "" || len(*in.Password) > 4096 {
			return apperr.Validation("replace needs a nonempty password")
		}
	case "keep", "clear":
		if in.Password != nil {
			return apperr.Validation("keep and clear take no password")
		}
	default:
		return apperr.Validation("secretAction must be keep, replace or clear")
	}
	return nil
}

// Put changes a transport configuration at its current revision.
func (s *Service) Put(ctx context.Context, actor uuid.UUID, o Owner, in wire.SmtpWrite) (wire.SmtpReport, error) {
	op, err := parseOp(in.OperationID)
	if err != nil {
		return wire.SmtpReport{}, err
	}
	base, err := parseRev("baseRevision", in.BaseRevision)
	if err != nil {
		return wire.SmtpReport{}, err
	}
	if err := s.validateWrite(o, in); err != nil {
		return wire.SmtpReport{}, err
	}
	digest := ""
	if in.Password != nil {
		digest = receipts.SecretDigest(s.integ.FingerprintKey(), *in.Password)
	}
	fp := receipts.Fingerprint("PUT", o.scope(), map[string]any{"b": base, "e": in.Enabled, "h": in.Host, "p": in.Port, "t": in.TLSMode,
		"u": in.Username, "f": in.FromAddress, "a": in.SecretAction, "d": digest})
	lock := func(_ pgx.Tx, q *sqlcgen.Queries) error {
		var uid *uuid.UUID
		if o.Personal {
			uid = &o.User
		}
		if err := q.EnsureSmtpConfig(ctx, sqlcgen.EnsureSmtpConfigParams{OwnerKind: o.kind(), UserID: nullUUID(uid)}); err != nil {
			return err
		}
		_, _, err := s.load(ctx, q, o, true)
		return err
	}
	_, body, err := s.rc.Run(ctx, actor, op, fp, lock, func(_ pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
		cur, _, err := s.load(ctx, q, o, true)
		if err != nil {
			return 0, nil, nil, err
		}
		if cur.Revision != base {
			return 0, nil, stale(cur.Revision), nil
		}
		keyID, nonce, ct := cur.KeyID, cur.Nonce, cur.Ciphertext
		switch in.SecretAction {
		case "clear":
			keyID, nonce, ct = nil, nil, nil
		case "replace":
			if !s.ring().Available() {
				return 0, nil, nil, unavailable("No SMTP encryption key is configured.")
			}
			k, n, c, err := s.ring().Seal([]byte(*in.Password), o.kind(), o.idStr())
			if err != nil {
				return 0, nil, nil, unavailable("The password could not be encrypted.")
			}
			keyID, nonce, ct = &k, n, c
		}
		if in.Username != "" && ct == nil {
			return 0, nil, nil, apperr.Validation("a username requires a configured password")
		}
		if in.Username == "" && ct != nil {
			return 0, nil, nil, apperr.Validation("a password requires a username")
		}
		row, err := q.UpdateSmtp(ctx, sqlcgen.UpdateSmtpParams{ID: cur.ID, Enabled: in.Enabled, Host: in.Host, Port: int32(in.Port), TlsMode: in.TLSMode,
			Username: in.Username, FromAddress: in.FromAddress, KeyID: keyID, Nonce: nonce, Ciphertext: ct})
		if err != nil {
			return 0, nil, nil, err
		}
		return http.StatusOK, wire.Raw(s.report(row, true)), nil, nil
	})
	if err != nil {
		return wire.SmtpReport{}, err
	}
	var out wire.SmtpReport
	if err := json.Unmarshal(body, &out); err != nil {
		return out, err
	}
	out.KeyAvailable = s.reportKeyAvailable(ctx, o, out)
	return out, nil
}

// reportKeyAvailable keeps the live key state out of the replayed receipt.
func (s *Service) reportKeyAvailable(ctx context.Context, o Owner, r wire.SmtpReport) bool {
	if cur, err := s.Report(ctx, o); err == nil {
		return cur.KeyAvailable
	}
	return r.KeyAvailable
}

// open decrypts the stored secret into a usable transport configuration.
func (s *Service) open(row sqlcgen.SmtpConfig, o Owner) (Config, error) {
	cfg := Config{Host: row.Host, Port: int(row.Port), TLSMode: row.TlsMode, Username: row.Username, From: row.FromAddress}
	if row.Ciphertext != nil {
		pw, err := s.ring().Open(derefStr(row.KeyID), row.Nonce, row.Ciphertext, o.kind(), o.idStr())
		if err != nil {
			return Config{}, err
		}
		cfg.Password = string(pw)
	}
	return cfg, nil
}

var testDetails = map[string]string{
	"ok":                         "Connected and authenticated. No message was sent.",
	"tls_verification_failed":    "The server certificate could not be verified.",
	"starttls_unavailable":       "The server does not offer STARTTLS, and plaintext is not allowed.",
	"authentication_failed":      "The server refused the credentials.",
	"authentication_unsupported": "The server does not offer authentication.",
	"connection_failed":          "Could not connect to the server.",
	"address_not_permitted":      "That address is not permitted for this transport.",
	"plaintext_not_permitted":    "Plaintext transport is not permitted.",
	"configuration_unavailable":  "The stored configuration cannot be used (missing or wrong encryption key).",
}

func testResult(code string) wire.ConnectionTest {
	d, ok := testDetails[code]
	if !ok {
		d = "The server did not accept the connection."
	}
	return wire.ConnectionTest{Success: code == "ok", Code: code, Detail: d}
}

// Test connects, secures and authenticates against the stored configuration at
// the stated revision. It sends no message and returns only sanitized codes.
func (s *Service) Test(ctx context.Context, actor uuid.UUID, o Owner, in wire.RevisionedMutation) (wire.ConnectionTest, error) {
	op, err := parseOp(in.OperationID)
	if err != nil {
		return wire.ConnectionTest{}, err
	}
	base, err := parseRev("baseRevision", in.BaseRevision)
	if err != nil {
		return wire.ConnectionTest{}, err
	}
	fp := receipts.Fingerprint("POST", o.scope()+"/test", map[string]any{"b": base})
	_, body, err := s.rc.Run(ctx, actor, op, fp, nil, func(_ pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
		row, found, err := s.load(ctx, q, o, false)
		if err != nil {
			return 0, nil, nil, err
		}
		if !found || row.Revision == 0 {
			if base != 0 {
				return 0, nil, stale(0), nil
			}
			return 0, nil, apperr.New(http.StatusConflict, "transport_unavailable", "This transport is not configured."), nil
		}
		if row.Revision != base {
			return 0, nil, stale(row.Revision), nil
		}
		cfg, err := s.open(row, o)
		if err != nil {
			return http.StatusOK, wire.Raw(testResult("configuration_unavailable")), nil, nil
		}
		if f := s.net.Test(ctx, cfg, o.Personal); f != nil {
			return http.StatusOK, wire.Raw(testResult(f.Code)), nil, nil
		}
		return http.StatusOK, wire.Raw(testResult("ok")), nil, nil
	})
	if err != nil {
		return wire.ConnectionTest{}, err
	}
	var out wire.ConnectionTest
	return out, json.Unmarshal(body, &out)
}

func (s *Service) usable(row sqlcgen.SmtpConfig, found bool) bool {
	if !found || row.Revision == 0 || !row.Enabled || row.Host == "" {
		return false
	}
	return row.Ciphertext == nil || s.ring().Has(derefStr(row.KeyID))
}

// Transports reports availability and revisions. The server's host, user name
// and password are never exposed here.
func (s *Service) Transports(ctx context.Context, userID uuid.UUID) (wire.TransportList, error) {
	var out wire.TransportList
	for _, c := range []struct {
		o   Owner
		dst *wire.TransportState
	}{{Owner{}, &out.Server}, {Owner{Personal: true, User: userID}, &out.Personal}} {
		row, found, err := s.load(ctx, s.q, c.o, false)
		if err != nil {
			return out, err
		}
		*c.dst = wire.TransportState{Available: s.usable(row, found), Revision: "0"}
		if found {
			c.dst.Revision = rev(row.Revision)
		}
	}
	return out, nil
}

// ServerAvailable reports whether the administrator transport can be used.
func (s *Service) ServerAvailable(ctx context.Context) bool {
	row, found, err := s.load(ctx, s.q, Owner{}, false)
	return err == nil && s.usable(row, found)
}

// ---- recipients -------------------------------------------------------------

func recipientView(r sqlcgen.DeliveryRecipient) wire.Recipient {
	out := wire.Recipient{ID: r.ID.String(), Revision: rev(r.Revision), Deleted: r.Deleted}
	if !r.Deleted {
		out.Data = wire.Some(&wire.RecipientData{Name: r.Name, Address: r.Address})
	}
	return out
}

func cleanName(n string) (string, bool) {
	n = strings.TrimSpace(n)
	if n == "" || utf8.RuneCountInString(n) > 128 || !utf8.ValidString(n) {
		return "", false
	}
	for _, r := range n {
		if r < 0x20 || r == 0x7f {
			return "", false
		}
	}
	return n, true
}

// ListRecipients returns the caller's active recipients only.
func (s *Service) ListRecipients(ctx context.Context, userID uuid.UUID) (wire.RecipientList, error) {
	rows, err := s.q.ListActiveRecipients(ctx, userID)
	if err != nil {
		return wire.RecipientList{}, err
	}
	out := wire.RecipientList{Items: []wire.Recipient{}}
	for _, r := range rows {
		out.Items = append(out.Items, recipientView(r))
	}
	return out, nil
}

// PutRecipient creates (base 0, client UUID) or updates an owned recipient.
func (s *Service) PutRecipient(ctx context.Context, userID, id uuid.UUID, in wire.RecipientWrite) (wire.Recipient, error) {
	op, err := parseOp(in.OperationID)
	if err != nil {
		return wire.Recipient{}, err
	}
	base, err := parseRev("baseRevision", in.BaseRevision)
	if err != nil {
		return wire.Recipient{}, err
	}
	name, ok := cleanName(in.Data.Name)
	addr, ok2 := ValidMailbox(in.Data.Address)
	if !ok || !ok2 {
		return wire.Recipient{}, apperr.Validation("name and address must be single-line, valid values")
	}
	fp := receipts.Fingerprint("PUT", "delivery/recipients/"+id.String(), map[string]any{"b": base, "n": name, "a": addr})
	lock := func(_ pgx.Tx, q *sqlcgen.Queries) error { _, err := q.LockUserRow(ctx, userID); return err }
	_, body, err := s.rc.Run(ctx, userID, op, fp, lock, func(_ pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
		cur, err := q.GetRecipientAny(ctx, id)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			if base != 0 {
				return 0, nil, stale(0), nil
			}
			n, err := q.CountActiveRecipients(ctx, userID)
			if err != nil {
				return 0, nil, nil, err
			}
			if n >= MaxActiveRecipients {
				return 0, nil, apperr.New(http.StatusUnprocessableEntity, "limit_exceeded", "The account already has the maximum number of saved recipients."), nil
			}
			r, err := q.InsertRecipient(ctx, sqlcgen.InsertRecipientParams{ID: id, UserID: userID, Name: name, Address: addr})
			if err != nil {
				return 0, nil, nil, err
			}
			return http.StatusOK, wire.Raw(recipientView(r)), nil, nil
		case err != nil:
			return 0, nil, nil, err
		}
		if cur.UserID != userID {
			return 0, nil, apperr.ErrNotFound, nil
		}
		if cur.Deleted {
			return 0, nil, apperr.New(http.StatusConflict, "recipient_deleted", "That recipient was deleted; create a new one."), nil
		}
		if cur.Revision != base {
			return 0, nil, stale(cur.Revision), nil
		}
		r, err := q.UpdateRecipient(ctx, sqlcgen.UpdateRecipientParams{ID: id, Name: name, Address: addr})
		if err != nil {
			return 0, nil, nil, err
		}
		return http.StatusOK, wire.Raw(recipientView(r)), nil, nil
	})
	if err != nil {
		return wire.Recipient{}, err
	}
	var out wire.Recipient
	return out, json.Unmarshal(body, &out)
}

// DeleteRecipient tombstones an owned recipient; the tombstone is retained.
func (s *Service) DeleteRecipient(ctx context.Context, userID, id uuid.UUID, in wire.RevisionedMutation) (wire.Recipient, error) {
	op, err := parseOp(in.OperationID)
	if err != nil {
		return wire.Recipient{}, err
	}
	base, err := parseRev("baseRevision", in.BaseRevision)
	if err != nil {
		return wire.Recipient{}, err
	}
	fp := receipts.Fingerprint("DELETE", "delivery/recipients/"+id.String(), map[string]any{"b": base})
	_, body, err := s.rc.Run(ctx, userID, op, fp, nil, func(_ pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
		cur, err := q.GetOwnRecipientForUpdate(ctx, sqlcgen.GetOwnRecipientForUpdateParams{ID: id, UserID: userID})
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil, apperr.ErrNotFound, nil
		}
		if err != nil {
			return 0, nil, nil, err
		}
		if cur.Deleted {
			return http.StatusOK, wire.Raw(recipientView(cur)), nil, nil
		}
		if cur.Revision != base {
			return 0, nil, stale(cur.Revision), nil
		}
		r, err := q.TombstoneRecipient(ctx, id)
		if err != nil {
			return 0, nil, nil, err
		}
		return http.StatusOK, wire.Raw(recipientView(r)), nil, nil
	})
	if err != nil {
		return wire.Recipient{}, err
	}
	var out wire.Recipient
	return out, json.Unmarshal(body, &out)
}
