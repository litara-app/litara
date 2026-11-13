// Package accounts implements local accounts, explicit library grants and
// native/browser sessions (ADR-0031..0035). Credentials are opaque random
// tokens whose SHA-256 verifiers are stored; passwords use argon2id.
package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/deranjer/ebooker/apps/server/internal/apperr"
	"github.com/deranjer/ebooker/apps/server/internal/db/sqlcgen"
	"github.com/deranjer/ebooker/apps/server/internal/wire"
)

// Lifetimes from contracts/t003/fixtures/auth-exchanges.json.
const (
	AccessTTL      = 900 * time.Second
	IdleTTL        = 30 * 24 * time.Hour
	AbsoluteTTL    = 90 * 24 * time.Hour
	RefreshRecover = 60 * time.Second
	touchEvery     = time.Minute
)

type Options struct {
	Pool      *pgxpool.Pool
	Clock     func() time.Time
	SecretKey []byte
	Argon     ArgonParams
}

type Service struct {
	pool  *pgxpool.Pool
	q     *sqlcgen.Queries
	now   func() time.Time
	key   []byte
	argon ArgonParams

	mu       sync.Mutex
	failures map[string][]time.Time
}

func New(o Options) *Service {
	clock := o.Clock
	if clock == nil {
		clock = time.Now
	}
	argon := o.Argon
	if argon.MemoryKiB == 0 {
		argon = DefaultArgon
	}
	return &Service{pool: o.Pool, q: sqlcgen.New(o.Pool), now: func() time.Time { return clock().UTC() },
		key: o.SecretKey, argon: argon, failures: map[string][]time.Time{}}
}

// Principal is the validated identity of a request. User IDs always come
// from here, never from a request body.
type Principal struct {
	UserID     uuid.UUID
	SessionID  uuid.UUID
	Kind       string
	IsAdmin    bool
	DeviceName string
	// CookieToken is set for browser sessions (CSRF derivation).
	CookieToken string
}

func unavailable(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := apperr.As(err); ok {
		return err
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return fmt.Errorf("database: %w", err)
}

func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func userView(u sqlcgen.User) wire.User {
	return wire.User{ID: u.ID.String(), Username: u.Username, DisplayName: u.DisplayName, IsAdmin: u.IsAdmin, Active: u.Active}
}

func sessionView(s sqlcgen.Session) wire.Session {
	return wire.Session{ID: s.ID.String(), DeviceName: s.DeviceName, Client: s.Kind, CreatedAt: rfc(s.CreatedAt),
		LastUsedAt: rfc(s.LastUsedAt), IdleExpiresAt: rfc(s.IdleExpiresAt), AbsoluteExpiresAt: rfc(s.AbsoluteExpiresAt)}
}

func isUnique(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

// ---- server identity -------------------------------------------------

// ServerID returns the persisted server UUID, creating it once.
func (s *Service) ServerID(ctx context.Context) (uuid.UUID, error) {
	id, err := s.q.GetServerIdentity(ctx)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, unavailable(err)
	}
	if err := s.q.InsertServerIdentity(ctx, uuid.New()); err != nil {
		return uuid.Nil, unavailable(err)
	}
	id, err = s.q.GetServerIdentity(ctx)
	return id, unavailable(err)
}

// ---- users ---------------------------------------------------------------

func validateUsername(name string) (display, key string, err error) {
	display = strings.TrimSpace(name)
	if display == "" || utf8.RuneCountInString(display) > 128 {
		return "", "", apperr.Validation("username must be 1-128 characters")
	}
	return display, NormalizeUsername(display), nil
}

func (s *Service) newUser(ctx context.Context, q *sqlcgen.Queries, username, displayName, password string, admin bool) (sqlcgen.User, error) {
	display, key, err := validateUsername(username)
	if err != nil {
		return sqlcgen.User{}, err
	}
	if utf8.RuneCountInString(password) < 12 || len(password) > 1024 {
		return sqlcgen.User{}, apperr.Validation("password must be 12-1024 characters")
	}
	hash, err := HashPassword(password, s.argon)
	if err != nil {
		return sqlcgen.User{}, err
	}
	if strings.TrimSpace(displayName) == "" {
		displayName = display
	}
	u, err := q.InsertUser(ctx, sqlcgen.InsertUserParams{UsernameKey: key, Username: display, DisplayName: displayName,
		PasswordHash: hash, IsAdmin: admin})
	if isUnique(err) {
		return u, apperr.New(http.StatusConflict, "username_taken", "That username is already in use.")
	}
	return u, unavailable(err)
}

// ErrAlreadyInitialized is returned when first-admin bootstrap is refused.
var ErrAlreadyInitialized = errors.New("server is already initialized: a user exists")

// Bootstrap atomically creates the first administrator. It refuses when any
// user exists and serializes against a concurrent bootstrap attempt.
func (s *Service) Bootstrap(ctx context.Context, username, displayName, password string) (wire.User, error) {
	var out wire.User
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if err := q.LockBootstrap(ctx); err != nil {
			return err
		}
		n, err := q.CountUsers(ctx)
		if err != nil {
			return err
		}
		if n > 0 {
			return ErrAlreadyInitialized
		}
		u, err := s.newUser(ctx, q, username, displayName, password, true)
		if err != nil {
			return err
		}
		out = userView(u)
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrAlreadyInitialized) {
			return out, err
		}
		return out, unavailable(err)
	}
	if _, err := s.ServerID(ctx); err != nil {
		return out, err
	}
	return out, nil
}

