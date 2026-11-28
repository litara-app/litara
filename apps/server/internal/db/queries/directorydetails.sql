-- Saved author and series details (ADR-0102 to ADR-0105).

-- name: DirectoryName :one
-- The most common spelling of an author or series among the titles the user can see. No row when they see none, which
-- is also who may read or edit its details.
SELECT n.name::text AS name, lower(n.name)::text AS name_key
FROM titles t
CROSS JOIN LATERAL unnest(CASE WHEN sqlc.arg(kind)::text = 'author' THEN t.authors ELSE ARRAY[t.series_name] END) AS n(name)
WHERE lower(n.name) = lower(sqlc.arg(name)::text) AND btrim(n.name) <> ''
  AND (EXISTS (SELECT 1 FROM title_holdings h JOIN user_library_grants g ON g.library_id = h.library_id AND g.user_id = sqlc.arg(user_id) WHERE h.title_id = t.id))
GROUP BY n.name
ORDER BY count(*) DESC, n.name
LIMIT 1;

-- name: GuessLastName :one
SELECT guess_last_name(sqlc.arg(name)::text)::text;

-- name: EnsureDirectoryEntry :exec
INSERT INTO directory_entries (kind, name_key) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: LockDirectoryEntry :one
SELECT revision FROM directory_entries WHERE kind = $1 AND name_key = $2 FOR UPDATE;

-- name: GetDirectoryRevision :one
SELECT COALESCE((SELECT revision FROM directory_entries WHERE kind = $1 AND name_key = $2), 0)::bigint;

-- name: BumpDirectoryEntry :exec
UPDATE directory_entries SET revision = revision + 1 WHERE kind = $1 AND name_key = $2;

-- name: ListDirectoryValues :many
SELECT field, value, locked, provider, provider_url FROM directory_values WHERE kind = $1 AND name_key = $2;

-- name: UpsertDirectoryValue :exec
INSERT INTO directory_values (kind, name_key, field, value, updated_by, provider, provider_url) VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (kind, name_key, field) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by,
  provider = EXCLUDED.provider, provider_url = EXCLUDED.provider_url, updated_at = now();

-- name: SetDirectoryValueLock :exec
UPDATE directory_values SET locked = $4, updated_at = now() WHERE kind = $1 AND name_key = $2 AND field = $3;

-- name: DeleteDirectoryValue :exec
DELETE FROM directory_values WHERE kind = $1 AND name_key = $2 AND field = $3;

-- name: GetAuthorPhoto :one
SELECT source, image, locked, version FROM author_photos WHERE name_key = $1;

-- name: GetAuthorPhotoMeta :one
SELECT source, locked, version, provider, provider_url FROM author_photos WHERE name_key = $1;

-- name: UpsertAuthorPhoto :exec
INSERT INTO author_photos (name_key, source, image, updated_by, provider, provider_url) VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (name_key) DO UPDATE
SET source = EXCLUDED.source, image = EXCLUDED.image, updated_by = EXCLUDED.updated_by,
  provider = EXCLUDED.provider, provider_url = EXCLUDED.provider_url, version = gen_random_uuid(), updated_at = now();

-- name: SetAuthorPhotoLock :exec
UPDATE author_photos SET locked = $2, updated_at = now() WHERE name_key = $1;

-- name: DeleteAuthorPhoto :exec
DELETE FROM author_photos WHERE name_key = $1;
