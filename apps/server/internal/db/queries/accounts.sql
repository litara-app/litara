-- name: LockBootstrap :exec
SELECT pg_advisory_xact_lock(7001001);

-- name: GetServerIdentity :one
SELECT server_id FROM server_identity WHERE singleton;

-- name: InsertServerIdentity :exec
INSERT INTO server_identity (singleton, server_id) VALUES (true, $1) ON CONFLICT DO NOTHING;

-- name: CountUsers :one
SELECT count(*) FROM users;

-- name: InsertUser :one
INSERT INTO users (username_key, username, display_name, password_hash, is_admin)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetUser :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserForUpdate :one
SELECT * FROM users WHERE id = $1 FOR UPDATE;

-- name: GetUserByKey :one
SELECT * FROM users WHERE username_key = $1;

-- name: ListUsers :many
SELECT * FROM users ORDER BY username_key, id LIMIT $1 OFFSET $2;

-- name: UpdateUser :one
UPDATE users SET
    display_name = COALESCE(sqlc.narg(display_name), display_name),
    is_admin     = COALESCE(sqlc.narg(is_admin), is_admin),
    active       = COALESCE(sqlc.narg(active), active),
    updated_at   = now()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: LockActiveAdmins :many
SELECT id FROM users WHERE is_admin AND active ORDER BY id FOR UPDATE;

-- name: SetPasswordHash :exec
UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1;

-- name: UpsertLibrary :one
INSERT INTO libraries (id, name) VALUES ($1, $2)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
RETURNING *;

-- name: GetLibrary :one
SELECT * FROM libraries WHERE id = $1;

-- name: ListLibrariesForUser :many
SELECT l.* FROM libraries l
JOIN user_library_grants g ON g.library_id = l.id
WHERE g.user_id = $1
ORDER BY l.name, l.id LIMIT $2 OFFSET $3;

-- name: CountLibrariesForUser :one
SELECT count(*) FROM user_library_grants WHERE user_id = $1;

-- name: InsertGrant :exec
INSERT INTO user_library_grants (user_id, library_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: DeleteGrant :execrows
DELETE FROM user_library_grants WHERE user_id = $1 AND library_id = $2;

-- name: HasGrant :one
SELECT EXISTS (SELECT 1 FROM user_library_grants WHERE user_id = $1 AND library_id = $2);

-- name: InsertSession :one
INSERT INTO sessions (id, user_id, kind, device_name, created_at, last_used_at, idle_expires_at,
                      absolute_expires_at, access_hash, access_expires_at, refresh_hash, refresh_generation)
VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, 1)
RETURNING *;

-- name: GetSession :one
SELECT * FROM sessions WHERE id = $1;

-- name: GetSessionByAccessHash :one
SELECT s.*, u.active AS user_active, u.is_admin AS user_is_admin
FROM sessions s JOIN users u ON u.id = s.user_id
WHERE s.access_hash = $1;

-- name: GetSessionByRefreshHashForUpdate :one
SELECT * FROM sessions WHERE refresh_hash = $1 FOR UPDATE;

-- name: GetSessionForUpdate :one
SELECT * FROM sessions WHERE id = $1 FOR UPDATE;

-- name: TouchSession :exec
UPDATE sessions SET last_used_at = $2, idle_expires_at = LEAST($3, absolute_expires_at)
WHERE id = $1 AND revoked_at IS NULL;

-- name: RotateSession :one
UPDATE sessions SET
    refresh_hash = $2, refresh_generation = refresh_generation + 1,
    access_hash = $3, access_expires_at = $4,
    last_used_at = $5, idle_expires_at = LEAST($6, absolute_expires_at)
WHERE id = $1
RETURNING *;

-- name: RevokeSession :execrows
UPDATE sessions SET revoked_at = $2, revoked_reason = $3
WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeUserSessions :execrows
UPDATE sessions SET revoked_at = $2, revoked_reason = $3
WHERE user_id = $1 AND revoked_at IS NULL;

-- name: ListLiveSessions :many
SELECT * FROM sessions
WHERE user_id = $1 AND revoked_at IS NULL AND idle_expires_at > $2 AND absolute_expires_at > $2
ORDER BY created_at, id;

-- name: GetExchangeByOldHash :one
SELECT * FROM refresh_exchanges WHERE old_refresh_hash = $1 LIMIT 1;

-- name: InsertExchange :exec
INSERT INTO refresh_exchanges (session_id, old_refresh_hash, request_id, generation, created_at, response_ciphertext)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: ClearExpiredExchangeResponses :execrows
UPDATE refresh_exchanges SET response_ciphertext = NULL
WHERE response_ciphertext IS NOT NULL AND created_at <= $1;

-- name: ClearSessionExchangeResponses :exec
UPDATE refresh_exchanges SET response_ciphertext = NULL WHERE session_id = $1;

-- name: ClearUserExchangeResponses :exec
UPDATE refresh_exchanges SET response_ciphertext = NULL
WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1);