// CreateUser is the administrator operation; it grants no library access.
func (s *Service) CreateUser(ctx context.Context, in wire.CreateUser) (wire.User, error) {
	u, err := s.newUser(ctx, s.q, in.Username, in.DisplayName, in.Password, in.IsAdmin)
	if err != nil {
		return wire.User{}, err
	}
	return userView(u), nil
}

var errLastAdmin = apperr.New(http.StatusConflict, "last_administrator", "The last active administrator cannot be removed or deactivated.")

// UpdateUser changes display name/admin/active. Deactivation revokes all of
// the user's sessions in the same transaction.
func (s *Service) UpdateUser(ctx context.Context, id uuid.UUID, in wire.UpdateUser) (wire.User, error) {
	if in.DisplayName == nil && in.IsAdmin == nil && in.Active == nil {
		return wire.User{}, apperr.Validation("at least one property is required")
	}
	var out wire.User
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		admins, err := q.LockActiveAdmins(ctx)
		if err != nil {
			return err
		}
		cur, err := q.GetUserForUpdate(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.ErrNotFound
		}
		if err != nil {
			return err
		}
		newAdmin, newActive := cur.IsAdmin, cur.Active
		if in.IsAdmin != nil {
			newAdmin = *in.IsAdmin
		}
		if in.Active != nil {
			newActive = *in.Active
		}
		wasActiveAdmin := cur.IsAdmin && cur.Active
		if wasActiveAdmin && !(newAdmin && newActive) && len(admins) <= 1 {
			return errLastAdmin
		}
		u, err := q.UpdateUser(ctx, sqlcgen.UpdateUserParams{ID: id, DisplayName: in.DisplayName, IsAdmin: in.IsAdmin, Active: in.Active})
		if err != nil {
			return err
		}
		if cur.Active && !newActive {
			if _, err := q.RevokeUserSessions(ctx, sqlcgen.RevokeUserSessionsParams{UserID: id, RevokedAt: ptr(s.now()), RevokedReason: ptr("account_deactivated")}); err != nil {
				return err
			}
		}
		out = userView(u)
		return nil
	})
	return out, unavailable(err)
}

func ptr[T any](v T) *T { return &v }

// SetPassword is the local operator password reset; it revokes the user's sessions.
func (s *Service) SetPassword(ctx context.Context, username, password string) error {
	if utf8.RuneCountInString(password) < 12 || len(password) > 1024 {
		return apperr.Validation("password must be 12-1024 characters")
	}
	hash, err := HashPassword(password, s.argon)
	if err != nil {
		return err
	}
	return unavailable(pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		u, err := q.GetUserByKey(ctx, NormalizeUsername(username))
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.ErrNotFound
		}
		if err != nil {
			return err
		}
		if err := q.SetPasswordHash(ctx, sqlcgen.SetPasswordHashParams{ID: u.ID, PasswordHash: hash}); err != nil {
			return err
		}
		_, err = q.RevokeUserSessions(ctx, sqlcgen.RevokeUserSessionsParams{UserID: u.ID, RevokedAt: ptr(s.now()), RevokedReason: ptr("password_reset")})
		return err
	}))
}

