-- name: ListUneditionedEbookFiles :many
SELECT o.file_id, v.content_version, o.rel_path, v.filename, v.mime_type
FROM file_observations o
JOIN file_versions v ON v.file_id = o.file_id AND v.current AND v.available
WHERE o.library_id = $1 AND NOT o.missing AND v.mime_type NOT LIKE 'audio/%'
  AND NOT EXISTS (SELECT 1 FROM editions e WHERE e.file_id = o.file_id)
ORDER BY o.rel_path;

-- name: ListLibraryTitlesByKeyAny :many
SELECT t.id, t.identifier FROM titles t
WHERE t.group_key = $2 AND (
  EXISTS (SELECT 1 FROM active_recordings r WHERE r.title_id = t.id AND r.library_id = $1)
  OR EXISTS (SELECT 1 FROM editions e WHERE e.title_id = t.id AND e.library_id = $1))
GROUP BY t.id, t.identifier;

-- name: InsertEditionTitle :exec
INSERT INTO titles (id, title, authors, series_name, series_index, group_key, identifier)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: InsertEdition :exec
INSERT INTO editions (id, title_id, library_id, file_id, label, language, format, link_state)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: GetEditionRow :one
SELECT e.id, e.title_id, e.library_id, e.file_id, e.revision, e.label, e.language, e.format, e.link_state,
       fv.content_version, fv.mime_type, fv.size_bytes, fv.available, COALESCE(o.missing, false)::boolean AS missing,
       COALESCE(fm.result->>'ebookStructure' = 'damaged', false)::boolean AS file_damaged
FROM editions e
JOIN file_versions fv ON fv.file_id = e.file_id AND fv.current
LEFT JOIN file_observations o ON o.file_id = e.file_id
LEFT JOIN file_metadata fm ON fm.content_version = fv.content_version
WHERE e.id = $1;

-- name: ListEditionsPage :many
SELECT e.id, e.title_id, e.library_id, e.file_id, e.revision, e.label, e.language, e.format, e.link_state,
       fv.content_version, fv.mime_type, fv.size_bytes, fv.available, COALESCE(o.missing, false)::boolean AS missing,
       COALESCE(fm.result->>'ebookStructure' = 'damaged', false)::boolean AS file_damaged
FROM editions e
JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id)
JOIN file_versions fv ON fv.file_id = e.file_id AND fv.current
LEFT JOIN file_observations o ON o.file_id = e.file_id
LEFT JOIN file_metadata fm ON fm.content_version = fv.content_version
WHERE (sqlc.narg(library_id)::uuid IS NULL OR e.library_id = sqlc.narg(library_id))
  AND (sqlc.narg(title_id)::uuid IS NULL OR e.title_id = sqlc.narg(title_id))
ORDER BY e.id
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: ListUnassessedEPUBs :many
SELECT fv.content_version, o.rel_path, o.mtime, o.size_bytes, fv.locator
FROM file_observations o
JOIN file_versions fv ON fv.file_id = o.file_id AND fv.current AND fv.available
LEFT JOIN file_metadata fm ON fm.content_version = fv.content_version
WHERE o.library_id = $1 AND NOT o.missing AND lower(fv.filename) LIKE '%.epub'
  AND fm.result->>'ebookStructure' IS NULL
ORDER BY o.rel_path;

-- name: RecordEPUBStructure :exec
INSERT INTO file_metadata (content_version, completeness, result)
SELECT fv.content_version, 'complete', jsonb_build_object('ebookStructure', sqlc.arg(structure)::text)
FROM file_versions fv WHERE fv.content_version = sqlc.arg(content_version) AND fv.current AND fv.available
ON CONFLICT ON CONSTRAINT file_metadata_pkey DO UPDATE
SET result = COALESCE(file_metadata.result, '{}'::jsonb) || EXCLUDED.result, inspected_at = now()
WHERE file_metadata.result->>'ebookStructure' IS NULL;

