// Package integrations owns the T006 enablement settings and the typed
// protocol credentials (ADR-0073, ADR-0076). A protocol credential is a
// separate secret with its own opaque username: it never authenticates the
// management API, never logs a person in, and is re-evaluated against the
// account and revocation state on every protocol request.
package integrations

import (
	"context"
	"crypto/md5" //nolint:gosec // KOReader's x-auth-key is MD5(password) by protocol definition; stored only as a slow verifier.
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/accounts"
	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/receipts"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Kinds of protocol credential.
const (
	KindOPDS     = "opds"
	KindKOReader = "koreader"
)

// Limits from contracts/t006/README.md.
const (
	MaxActiveCredentials = 50
	verifyCacheTTL       = 10 * time.Minute
	verifyCacheMax       = 4096
	failureWindow        = time.Minute
	failureLimit         = 8
)

// Options configures the service.
type Options struct {
	Pool  *pgxpool.Pool
	Argon accounts.ArgonParams
	// FingerprintKey keys the receipt digest of supplied secrets.
	FingerprintKey []byte
	Clock          func() time.Time
}

// Service implements settings and credentials.
type Service struct {
	pool  *pgxpool.Pool
	q     *sqlcgen.Queries
	rc    *receipts.Runner
	argon accounts.ArgonParams
	fpKey []byte
	now   func() time.Time
	dummy string

	mu       sync.Mutex
	verified map[[32]byte]time.Time
	failures map[string][]time.Time
}

func New(o Options) *Service {
	clock := o.Clock
	if clock == nil {
		clock = time.Now
	}
	argon := o.Argon
	if argon.MemoryKiB == 0 {
		argon = accounts.DefaultArgon
	}
	dummy, _ := accounts.HashPassword("dummy-protocol-secret-for-timing", argon)
	return &Service{pool: o.Pool, q: sqlcgen.New(o.Pool), rc: receipts.New(o.Pool), argon: argon, fpKey: o.FingerprintKey,
		now: func() time.Time { return clock().UTC().Truncate(time.Microsecond) }, dummy: dummy,
		verified: map[[32]byte]time.Time{}, failures: map[string][]time.Time{}}
}

// DeriveFingerprintKey derives the receipt-digest key from the server secret.
// It is used only to key digests of already high-entropy request fields; it is
// not an encryption key (SMTP secrets use their own operator-supplied key).
func DeriveFingerprintKey(serverSecret []byte) []byte {
	h := sha256.Sum256(append([]byte("litara-t006-fingerprint-v1:"), serverSecret...))
	return h[:]
}

// FingerprintKey is the key for receipt digests of supplied secret fields.
func (s *Service) FingerprintKey() []byte { return s.fpKey }

// Pool exposes the shared pool to sibling services.
func (s *Service) Pool() *pgxpool.Pool { return s.pool }

func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func dbErr(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := apperr.As(err); ok {
		return err
	}
	return errors.Join(errors.New("database"), err)
}

// ---- settings -------------------------------------------------------------

// Settings are the current enablement and limits.
type Settings struct {
	Revision           int64
	OPDS, Email, KO    bool
	MaxAttachmentBytes int64
	MaxPerHour         int
}

func settingsOf(r sqlcgen.IntegrationSetting) Settings {
	return Settings{Revision: r.Revision, OPDS: r.OpdsEnabled, Email: r.EmailEnabled, KO: r.KoreaderEnabled,
		MaxAttachmentBytes: r.MaxAttachmentBytes, MaxPerHour: int(r.MaxDeliveriesPerHour)}
}

// Current reads the settings row.
func (s *Service) Current(ctx context.Context) (Settings, error) {
	r, err := s.q.GetIntegrationSettings(ctx)
	if err != nil {
		return Settings{}, dbErr(err)
	}
	return settingsOf(r), nil
}

// ErrDisabled is the 503 for a service the administrator has not enabled.
func ErrDisabled() *apperr.Error {
	return apperr.New(http.StatusServiceUnavailable, "integration_disabled", "This integration is not enabled.")
}

// Enabled returns ErrDisabled unless the named service ("opds", "email",
// "koreader") is on.
func (s *Service) Enabled(ctx context.Context, service string) error {
	st, err := s.Current(ctx)
	if err != nil {
		return err
	}
	on := map[string]bool{"opds": st.OPDS, "email": st.Email, "koreader": st.KO}[service]
	if !on {
		return ErrDisabled()
	}
	return nil
}

func view(st Settings, serverSmtp bool) wire.IntegrationSettings {
	return wire.IntegrationSettings{Revision: strconv.FormatInt(st.Revision, 10), OpdsEnabled: st.OPDS, EmailEnabled: st.Email,
		KoreaderEnabled: st.KO, MaxAttachmentBytes: st.MaxAttachmentBytes, MaxDeliveriesPerUserPerHour: st.MaxPerHour,
		ServerSmtpAvailable: serverSmtp}
}

// ServerSMTPAvailable reports whether an active server transport exists; the
// delivery service supplies it. Until then settings report false.
type ServerSMTPAvailable func(ctx context.Context) bool

// View returns the settings wire body.
func (s *Service) View(ctx context.Context, serverSmtp bool) (wire.IntegrationSettings, error) {
	st, err := s.Current(ctx)
	if err != nil {
		return wire.IntegrationSettings{}, err
	}
	return view(st, serverSmtp), nil
}

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
	return apperr.New(http.StatusConflict, "stale_revision", "The settings changed; reload and retry.").With("currentRevision", strconv.FormatInt(cur, 10))
}

