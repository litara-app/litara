-- name: GetRecording :one
SELECT r.id, r.title_id, r.library_id, r.narrators, r.layout_revision,
       r.thumbnail_locator, r.thumbnail_mime, r.cover_locator, r.cover_mime,
       t.title, t.authors, t.series_name, t.series_index
FROM recordings r JOIN titles t ON t.id = r.title_id
WHERE r.id = $1;

-- name: ListRecordingFiles :many
SELECT rf.recording_id, rf.sequence, rf.file_id, fv.content_version, fv.filename, fv.mime_type,
       fv.size_bytes, fv.duration_ms, fv.available
FROM recording_files rf
JOIN file_versions fv ON fv.file_id = rf.file_id AND fv.current
WHERE rf.recording_id = ANY(sqlc.arg(recording_ids)::uuid[])
ORDER BY rf.recording_id, rf.sequence;

-- name: ListChapterSources :many
SELECT * FROM chapter_sources WHERE recording_id = $1;

-- name: GetFileVersion :one
SELECT * FROM file_versions WHERE content_version = $1 AND file_id = $2;

-- name: FileExists :one
SELECT EXISTS (SELECT 1 FROM media_files WHERE id = $1);

-- name: GetKnownFileVersion :one
SELECT file_id, current FROM file_versions WHERE content_version = $1;

-- name: ListFileRecordings :many
SELECT r.id AS recording_id, r.library_id,
       EXISTS (SELECT 1 FROM user_library_grants g WHERE g.user_id = $2 AND g.library_id = r.library_id) AS granted
FROM recording_files rf JOIN recordings r ON r.id = rf.recording_id
WHERE rf.file_id = $1
ORDER BY r.id;

-- name: ListRecordingsPage :many
SELECT r.id, r.title_id, r.library_id, r.narrators, r.thumbnail_locator, r.cover_locator,
       t.title, t.authors, t.series_name, t.series_index,
       COALESCE(cs.revision, 0)::bigint AS completion_revision,
       COALESCE(cs.finished, false)::boolean AS completion_finished,
       cs.changed_at AS completion_changed_at,
       ps.received_at AS position_received_at
FROM recordings r
JOIN titles t ON t.id = r.title_id
JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id)
LEFT JOIN completion_state cs ON cs.user_id = g.user_id AND cs.recording_id = r.id
LEFT JOIN position_state ps ON ps.user_id = g.user_id AND ps.recording_id = r.id
WHERE (sqlc.narg(library_id)::uuid IS NULL OR r.library_id = sqlc.narg(library_id))
  AND (sqlc.narg(q)::text IS NULL OR position(lower(sqlc.narg(q)::text) in lower(
         t.title || chr(10) || array_to_string(t.authors, chr(10)) || chr(10) || array_to_string(r.narrators, chr(10)))) > 0)
  AND (sqlc.arg(completion)::text = 'any'
       OR (sqlc.arg(completion)::text = 'finished' AND COALESCE(cs.finished, false))
       OR (sqlc.arg(completion)::text = 'unfinished' AND NOT COALESCE(cs.finished, false)))
ORDER BY
  CASE WHEN sqlc.arg(sort)::text = 'title' THEN lower(t.title) END ASC,
  CASE WHEN sqlc.arg(sort)::text = 'recent' THEN
       GREATEST(COALESCE(ps.received_at, '-infinity'::timestamptz), COALESCE(cs.changed_at, '-infinity'::timestamptz)) END DESC,
  t.title ASC, r.id ASC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountRecordingsPage :one
SELECT count(*)
FROM recordings r
JOIN titles t ON t.id = r.title_id
JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id)
LEFT JOIN completion_state cs ON cs.user_id = g.user_id AND cs.recording_id = r.id
WHERE (sqlc.narg(library_id)::uuid IS NULL OR r.library_id = sqlc.narg(library_id))
  AND (sqlc.narg(q)::text IS NULL OR position(lower(sqlc.narg(q)::text) in lower(
         t.title || chr(10) || array_to_string(t.authors, chr(10)) || chr(10) || array_to_string(r.narrators, chr(10)))) > 0)
  AND (sqlc.arg(completion)::text = 'any'
       OR (sqlc.arg(completion)::text = 'finished' AND COALESCE(cs.finished, false))
       OR (sqlc.arg(completion)::text = 'unfinished' AND NOT COALESCE(cs.finished, false)));