-- name: CountEditionsPage :one
SELECT count(*)
FROM editions e
JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id)
WHERE (sqlc.narg(library_id)::uuid IS NULL OR e.library_id = sqlc.narg(library_id))
  AND (sqlc.narg(title_id)::uuid IS NULL OR e.title_id = sqlc.narg(title_id));

-- name: ListFileEditions :many
SELECT e.id AS edition_id, e.library_id,
       EXISTS (SELECT 1 FROM user_library_grants g WHERE g.user_id = $2 AND g.library_id = e.library_id) AS granted
FROM editions e WHERE e.file_id = $1 ORDER BY e.id;

-- name: UserHasLibraryGrant :one
SELECT EXISTS (SELECT 1 FROM user_library_grants WHERE user_id = $1 AND library_id = $2);

-- Titles visible to a user: any granted library holds an edition or recording of it.
-- Counts include only granted libraries.
-- name: ListTitleRecordingsPage :many
SELECT r.id, r.library_id, t.title
FROM active_recordings r JOIN titles t ON t.id = r.title_id
JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id)
WHERE r.title_id = sqlc.arg(title_id)
ORDER BY r.id LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountTitleRecordings :one
SELECT count(*) FROM active_recordings r
JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id)
WHERE r.title_id = sqlc.arg(title_id);

-- name: TitleExists :one
SELECT EXISTS (SELECT 1 FROM titles WHERE id = $1);

-- name: GetTitleForUser :many
SELECT t.id, t.title, t.authors, t.series_name,
       (SELECT count(*) FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id) WHERE e.title_id = t.id)::bigint AS edition_count,
       (SELECT count(*) FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id) WHERE r.title_id = t.id)::bigint AS recording_count,
       COALESCE((SELECT array_agg(DISTINCT e.language) FILTER (WHERE e.language IS NOT NULL)
                 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id)
                 WHERE e.title_id = t.id), '{}')::text[] AS languages
FROM titles t WHERE t.id = sqlc.arg(id);

-- name: LockEdition :one
SELECT * FROM editions WHERE id = $1 FOR UPDATE;

-- name: BumpEdition :exec
UPDATE editions SET revision = revision + 1 WHERE id = $1;

-- name: SetEditionLanguage :exec
UPDATE editions SET language = $2 WHERE id = $1;

-- name: SetEditionTitle :exec
UPDATE editions SET title_id = $2, link_state = 'confirmed' WHERE id = $1;

-- name: ListEditionMetadataValues :many
SELECT * FROM edition_metadata_values WHERE edition_id = $1 ORDER BY field, source;

-- name: UpsertEditionMetadataValue :exec
INSERT INTO edition_metadata_values (edition_id, field, source, value, protected_clear)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (edition_id, field, source) DO UPDATE SET value = EXCLUDED.value,
    protected_clear = EXCLUDED.protected_clear, updated_at = now();

-- name: DeleteEditionMetadataValue :execrows
DELETE FROM edition_metadata_values WHERE edition_id = $1 AND field = $2 AND source = $3;

-- name: CountTitleChildren :one
SELECT ((SELECT count(*) FROM editions e WHERE e.title_id = $1) + (SELECT count(*) FROM active_recordings r WHERE r.title_id = $1))::bigint;

-- name: TitleHeldInLibrary :one
SELECT (EXISTS (SELECT 1 FROM editions e WHERE e.title_id = sqlc.arg(title_id) AND e.library_id = sqlc.arg(library_id))
     OR EXISTS (SELECT 1 FROM active_recordings r WHERE r.title_id = sqlc.arg(title_id) AND r.library_id = sqlc.arg(library_id)))::boolean;

-- name: GetEditionFileName :one
SELECT fv.filename FROM editions e JOIN file_versions fv ON fv.file_id = e.file_id AND fv.current WHERE e.id = $1;

-- name: InsertPlainTitle :exec
INSERT INTO titles (id, title, authors, series_name, series_index) VALUES ($1, $2, $3, $4, $5);