func (s *Service) ListUsers(ctx context.Context, page, size int) (wire.UserList, error) {
	total, err := s.q.CountUsers(ctx)
	if err != nil {
		return wire.UserList{}, unavailable(err)
	}
	rows, err := s.q.ListUsers(ctx, sqlcgen.ListUsersParams{Limit: int32(size), Offset: int32(page * size)})
	if err != nil {
		return wire.UserList{}, unavailable(err)
	}
	out := wire.UserList{Items: make([]wire.User, 0, len(rows)), Total: total, Page: int64(page), Size: int64(size)}
	for _, u := range rows {
		out.Items = append(out.Items, userView(u))
	}
	return out, nil
}

// LookupID resolves a username (by its normalized key) to the account ID.
func (s *Service) LookupID(ctx context.Context, username string) (uuid.UUID, error) {
	u, err := s.q.GetUserByKey(ctx, NormalizeUsername(username))
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, apperr.ErrNotFound
	}
	return u.ID, unavailable(err)
}

func (s *Service) User(ctx context.Context, id uuid.UUID) (wire.User, error) {
	u, err := s.q.GetUser(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return wire.User{}, apperr.ErrNotFound
	}
	return userView(u), unavailable(err)
}

// ---- grants & libraries --------------------------------------------------

func (s *Service) Grant(ctx context.Context, userID, libraryID uuid.UUID) error {
	return unavailable(pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if _, err := q.GetUserForUpdate(ctx, userID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return apperr.ErrNotFound
			}
			return err
		}
		if _, err := q.GetLibrary(ctx, libraryID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return apperr.ErrNotFound
			}
			return err
		}
		return q.InsertGrant(ctx, sqlcgen.InsertGrantParams{UserID: userID, LibraryID: libraryID})
	}))
}

func (s *Service) RemoveGrant(ctx context.Context, userID, libraryID uuid.UUID) error {
	if _, err := s.q.GetUser(ctx, userID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.ErrNotFound
		}
		return unavailable(err)
	}
	if _, err := s.q.GetLibrary(ctx, libraryID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.ErrNotFound
		}
		return unavailable(err)
	}
	_, err := s.q.DeleteGrant(ctx, sqlcgen.DeleteGrantParams{UserID: userID, LibraryID: libraryID})
	return unavailable(err)
}

// HasGrant reports whether the user currently holds an explicit grant.
func (s *Service) HasGrant(ctx context.Context, userID, libraryID uuid.UUID) (bool, error) {
	ok, err := s.q.HasGrant(ctx, sqlcgen.HasGrantParams{UserID: userID, LibraryID: libraryID})
	return ok, unavailable(err)
}

func (s *Service) Libraries(ctx context.Context, userID uuid.UUID, page, size int) (wire.LibraryList, error) {
	total, err := s.q.CountLibrariesForUser(ctx, userID)
	if err != nil {
		return wire.LibraryList{}, unavailable(err)
	}
	rows, err := s.q.ListLibrariesForUser(ctx, sqlcgen.ListLibrariesForUserParams{UserID: userID, Limit: int32(size), Offset: int32(page * size)})
	if err != nil {
		return wire.LibraryList{}, unavailable(err)
	}
	out := wire.LibraryList{Items: make([]wire.Library, 0, len(rows)), Total: total, Page: int64(page), Size: int64(size)}
	for _, l := range rows {
		out.Items = append(out.Items, wire.Library{ID: l.ID.String(), Name: l.Name})
	}
	return out, nil
}

// ---- login -----------------------------------------------------------

const (
	failureWindow = 5 * time.Minute
	failureLimit  = 10
)

func (s *Service) throttled(key string) (time.Duration, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	var keep []time.Time
	for _, t := range s.failures[key] {
		if now.Sub(t) < failureWindow {
			keep = append(keep, t)
		}
	}
	s.failures[key] = keep
	if len(keep) >= failureLimit {
		return failureWindow - now.Sub(keep[0]), true
	}
	return 0, false
}

func (s *Service) recordFailure(key string) {
	s.mu.Lock()
	s.failures[key] = append(s.failures[key], s.now())
	s.mu.Unlock()
}

func (s *Service) clearFailures(key string) {
	s.mu.Lock()
	delete(s.failures, key)
	s.mu.Unlock()
}

