-- name: GetExtraction :one
SELECT * FROM comic_extractions WHERE file_id = $1 AND content_version = $2 AND profile = $3;

-- name: GetExtractionByID :one
SELECT * FROM comic_extractions WHERE id = $1;

-- name: InsertExtraction :one
INSERT INTO comic_extractions (file_id, content_version, profile, status)
VALUES ($1, $2, $3, $4)
ON CONFLICT (file_id, content_version, profile) DO NOTHING
RETURNING *;

-- name: SetExtractionProcessing :exec
UPDATE comic_extractions SET status = 'processing', manifest_version = gen_random_uuid(), pages = '[]', issues = '[]',
    cache_bytes = 0, reserved_bytes = 0, updated_at = now(), last_used_at = now() WHERE id = $1;

-- name: SetExtractionResult :exec
UPDATE comic_extractions SET status = $2, pages = $3, issues = $4, cache_bytes = $5, reserved_bytes = 0, updated_at = now() WHERE id = $1;

-- name: SetExtractionReserved :exec
UPDATE comic_extractions SET reserved_bytes = $2, updated_at = now() WHERE id = $1;

-- name: TouchExtraction :exec
UPDATE comic_extractions SET last_used_at = now() WHERE id = $1;

-- name: SumCacheExcluding :one
SELECT COALESCE(sum(cache_bytes + reserved_bytes), 0)::bigint FROM comic_extractions WHERE id <> $1;

-- name: ListEvictableExtractions :many
SELECT * FROM comic_extractions
WHERE status = 'ready' AND cache_bytes > 0 AND id <> $1 AND last_used_at < now() - make_interval(secs => sqlc.arg(inactive_secs)::float8)
ORDER BY last_used_at, id;

-- name: EvictExtraction :exec
UPDATE comic_extractions SET status = 'incomplete', pages = '[]', cache_bytes = 0, reserved_bytes = 0,
    issues = '[{"code":"cache_evicted","detail":"The page cache entry was evicted; request the pages again."}]', updated_at = now()
WHERE id = $1;

-- name: GetFileVersionForExtraction :one
SELECT locator, size_bytes, current, available FROM file_versions WHERE file_id = $1 AND content_version = $2;

-- name: FirstGrantedEditionFormat :one
SELECT e.format FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = $2
WHERE e.file_id = $1 ORDER BY e.id LIMIT 1;