-- name: GetCompletionSummary :one
SELECT COALESCE(cs.revision, 0)::bigint AS revision,
       COALESCE(cs.finished, false)::boolean AS finished,
       cs.changed_at,
       ps.received_at AS position_received_at
FROM (SELECT 1) one
LEFT JOIN completion_state cs ON cs.user_id = sqlc.arg(user_id) AND cs.recording_id = sqlc.arg(recording_id)
LEFT JOIN position_state ps ON ps.user_id = sqlc.arg(user_id) AND ps.recording_id = sqlc.arg(recording_id);

-- name: ListHistory :many
SELECT h.id, h.recording_id, h.title_id, h.event, h.captured_at, h.received_at
FROM completion_history h
WHERE h.user_id = $1 AND h.title_id = $2
ORDER BY h.seq LIMIT $3 OFFSET $4;

-- name: CountHistory :one
SELECT count(*) FROM completion_history WHERE user_id = $1 AND title_id = $2;

-- name: TitleLibraryIDs :many
SELECT DISTINCT library_id FROM recordings WHERE title_id = $1;

-- name: SeedUpsertTitle :one
INSERT INTO titles (id, title, authors, series_name, series_index, seed_key)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, authors = EXCLUDED.authors,
    series_name = EXCLUDED.series_name, series_index = EXCLUDED.series_index
RETURNING id;

-- name: SeedUpsertRecording :one
INSERT INTO recordings (id, title_id, library_id, narrators, layout_revision, thumbnail_locator, thumbnail_mime,
                        cover_locator, cover_mime, seed_key)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (id) DO UPDATE SET title_id = EXCLUDED.title_id, library_id = EXCLUDED.library_id,
    narrators = EXCLUDED.narrators, thumbnail_locator = EXCLUDED.thumbnail_locator,
    thumbnail_mime = EXCLUDED.thumbnail_mime, cover_locator = EXCLUDED.cover_locator,
    cover_mime = EXCLUDED.cover_mime
RETURNING layout_revision;

-- name: SeedUpsertMediaFile :exec
INSERT INTO media_files (id) VALUES ($1) ON CONFLICT DO NOTHING;

-- name: SeedUpsertFileVersion :exec
INSERT INTO file_versions (content_version, file_id, locator, filename, mime_type, size_bytes, duration_ms, available, current)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (content_version) DO UPDATE SET locator = EXCLUDED.locator, filename = EXCLUDED.filename,
    mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes, duration_ms = EXCLUDED.duration_ms,
    available = EXCLUDED.available, current = EXCLUDED.current;

-- name: ClearOtherCurrentVersions :exec
UPDATE file_versions SET current = false WHERE file_id = $1 AND current AND content_version <> $2;

-- name: DeleteRecordingFiles :exec
DELETE FROM recording_files WHERE recording_id = $1;

-- name: InsertRecordingFile :exec
INSERT INTO recording_files (recording_id, sequence, file_id) VALUES ($1, $2, $3);

-- name: SetLayoutRevision :exec
UPDATE recordings SET layout_revision = $2 WHERE id = $1;

-- name: ListFileRecordingIDs :many
SELECT recording_id FROM recording_files WHERE file_id = $1;

-- name: SeedUpsertChapterSource :exec
INSERT INTO chapter_sources (recording_id, source, starts) VALUES ($1, $2, $3)
ON CONFLICT (recording_id, source) DO UPDATE SET starts = EXCLUDED.starts;

-- name: SetFileAvailability :exec
UPDATE file_versions SET available = $2 WHERE content_version = $1;