func (s *Service) authenticatePassword(ctx context.Context, username, password string) (sqlcgen.User, error) {
	key := NormalizeUsername(username)
	if wait, ok := s.throttled(key); ok {
		e := apperr.New(http.StatusTooManyRequests, "rate_limited", "Too many sign-in attempts; try again later.")
		e.RetryAfterSeconds = int(wait.Seconds()) + 1
		return sqlcgen.User{}, e
	}
	u, err := s.q.GetUserByKey(ctx, key)
	if errors.Is(err, pgx.ErrNoRows) {
		VerifyPassword(password, dummyHash)
		s.recordFailure(key)
		return u, apperr.ErrInvalidCredentials
	}
	if err != nil {
		return u, unavailable(err)
	}
	if !VerifyPassword(password, u.PasswordHash) || !u.Active {
		s.recordFailure(key)
		return u, apperr.ErrInvalidCredentials
	}
	s.clearFailures(key)
	return u, nil
}

func (s *Service) newSession(ctx context.Context, u sqlcgen.User, kind, device string, accessHash []byte, refreshHash []byte) (sqlcgen.Session, error) {
	now := s.now()
	abs := now.Add(AbsoluteTTL)
	var accessExp *time.Time
	if kind == "native" {
		accessExp = ptr(now.Add(AccessTTL))
	}
	return s.q.InsertSession(ctx, sqlcgen.InsertSessionParams{ID: uuid.New(), UserID: u.ID, Kind: kind, DeviceName: device,
		CreatedAt: now, IdleExpiresAt: minTime(now.Add(IdleTTL), abs), AbsoluteExpiresAt: abs,
		AccessHash: accessHash, AccessExpiresAt: accessExp, RefreshHash: refreshHash})
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func tokenPair(access, refresh string, sess sqlcgen.Session, u sqlcgen.User) wire.TokenPair {
	return wire.TokenPair{AccessToken: access, TokenType: "Bearer", ExpiresIn: int(AccessTTL.Seconds()),
		RefreshToken: refresh, Session: sessionView(sess), User: userView(u)}
}

func cleanDevice(name string) (string, error) {
	n := strings.TrimSpace(name)
	if n == "" || utf8.RuneCountInString(n) > 128 {
		return "", apperr.Validation("deviceName must be 1-128 characters")
	}
	return n, nil
}

// LoginNative creates a native session and returns opaque credentials.
func (s *Service) LoginNative(ctx context.Context, in wire.Login) (wire.TokenPair, error) {
	device, err := cleanDevice(in.DeviceName)
	if err != nil {
		return wire.TokenPair{}, err
	}
	u, err := s.authenticatePassword(ctx, in.Username, in.Password)
	if err != nil {
		return wire.TokenPair{}, err
	}
	access, ah, err := NewToken()
	if err != nil {
		return wire.TokenPair{}, err
	}
	refresh, rh, err := NewToken()
	if err != nil {
		return wire.TokenPair{}, err
	}
	sess, err := s.newSession(ctx, u, "native", device, ah, rh)
	if err != nil {
		return wire.TokenPair{}, unavailable(err)
	}
	return tokenPair(access, refresh, sess, u), nil
}

// LoginWeb creates a browser session; the cookie token is returned separately
// and never appears in the JSON body.
func (s *Service) LoginWeb(ctx context.Context, in wire.Login) (cookieToken string, expires time.Time, bs wire.BrowserSession, err error) {
	device, err := cleanDevice(in.DeviceName)
	if err != nil {
		return "", time.Time{}, bs, err
	}
	u, err := s.authenticatePassword(ctx, in.Username, in.Password)
	if err != nil {
		return "", time.Time{}, bs, err
	}
	tok, hash, err := NewToken()
	if err != nil {
		return "", time.Time{}, bs, err
	}
	sess, err := s.newSession(ctx, u, "web", device, hash, nil)
	if err != nil {
		return "", time.Time{}, bs, unavailable(err)
	}
	return tok, sess.IdleExpiresAt, wire.BrowserSession{User: userView(u), Session: sessionView(sess), CSRFToken: CSRFFor(tok)}, nil
}

// ---- authentication ---------------------------------------------------

// Credential is what a request presented. Exactly one may be set.
type Credential struct {
	Bearer string
	Cookie string
}

// Authenticate validates the credential against the current session, account
// state and clock. It renews idle use on success only; denied requests never
// move a deadline.
func (s *Service) Authenticate(ctx context.Context, c Credential) (*Principal, error) {
	if c.Bearer != "" && c.Cookie != "" {
		return nil, apperr.ErrAmbiguous
	}
	token, kind := c.Bearer, "native"
	if c.Cookie != "" {
		token, kind = c.Cookie, "web"
	}
	if token == "" {
		return nil, apperr.ErrUnauthenticated
	}
	row, err := s.q.GetSessionByAccessHash(ctx, HashToken(token))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperr.ErrUnauthenticated
	}
	if err != nil {
		return nil, unavailable(err)
	}
	if row.Kind != kind {
		return nil, apperr.ErrUnauthenticated
	}
	now := s.now()
	switch {
	case row.RevokedAt != nil:
		return nil, apperr.ErrSessionRevoked
	case !now.Before(row.AbsoluteExpiresAt) || !now.Before(row.IdleExpiresAt):
		return nil, apperr.New(http.StatusUnauthorized, "session_expired", "The session has expired; sign in again.")
	case !row.UserActive:
		return nil, apperr.ErrSessionRevoked
	case kind == "native" && (row.AccessExpiresAt == nil || !now.Before(*row.AccessExpiresAt)):
		return nil, apperr.ErrTokenExpired
	}
	if now.Sub(row.LastUsedAt) >= touchEvery {
		if err := s.q.TouchSession(ctx, sqlcgen.TouchSessionParams{ID: row.ID, LastUsedAt: now, IdleExpiresAt: now.Add(IdleTTL)}); err != nil {
			return nil, unavailable(err)
		}
	}
	p := &Principal{UserID: row.UserID, SessionID: row.ID, Kind: kind, IsAdmin: row.UserIsAdmin, DeviceName: row.DeviceName}
	if kind == "web" {
		p.CookieToken = token
	}
	return p, nil
}