// Put changes the administrator settings under revision control.
func (s *Service) Put(ctx context.Context, admin uuid.UUID, in wire.IntegrationSettingsWrite, serverSmtp bool) (wire.IntegrationSettings, error) {
	op, err := parseOp(in.OperationID)
	if err != nil {
		return wire.IntegrationSettings{}, err
	}
	base, err := parseRev("baseRevision", in.BaseRevision)
	if err != nil {
		return wire.IntegrationSettings{}, err
	}
	if in.MaxAttachmentBytes < 1 || in.MaxAttachmentBytes > 104857600 || in.MaxDeliveriesPerUserPerHour < 1 || in.MaxDeliveriesPerUserPerHour > 100 {
		return wire.IntegrationSettings{}, apperr.Validation("limits are outside the supported range")
	}
	fp := receipts.Fingerprint("PUT", "integration-settings", map[string]any{"base": base, "o": in.OpdsEnabled, "e": in.EmailEnabled,
		"k": in.KoreaderEnabled, "a": in.MaxAttachmentBytes, "h": in.MaxDeliveriesPerUserPerHour})
	_, body, err := s.rc.Run(ctx, admin, op, fp,
		func(_ pgx.Tx, q *sqlcgen.Queries) error { _, err := q.LockIntegrationSettings(ctx); return err },
		func(_ pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
			cur, err := q.GetIntegrationSettings(ctx)
			if err != nil {
				return 0, nil, nil, err
			}
			if cur.Revision != base {
				return 0, nil, stale(cur.Revision), nil
			}
			n, err := q.UpdateIntegrationSettings(ctx, sqlcgen.UpdateIntegrationSettingsParams{OpdsEnabled: in.OpdsEnabled,
				EmailEnabled: in.EmailEnabled, KoreaderEnabled: in.KoreaderEnabled, MaxAttachmentBytes: in.MaxAttachmentBytes,
				MaxDeliveriesPerHour: int32(in.MaxDeliveriesPerUserPerHour)})
			if err != nil {
				return 0, nil, nil, err
			}
			return http.StatusOK, wire.Raw(view(settingsOf(n), false)), nil, nil
		})
	if err != nil {
		return wire.IntegrationSettings{}, dbErr(err)
	}
	var out wire.IntegrationSettings
	if err := json.Unmarshal(body, &out); err != nil {
		return out, err
	}
	// serverSmtpAvailable is live state, not part of the replayed receipt.
	out.ServerSmtpAvailable = serverSmtp
	return out, nil
}

// ---- credentials ----------------------------------------------------------

func credView(c sqlcgen.IntegrationCredential) wire.Credential {
	out := wire.Credential{ID: c.ID.String(), Kind: c.Kind, Username: c.Username, Label: c.Label,
		CreatedAt: rfc(c.CreatedAt), Revoked: c.RevokedAt != nil}
	if c.LastUsedAt != nil {
		s := rfc(*c.LastUsedAt)
		out.LastUsedAt = &s
	}
	return out
}

