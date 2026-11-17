-- name: EnsureEditionPosition :exec
INSERT INTO edition_position_state (user_id, edition_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: LockEditionPosition :one
SELECT * FROM edition_position_state WHERE user_id = $1 AND edition_id = $2 FOR UPDATE;

-- name: GetEditionPosition :one
SELECT * FROM edition_position_state WHERE user_id = $1 AND edition_id = $2;

-- name: SetEditionPosition :exec
UPDATE edition_position_state
SET revision = revision + 1, file_id = $3, content_version = $4, locator = $5,
    captured_at = $6, received_at = $7, device_name = $8
WHERE user_id = $1 AND edition_id = $2;

-- name: UpsertEditionPositionEvidence :exec
INSERT INTO edition_position_evidence (user_id, edition_id, session_id, file_id, content_version, locator, captured_at, received_at, device_name)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (user_id, edition_id, session_id) DO UPDATE SET file_id = EXCLUDED.file_id,
    content_version = EXCLUDED.content_version, locator = EXCLUDED.locator, captured_at = EXCLUDED.captured_at,
    received_at = EXCLUDED.received_at, device_name = EXCLUDED.device_name;

-- name: EnsureEditionCompletion :exec
INSERT INTO edition_completion_state (user_id, edition_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: LockEditionCompletion :one
SELECT * FROM edition_completion_state WHERE user_id = $1 AND edition_id = $2 FOR UPDATE;

-- name: GetEditionCompletion :one
SELECT * FROM edition_completion_state WHERE user_id = $1 AND edition_id = $2;

-- name: SetEditionCompletion :exec
UPDATE edition_completion_state SET revision = revision + 1, finished = $3, changed_at = $4
WHERE user_id = $1 AND edition_id = $2;

-- name: InsertEditionHistory :exec
INSERT INTO edition_history (user_id, title_id, edition_id, file_id, content_version, event, operation_id, captured_at, received_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: ListEditionHistory :many
SELECT h.id, h.edition_id, h.title_id, h.file_id, h.content_version, h.event, h.captured_at, h.received_at
FROM edition_history h
JOIN editions e ON e.id = h.edition_id
JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = h.user_id
WHERE h.user_id = $1 AND h.title_id = $2
ORDER BY h.seq LIMIT $3 OFFSET $4;

-- name: CountEditionHistory :one
SELECT count(*)
FROM edition_history h
JOIN editions e ON e.id = h.edition_id
JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = h.user_id
WHERE h.user_id = $1 AND h.title_id = $2;

-- name: GetT005Receipt :one
SELECT * FROM t005_receipts WHERE user_id = $1 AND operation_id = $2;

-- name: InsertT005Receipt :exec
INSERT INTO t005_receipts (user_id, operation_id, fingerprint, status, body) VALUES ($1, $2, $3, $4, $5);

-- name: InsertT005Conflict :one
INSERT INTO t005_conflicts (user_id, resource_kind, resource_id, edition_id, reason, operation_id, candidate, base_revision, current_revision)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;

-- name: GetT005Conflict :one
SELECT * FROM t005_conflicts WHERE id = $1;

-- name: LockT005Conflict :one
SELECT * FROM t005_conflicts WHERE id = $1 FOR UPDATE;

-- name: ResolveT005Conflict :exec
UPDATE t005_conflicts SET resolved_at = $2, resolved_operation_id = $3, resolved_revision = $4 WHERE id = $1;

-- name: ListT005Conflicts :many
SELECT * FROM t005_conflicts c
WHERE c.user_id = sqlc.arg(user_id)
  AND (sqlc.narg(resource_id)::uuid IS NULL OR c.resource_id = sqlc.narg(resource_id))
  AND (sqlc.arg(include_resolved)::boolean OR c.resolved_at IS NULL)
  AND (c.edition_id IS NULL OR EXISTS (
        SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = c.user_id
        WHERE e.id = c.edition_id))
ORDER BY c.created_at, c.id
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountT005Conflicts :one
SELECT count(*) FROM t005_conflicts c
WHERE c.user_id = sqlc.arg(user_id)
  AND (sqlc.narg(resource_id)::uuid IS NULL OR c.resource_id = sqlc.narg(resource_id))
  AND (sqlc.arg(include_resolved)::boolean OR c.resolved_at IS NULL)
  AND (c.edition_id IS NULL OR EXISTS (
        SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = c.user_id
        WHERE e.id = c.edition_id));

-- name: CountOpenEditionConflicts :one
SELECT count(*) FROM t005_conflicts
WHERE user_id = $1 AND resource_id = $2 AND resource_kind = 'position' AND resolved_at IS NULL;