// CurrentSession returns the principal's session view (for GET /auth/web/session).
func (s *Service) CurrentSession(ctx context.Context, p *Principal) (wire.BrowserSession, error) {
	sess, err := s.q.GetSession(ctx, p.SessionID)
	if err != nil {
		return wire.BrowserSession{}, unavailable(err)
	}
	u, err := s.q.GetUser(ctx, p.UserID)
	if err != nil {
		return wire.BrowserSession{}, unavailable(err)
	}
	return wire.BrowserSession{User: userView(u), Session: sessionView(sess), CSRFToken: CSRFFor(p.CookieToken)}, nil
}

// Sessions lists only the caller's live device sessions.
func (s *Service) Sessions(ctx context.Context, userID uuid.UUID) (wire.Sessions, error) {
	rows, err := s.q.ListLiveSessions(ctx, sqlcgen.ListLiveSessionsParams{UserID: userID, IdleExpiresAt: s.now()})
	if err != nil {
		return wire.Sessions{}, unavailable(err)
	}
	out := wire.Sessions{Items: make([]wire.Session, 0, len(rows))}
	for _, r := range rows {
		out.Items = append(out.Items, sessionView(r))
	}
	return out, nil
}

// Logout revokes the principal's current session only.
func (s *Service) Logout(ctx context.Context, p *Principal) error {
	_, err := s.q.RevokeSession(ctx, sqlcgen.RevokeSessionParams{ID: p.SessionID, RevokedAt: ptr(s.now()), RevokedReason: ptr("logout")})
	return unavailable(err)
}

// RevokeOwn revokes one of the caller's own sessions; any other ID is 404.
func (s *Service) RevokeOwn(ctx context.Context, userID, sessionID uuid.UUID) error {
	sess, err := s.q.GetSession(ctx, sessionID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (sess.UserID != userID || sess.RevokedAt != nil)) {
		return apperr.ErrNotFound
	}
	if err != nil {
		return unavailable(err)
	}
	_, err = s.q.RevokeSession(ctx, sqlcgen.RevokeSessionParams{ID: sessionID, RevokedAt: ptr(s.now()), RevokedReason: ptr("device_revoked")})
	return unavailable(err)
}

// ---- refresh -------------------------------------------------------------

type refreshOutcome struct {
	body []byte
	err  error
}

