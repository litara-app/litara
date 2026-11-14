-- name: EnsurePositionState :exec
INSERT INTO position_state (user_id, recording_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: LockPositionState :one
SELECT * FROM position_state WHERE user_id = $1 AND recording_id = $2 FOR UPDATE;

-- name: GetPositionState :one
SELECT * FROM position_state WHERE user_id = $1 AND recording_id = $2;

-- name: SetPositionState :exec
UPDATE position_state SET revision = $3, file_id = $4, content_version = $5, offset_ms = $6,
    layout_revision = $7, captured_at = $8, received_at = $9, device_name = $10
WHERE user_id = $1 AND recording_id = $2;

-- name: UpsertEvidence :exec
INSERT INTO position_evidence (user_id, recording_id, session_id, file_id, content_version, offset_ms,
                               layout_revision, captured_at, received_at, device_name)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (user_id, recording_id, session_id) DO UPDATE SET file_id = EXCLUDED.file_id,
    content_version = EXCLUDED.content_version, offset_ms = EXCLUDED.offset_ms,
    layout_revision = EXCLUDED.layout_revision, captured_at = EXCLUDED.captured_at,
    received_at = EXCLUDED.received_at, device_name = EXCLUDED.device_name;

-- name: EnsureCompletionState :exec
INSERT INTO completion_state (user_id, recording_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: LockCompletionState :one
SELECT * FROM completion_state WHERE user_id = $1 AND recording_id = $2 FOR UPDATE;

-- name: GetCompletionState :one
SELECT * FROM completion_state WHERE user_id = $1 AND recording_id = $2;

-- name: SetCompletionState :exec
UPDATE completion_state SET revision = $3, finished = $4, changed_at = $5
WHERE user_id = $1 AND recording_id = $2;

-- name: InsertHistory :exec
INSERT INTO completion_history (user_id, title_id, recording_id, event, operation_id, captured_at, received_at)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: GetReceipt :one
SELECT * FROM operation_receipts WHERE user_id = $1 AND recording_id = $2 AND operation_id = $3;

-- name: InsertReceipt :exec
INSERT INTO operation_receipts (user_id, recording_id, operation_id, kind, fingerprint, status, body)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: InsertConflict :one
INSERT INTO conflicts (user_id, recording_id, kind, reason, operation_id, candidate, base_revision, layout_revision, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetConflictForUpdate :one
SELECT * FROM conflicts WHERE id = $1 AND user_id = $2 AND recording_id = $3 FOR UPDATE;

-- name: ListOpenConflicts :many
SELECT * FROM conflicts WHERE user_id = $1 AND recording_id = $2 AND resolved_at IS NULL
ORDER BY created_at, id;

-- name: ResolveConflictRow :exec
UPDATE conflicts SET resolved_at = $2, resolved_operation_id = $3 WHERE id = $1;