// ListCredentials returns the caller's active credentials only.
func (s *Service) ListCredentials(ctx context.Context, userID uuid.UUID) (wire.CredentialList, error) {
	rows, err := s.q.ListActiveCredentials(ctx, userID)
	if err != nil {
		return wire.CredentialList{}, dbErr(err)
	}
	out := wire.CredentialList{Items: []wire.Credential{}}
	for _, r := range rows {
		out.Items = append(out.Items, credView(r))
	}
	return out, nil
}

func cleanLabel(l string) (string, error) {
	l = strings.TrimSpace(l)
	if l == "" || len([]rune(l)) > 128 {
		return "", apperr.Validation("label must be 1 to 128 characters")
	}
	for _, r := range l {
		if r < 0x20 || r == 0x7f {
			return "", apperr.Validation("label must not contain control characters")
		}
	}
	return l, nil
}

const usernameAlphabet = "abcdefghjkmnpqrstuvwxyz23456789"

func newUsername(kind string) string {
	b := make([]byte, 14)
	_, _ = rand.Read(b)
	var sb strings.Builder
	sb.WriteString(map[string]string{KindOPDS: "opds-", KindKOReader: "kor-"}[kind])
	for _, c := range b {
		sb.WriteByte(usernameAlphabet[int(c)%len(usernameAlphabet)])
	}
	return sb.String()
}

// KOKey is the x-auth-key KOReader transmits for a password.
func KOKey(password string) string {
	sum := md5.Sum([]byte(password)) //nolint:gosec // protocol-defined
	return hex.EncodeToString(sum[:])
}

// CreateCredential registers a credential. The password is hashed and never
// stored or returned; the receipt carries a keyed digest, not the secret.
func (s *Service) CreateCredential(ctx context.Context, userID uuid.UUID, in wire.CredentialCreate) (wire.Credential, error) {
	op, err := parseOp(in.OperationID)
	if err != nil {
		return wire.Credential{}, err
	}
	if in.Kind != KindOPDS && in.Kind != KindKOReader {
		return wire.Credential{}, apperr.Validation("kind must be opds or koreader")
	}
	label, err := cleanLabel(in.Label)
	if err != nil {
		return wire.Credential{}, err
	}
	if n := len(in.Password); n < 32 || n > 128 || strings.Trim(in.Password, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-") != "" {
		return wire.Credential{}, apperr.Validation("password must be 32 to 128 base64url characters")
	}
	fp := receipts.Fingerprint("POST", "integration-credentials", map[string]any{"k": in.Kind, "l": label, "p": receipts.SecretDigest(s.fpKey, in.Password)})
	secret := in.Password
	if in.Kind == KindKOReader {
		secret = KOKey(in.Password)
	}
	// Hash before the transaction so the row lock is not held across argon2.
	verifier, err := accounts.HashPassword(secret, s.argon)
	if err != nil {
		return wire.Credential{}, err
	}
	st, body, err := s.rc.Run(ctx, userID, op, fp,
		func(_ pgx.Tx, q *sqlcgen.Queries) error { _, err := q.LockUserRow(ctx, userID); return err },
		func(_ pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
			n, err := q.CountActiveCredentials(ctx, userID)
			if err != nil {
				return 0, nil, nil, err
			}
			if n >= MaxActiveCredentials {
				return 0, nil, apperr.New(http.StatusUnprocessableEntity, "limit_exceeded", "The account already has the maximum number of active credentials."), nil
			}
			c, err := q.InsertCredential(ctx, sqlcgen.InsertCredentialParams{UserID: userID, Kind: in.Kind,
				Username: newUsername(in.Kind), Label: label, Verifier: verifier})
			if err != nil {
				return 0, nil, nil, err
			}
			return http.StatusCreated, wire.Raw(credView(c)), nil, nil
		})
	_ = st
	if err != nil {
		return wire.Credential{}, dbErr(err)
	}
	var out wire.Credential
	return out, json.Unmarshal(body, &out)
}

