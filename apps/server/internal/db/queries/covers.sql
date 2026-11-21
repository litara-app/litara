-- name: GetTitleCover :one
SELECT * FROM title_covers WHERE title_id = $1 AND medium = $2;

-- name: UpsertTitleCover :one
INSERT INTO title_covers (title_id, medium, source, image, updated_by)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (title_id, medium) DO UPDATE
SET source = EXCLUDED.source, image = EXCLUDED.image, updated_by = EXCLUDED.updated_by, version = gen_random_uuid(), updated_at = now()
RETURNING title_id, medium, source, version;

-- name: DeleteTitleCover :execrows
DELETE FROM title_covers WHERE title_id = $1 AND medium = $2;

-- name: GetCoverSettings :one
SELECT search_enabled FROM cover_settings WHERE singleton;

-- name: SetCoverSearchEnabled :one
UPDATE cover_settings SET search_enabled = $1, updated_at = now() WHERE singleton RETURNING search_enabled;

-- name: ListTitleEbookFiles :many
-- The current files of a title's ebook editions, oldest first, for extracting a cover.
SELECT e.format, fv.locator, fv.size_bytes
FROM editions e JOIN file_versions fv ON fv.file_id = e.file_id AND fv.current AND fv.available
WHERE e.title_id = $1 ORDER BY e.created_at, e.id;

-- name: ListTitleRecordingCovers :many
SELECT r.cover_locator, r.cover_mime FROM active_recordings r
WHERE r.title_id = $1 AND r.cover_locator IS NOT NULL ORDER BY r.created_at, r.id;

-- name: GetEditionTitleForFile :one
SELECT title_id FROM editions WHERE file_id = $1;

-- name: GetRecordingTitleForFile :one
SELECT r.title_id FROM recording_files rf JOIN recordings r ON r.id = rf.recording_id WHERE rf.file_id = $1 LIMIT 1;

-- name: ListRecordingFileIDs :many
SELECT file_id FROM recording_files WHERE recording_id = $1 ORDER BY sequence;
