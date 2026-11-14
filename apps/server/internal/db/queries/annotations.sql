-- name: LockPersonalKey :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(key)::text, 0));

-- name: GetAnnotation :one
SELECT * FROM annotations WHERE user_id = $1 AND id = $2;

-- name: ListAnnotations :many
SELECT * FROM annotations
WHERE user_id = sqlc.arg(user_id) AND edition_id = sqlc.arg(edition_id) AND (sqlc.arg(include_deleted)::boolean OR NOT deleted)
ORDER BY id LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountAnnotations :one
SELECT count(*) FROM annotations
WHERE user_id = sqlc.arg(user_id) AND edition_id = sqlc.arg(edition_id) AND (sqlc.arg(include_deleted)::boolean OR NOT deleted);

-- name: InsertAnnotation :exec
INSERT INTO annotations (user_id, id, edition_id, kind, file_id, content_version, locator, selection, text, quote, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11);

-- name: UpdateAnnotation :exec
UPDATE annotations SET revision = revision + 1, file_id = $3, content_version = $4, locator = $5, selection = $6,
    text = $7, quote = $8, updated_at = $9
WHERE user_id = $1 AND id = $2;

-- name: TombstoneAnnotation :exec
UPDATE annotations SET revision = revision + 1, deleted = true, updated_at = $3 WHERE user_id = $1 AND id = $2;