// RevokeCredential permanently revokes an owned credential. It is idempotent;
// another account's credential is 404.
func (s *Service) RevokeCredential(ctx context.Context, userID, id uuid.UUID, in wire.CredentialRevoke) (wire.Credential, error) {
	op, err := parseOp(in.OperationID)
	if err != nil {
		return wire.Credential{}, err
	}
	fp := receipts.Fingerprint("POST", "integration-credentials/"+id.String()+"/revoke", nil)
	_, body, err := s.rc.Run(ctx, userID, op, fp, nil,
		func(_ pgx.Tx, q *sqlcgen.Queries) (int, []byte, *apperr.Error, error) {
			if _, err := q.GetOwnCredentialForUpdate(ctx, sqlcgen.GetOwnCredentialForUpdateParams{ID: id, UserID: userID}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return 0, nil, apperr.ErrNotFound, nil
				}
				return 0, nil, nil, err
			}
			c, err := q.RevokeCredential(ctx, id)
			if err != nil {
				return 0, nil, nil, err
			}
			return http.StatusOK, wire.Raw(credView(c)), nil, nil
		})
	if err != nil {
		return wire.Credential{}, dbErr(err)
	}
	var out wire.Credential
	return out, json.Unmarshal(body, &out)
}

// ---- protocol authentication ----------------------------------------------

// Protocol is an authenticated protocol credential.
type Protocol struct {
	CredentialID uuid.UUID
	UserID       uuid.UUID
	Kind         string
	Username     string
}

// ErrThrottled is returned after repeated failures for one username.
var ErrThrottled = apperr.New(http.StatusTooManyRequests, "rate_limited", "Too many failed attempts; try again later.")

func (s *Service) throttled(user string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	cut := s.now().Add(-failureWindow)
	keep := s.failures[user][:0]
	for _, t := range s.failures[user] {
		if t.After(cut) {
			keep = append(keep, t)
		}
	}
	s.failures[user] = keep
	if len(keep) == 0 {
		delete(s.failures, user)
	}
	return len(keep) >= failureLimit
}

func (s *Service) fail(user string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.failures) > 8192 {
		s.failures = map[string][]time.Time{}
	}
	s.failures[user] = append(s.failures[user], s.now())
}

func cacheKey(id uuid.UUID, verifier, presented string) [32]byte {
	h := sha256.New()
	h.Write(id[:])
	h.Write([]byte{0})
	h.Write([]byte(verifier))
	h.Write([]byte{0})
	h.Write([]byte(presented))
	var k [32]byte
	copy(k[:], h.Sum(nil))
	return k
}

// Authenticate verifies a presented secret for one credential kind. For
// koreader the presented value is the transmitted x-auth-key. Account activity
// and revocation are read from the database on every call; only the costly
// slow-hash comparison is cached, keyed to the exact stored verifier.
func (s *Service) Authenticate(ctx context.Context, kind, username, presented string) (*Protocol, error) {
	username = strings.TrimSpace(username)
	if username == "" || presented == "" || len(username) > 128 || len(presented) > 256 {
		accounts.VerifyPassword(presented, s.dummy)
		return nil, apperr.ErrUnauthenticated
	}
	if s.throttled(username) {
		return nil, ErrThrottled
	}
	row, err := s.q.GetCredentialForAuth(ctx, sqlcgen.GetCredentialForAuthParams{Username: username, Kind: kind})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			accounts.VerifyPassword(presented, s.dummy) // equalize timing for unknown usernames
			s.fail(username)
			return nil, apperr.ErrUnauthenticated
		}
		return nil, dbErr(err)
	}
	key := cacheKey(row.ID, row.Verifier, presented)
	s.mu.Lock()
	exp, hit := s.verified[key]
	if hit && !s.now().Before(exp) {
		delete(s.verified, key)
		hit = false
	}
	s.mu.Unlock()
	if !hit {
		if !accounts.VerifyPassword(presented, row.Verifier) {
			s.fail(username)
			return nil, apperr.ErrUnauthenticated
		}
		s.mu.Lock()
		if len(s.verified) >= verifyCacheMax {
			s.verified = map[[32]byte]time.Time{}
		}
		s.verified[key] = s.now().Add(verifyCacheTTL)
		s.mu.Unlock()
	}
	// Account state and revocation always come from this read, never the cache.
	if row.RevokedAt != nil || !row.UserActive {
		return nil, apperr.ErrUnauthenticated
	}
	_ = s.q.TouchCredential(ctx, row.ID)
	return &Protocol{CredentialID: row.ID, UserID: row.UserID, Kind: row.Kind, Username: row.Username}, nil
}
