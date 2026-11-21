-- name: ListLibraryEditionPaths :many
-- Every ebook edition of a library with the current path of its file.
SELECT e.id AS edition_id, o.rel_path
FROM editions e
JOIN file_observations o ON o.file_id = e.file_id AND NOT o.missing
WHERE e.library_id = $1
ORDER BY o.rel_path;

-- name: UpsertEditionAssociation :exec
INSERT INTO associations (library_id, kind, rel_path, recording_id, edition_id, state, detail)
VALUES ($1, $2, $3, NULL, $4, $5, $6)
ON CONFLICT (library_id, rel_path) DO UPDATE SET kind = EXCLUDED.kind, recording_id = NULL, edition_id = EXCLUDED.edition_id,
    state = EXCLUDED.state, detail = EXCLUDED.detail;

-- name: ListLibraryEditionAssociated :many
SELECT kind, rel_path, edition_id FROM associations
WHERE library_id = $1 AND state = 'associated' AND kind IN ('json', 'opf') AND edition_id IS NOT NULL ORDER BY rel_path;

-- name: ListEditionsWithSidecarValues :many
SELECT DISTINCT v.edition_id FROM edition_metadata_values v JOIN editions e ON e.id = v.edition_id
WHERE e.library_id = $1 AND v.source = 'sidecar';

-- name: GetRecordingCreatedAt :one
SELECT created_at FROM recordings WHERE id = $1;

-- name: SetLibraryIcon :one
UPDATE libraries SET icon = $2 WHERE id = $1 RETURNING *;