// Refresh performs the serialized refresh transaction keyed by session,
// presented refresh generation and requestId (ADR-0033). It returns the
// JSON-encoded TokenPair so identical retries are byte-identical.
func (s *Service) Refresh(ctx context.Context, in wire.Refresh) ([]byte, error) {
	reqID, err := uuid.Parse(in.RequestID)
	if err != nil {
		return nil, apperr.Validation("requestId must be a UUID")
	}
	h := HashToken(in.RefreshToken)
	var out refreshOutcome

	txErr := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		now := s.now()

		sess, err := q.GetSessionByRefreshHashForUpdate(ctx, h)
		if err == nil {
			// Current generation: validate then rotate exactly once.
			if sess.RevokedAt != nil {
				out.err = apperr.ErrSessionRevoked
				return nil
			}
			if !now.Before(sess.AbsoluteExpiresAt) || !now.Before(sess.IdleExpiresAt) {
				out.err = apperr.New(http.StatusUnauthorized, "session_expired", "The session has expired; sign in again.")
				return nil
			}
			u, err := q.GetUser(ctx, sess.UserID)
			if err != nil {
				return err
			}
			if !u.Active {
				out.err = apperr.ErrSessionRevoked
				return nil
			}
			access, ah, err := NewToken()
			if err != nil {
				return err
			}
			refresh, rh, err := NewToken()
			if err != nil {
				return err
			}
			next, err := q.RotateSession(ctx, sqlcgen.RotateSessionParams{ID: sess.ID, RefreshHash: rh, AccessHash: ah,
				AccessExpiresAt: ptr(now.Add(AccessTTL)), LastUsedAt: now, IdleExpiresAt: now.Add(IdleTTL)})
			if err != nil {
				return err
			}
			body := wire.Raw(tokenPair(access, refresh, next, u))
			sealed, err := seal(s.key, body, append(sess.ID[:], h...))
			if err != nil {
				return err
			}
			if err := q.InsertExchange(ctx, sqlcgen.InsertExchangeParams{SessionID: sess.ID, OldRefreshHash: h, RequestID: reqID,
				Generation: sess.RefreshGeneration, CreatedAt: now, ResponseCiphertext: sealed}); err != nil {
				return err
			}
			out.body = body
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		// Not the current token: classify as retry, late retry or reuse.
		ex, err := q.GetExchangeByOldHash(ctx, h)
		if errors.Is(err, pgx.ErrNoRows) {
			out.err = apperr.ErrInvalidCredentials
			return nil
		}
		if err != nil {
			return err
		}
		sess, err = q.GetSessionForUpdate(ctx, ex.SessionID)
		if err != nil {
			return err
		}
		if sess.RevokedAt != nil {
			out.err = apperr.ErrSessionRevoked
			return nil
		}
		if ex.RequestID != reqID {
			// Different exchange with an old token: revoke this device session only.
			if _, err := q.RevokeSession(ctx, sqlcgen.RevokeSessionParams{ID: sess.ID, RevokedAt: ptr(now), RevokedReason: ptr("refresh_reuse")}); err != nil {
				return err
			}
			if err := q.ClearSessionExchangeResponses(ctx, sess.ID); err != nil {
				return err
			}
			out.err = apperr.ErrRefreshReuse
			return nil
		}
		if now.Sub(ex.CreatedAt) < RefreshRecover && ex.ResponseCiphertext != nil {
			body, err := open(s.key, ex.ResponseCiphertext, append(sess.ID[:], h...))
			if err != nil {
				return err
			}
			out.body = body
			return nil
		}
		out.err = apperr.ErrRefreshRetryExpiry
		return nil
	})
	if txErr != nil {
		return nil, unavailable(txErr)
	}
	if out.err != nil {
		return nil, out.err
	}
	return out.body, nil
}

// PurgeExpiredExchanges deletes protected refresh responses older than 60 seconds.
func (s *Service) PurgeExpiredExchanges(ctx context.Context) (int64, error) {
	n, err := s.q.ClearExpiredExchangeResponses(ctx, s.now().Add(-RefreshRecover))
	return n, unavailable(err)
}

// Decode is a convenience for tests.
func DecodeTokenPair(b []byte) (wire.TokenPair, error) {
	var tp wire.TokenPair
	err := json.Unmarshal(b, &tp)
	return tp, err
}
