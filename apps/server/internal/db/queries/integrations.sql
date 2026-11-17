-- name: GetIntegrationSettings :one
SELECT * FROM integration_settings WHERE singleton;

-- name: LockIntegrationSettings :one
SELECT * FROM integration_settings WHERE singleton FOR UPDATE;

-- name: UpdateIntegrationSettings :one
UPDATE integration_settings
SET revision = revision + 1, opds_enabled = $1, email_enabled = $2, koreader_enabled = $3,
    max_attachment_bytes = $4, max_deliveries_per_hour = $5, updated_at = now()
WHERE singleton
RETURNING *;

-- name: LockUserRow :one
SELECT id FROM users WHERE id = $1 FOR UPDATE;

-- name: CountActiveCredentials :one
SELECT count(*) FROM integration_credentials WHERE user_id = $1 AND revoked_at IS NULL;

-- name: InsertCredential :one
INSERT INTO integration_credentials (user_id, kind, username, label, verifier)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListActiveCredentials :many
SELECT * FROM integration_credentials WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at, id;

-- name: GetOwnCredentialForUpdate :one
SELECT * FROM integration_credentials WHERE id = $1 AND user_id = $2 FOR UPDATE;

-- name: RevokeCredential :one
UPDATE integration_credentials SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 RETURNING *;

-- name: GetCredentialForAuth :one
-- Account activity and revocation are evaluated in the same statement as the lookup.
SELECT c.id, c.user_id, c.kind, c.username, c.verifier, u.active AS user_active, c.revoked_at
FROM integration_credentials c JOIN users u ON u.id = c.user_id
WHERE c.username = $1 AND c.kind = $2;

-- name: TouchCredential :exec
UPDATE integration_credentials SET last_used_at = now()
WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');
