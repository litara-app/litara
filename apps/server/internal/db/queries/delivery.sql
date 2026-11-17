-- name: EnsureSmtpConfig :exec
INSERT INTO smtp_configs (owner_kind, user_id) VALUES (sqlc.arg(owner_kind), sqlc.narg(user_id)) ON CONFLICT DO NOTHING;

-- name: GetServerSmtp :one
SELECT * FROM smtp_configs WHERE owner_kind = 'server';

-- name: GetPersonalSmtp :one
SELECT * FROM smtp_configs WHERE owner_kind = 'personal' AND user_id = $1;

-- name: LockServerSmtp :one
SELECT * FROM smtp_configs WHERE owner_kind = 'server' FOR UPDATE;

-- name: LockPersonalSmtp :one
SELECT * FROM smtp_configs WHERE owner_kind = 'personal' AND user_id = $1 FOR UPDATE;

-- name: UpdateSmtp :one
UPDATE smtp_configs
SET revision = revision + 1, enabled = $2, host = $3, port = $4, tls_mode = $5, username = $6, from_address = $7,
    key_id = $8, nonce = $9, ciphertext = $10, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: GetRecipientAny :one
SELECT * FROM delivery_recipients WHERE id = $1;

-- name: GetOwnRecipientForUpdate :one
SELECT * FROM delivery_recipients WHERE id = $1 AND user_id = $2 FOR UPDATE;

-- name: CountActiveRecipients :one
SELECT count(*) FROM delivery_recipients WHERE user_id = $1 AND NOT deleted;

-- name: InsertRecipient :one
INSERT INTO delivery_recipients (id, user_id, name, address, revision) VALUES ($1, $2, $3, $4, 1) RETURNING *;

-- name: UpdateRecipient :one
UPDATE delivery_recipients SET name = $2, address = $3, revision = revision + 1 WHERE id = $1 RETURNING *;

-- name: TombstoneRecipient :one
UPDATE delivery_recipients SET deleted = true, revision = revision + 1 WHERE id = $1 RETURNING *;

-- name: ListActiveRecipients :many
SELECT * FROM delivery_recipients WHERE user_id = $1 AND NOT deleted ORDER BY created_at, id;

-- name: CountRecentDeliveries :one
SELECT count(*) FROM deliveries WHERE user_id = $1 AND created_at > $2;

-- name: InsertDelivery :one
INSERT INTO deliveries (user_id, file_id, content_version, recipient_id, recipient_revision, recipient_name, recipient_address,
                        transport, transport_revision, state, resend_of, next_attempt_at, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', $10, $11, $11, $11)
RETURNING *;

-- name: GetOwnDelivery :one
SELECT * FROM deliveries WHERE id = $1 AND user_id = $2;

-- name: GetDeliveryForUpdate :one
SELECT * FROM deliveries WHERE id = $1 FOR UPDATE;

-- name: GetOwnDeliveryForUpdate :one
SELECT * FROM deliveries WHERE id = $1 AND user_id = $2 FOR UPDATE;

-- name: ListDeliveries :many
SELECT * FROM deliveries WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT $2 OFFSET $3;

-- name: CountDeliveries :one
SELECT count(*) FROM deliveries WHERE user_id = $1;

-- name: SetDeliveryState :one
UPDATE deliveries
SET state = $2, code = $3, attempts = $4, attempt_open = $5, next_attempt_at = $6, revision = revision + 1, updated_at = $7
WHERE id = $1
RETURNING *;

-- name: GetConfigByID :one
SELECT * FROM smtp_configs WHERE id = $1;

-- name: GetUserActive :one
SELECT active FROM users WHERE id = $1;

-- name: SetDeliveryStateSending :one
UPDATE deliveries SET state = 'sending', attempts = attempts + 1, attempt_open = false, revision = revision + 1, updated_at = $2, lease_until = $3
WHERE id = $1 RETURNING *;

-- name: MarkSubmissionBoundary :one
UPDATE deliveries SET attempt_open = true, revision = revision + 1 WHERE id = $1 AND state = 'sending' RETURNING *;
