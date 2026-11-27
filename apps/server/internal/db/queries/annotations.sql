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
INSERT INTO annotations (user_id, id, edition_id, kind, file_id, content_version, locator, selection, text, quote, color, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, sqlc.narg(color), sqlc.arg(created_at), sqlc.arg(created_at));

-- name: UpdateAnnotation :exec
UPDATE annotations SET revision = revision + 1, file_id = $3, content_version = $4, locator = $5, selection = $6,
    text = $7, quote = $8, color = sqlc.narg(color), updated_at = sqlc.arg(updated_at)
WHERE user_id = $1 AND id = $2;

-- name: TombstoneAnnotation :exec
UPDATE annotations SET revision = revision + 1, deleted = true, updated_at = $3 WHERE user_id = $1 AND id = $2;

-- The annotations hub (ADR-0099): the caller's live annotations on editions they can still see, newest change first.
-- pattern is '' for no search, otherwise an ILIKE pattern with wildcards already escaped.
-- name: ListHubAnnotations :many
SELECT a.id, a.edition_id, a.revision, a.kind, a.file_id, a.content_version, a.locator, a.selection, a.text, a.quote, a.color,
       a.created_at, a.updated_at, t.id AS title_id, t.title AS title_name, t.authors, e.label AS edition_label, e.format
FROM annotations a
JOIN editions e ON e.id = a.edition_id
JOIN titles t ON t.id = e.title_id
JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = a.user_id
WHERE a.user_id = sqlc.arg(user_id) AND NOT a.deleted
  AND (sqlc.arg(kind)::text = '' OR a.kind = sqlc.arg(kind)::text)
  AND (sqlc.narg(title_id)::uuid IS NULL OR t.id = sqlc.narg(title_id)::uuid)
  AND (sqlc.arg(pattern)::text = '' OR a.text ILIKE sqlc.arg(pattern)::text OR a.quote ILIKE sqlc.arg(pattern)::text
       OR t.title ILIKE sqlc.arg(pattern)::text OR array_to_string(t.authors, ' ') ILIKE sqlc.arg(pattern)::text)
ORDER BY a.updated_at DESC, a.id
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountHubAnnotations :one
SELECT count(*)
FROM annotations a
JOIN editions e ON e.id = a.edition_id
JOIN titles t ON t.id = e.title_id
JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = a.user_id
WHERE a.user_id = sqlc.arg(user_id) AND NOT a.deleted
  AND (sqlc.arg(kind)::text = '' OR a.kind = sqlc.arg(kind)::text)
  AND (sqlc.narg(title_id)::uuid IS NULL OR t.id = sqlc.narg(title_id)::uuid)
  AND (sqlc.arg(pattern)::text = '' OR a.text ILIKE sqlc.arg(pattern)::text OR a.quote ILIKE sqlc.arg(pattern)::text
       OR t.title ILIKE sqlc.arg(pattern)::text OR array_to_string(t.authors, ' ') ILIKE sqlc.arg(pattern)::text);

-- name: ListHubAnnotationTitles :many
SELECT t.id AS title_id, t.title AS title_name, t.authors, count(*) AS annotations
FROM annotations a
JOIN editions e ON e.id = a.edition_id
JOIN titles t ON t.id = e.title_id
JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = a.user_id
WHERE a.user_id = sqlc.arg(user_id) AND NOT a.deleted
GROUP BY t.id, t.title, t.authors
ORDER BY lower(t.title), t.id;
