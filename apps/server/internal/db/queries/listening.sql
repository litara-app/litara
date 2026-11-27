-- The same upsert rules as reading sessions: keep the longest listened time and the latest end, so a retry or an
-- out-of-order send never shrinks a session. An id already used for another recording affects no row.
-- name: UpsertListeningSession :execrows
INSERT INTO listening_sessions (user_id, id, recording_id, started_at, ended_at, listened_seconds, start_fraction, end_fraction)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (user_id, id) DO UPDATE SET
  ended_at = GREATEST(listening_sessions.ended_at, EXCLUDED.ended_at),
  listened_seconds = GREATEST(listening_sessions.listened_seconds, EXCLUDED.listened_seconds),
  end_fraction = CASE WHEN EXCLUDED.ended_at >= listening_sessions.ended_at THEN EXCLUDED.end_fraction ELSE listening_sessions.end_fraction END,
  updated_at = now()
WHERE listening_sessions.recording_id = EXCLUDED.recording_id;

-- Sessions on recordings the caller can still see, including recordings that repair has since replaced.
-- name: ListListeningSessionsForTitle :many
SELECT s.id, s.recording_id, r.title_id, s.started_at, s.ended_at, s.listened_seconds, s.start_fraction, s.end_fraction
FROM listening_sessions s
JOIN recordings r ON r.id = s.recording_id
JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = s.user_id
WHERE s.user_id = $1 AND r.title_id = $2
ORDER BY s.started_at DESC, s.id DESC LIMIT $3 OFFSET $4;

-- name: CountListeningSessionsForTitle :one
SELECT count(*) FROM listening_sessions s
JOIN recordings r ON r.id = s.recording_id
JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = s.user_id
WHERE s.user_id = $1 AND r.title_id = $2;

-- name: ListListeningSessionsForStats :many
SELECT s.started_at, s.listened_seconds, r.title_id
FROM listening_sessions s
JOIN recordings r ON r.id = s.recording_id
JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = s.user_id
WHERE s.user_id = $1 AND s.started_at >= sqlc.arg(from_time) AND s.started_at < sqlc.arg(to_time)
ORDER BY s.started_at;

-- name: GetAudioBookmark :one
SELECT * FROM audio_bookmarks WHERE user_id = $1 AND id = $2;

-- name: ListAudioBookmarks :many
SELECT * FROM audio_bookmarks
WHERE user_id = $1 AND recording_id = $2 AND (sqlc.arg(include_deleted)::boolean OR NOT deleted)
ORDER BY created_at, id LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountAudioBookmarks :one
SELECT count(*) FROM audio_bookmarks
WHERE user_id = $1 AND recording_id = $2 AND (sqlc.arg(include_deleted)::boolean OR NOT deleted);

-- name: InsertAudioBookmark :exec
INSERT INTO audio_bookmarks (user_id, id, recording_id, file_id, content_version, offset_ms, layout_revision, note)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: UpdateAudioBookmark :exec
UPDATE audio_bookmarks SET revision = revision + 1, deleted = false, file_id = $3, content_version = $4, offset_ms = $5,
  layout_revision = $6, note = $7, updated_at = now()
WHERE user_id = $1 AND id = $2;

-- name: DeleteAudioBookmark :exec
UPDATE audio_bookmarks SET revision = revision + 1, deleted = true, updated_at = now() WHERE user_id = $1 AND id = $2;

-- name: InsertAudioBookmarkConflict :one
INSERT INTO audio_bookmark_conflicts (user_id, recording_id, bookmark_id, reason, operation_id, candidate, base_revision, current_revision)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;

-- name: ListAudioBookmarkConflicts :many
SELECT * FROM audio_bookmark_conflicts
WHERE user_id = $1 AND recording_id = $2 AND resolved_at IS NULL ORDER BY created_at, id LIMIT 200;

-- name: GetAudioBookmarkConflict :one
SELECT * FROM audio_bookmark_conflicts WHERE id = $1 AND user_id = $2 AND recording_id = $3;

-- name: ResolveAudioBookmarkConflict :exec
UPDATE audio_bookmark_conflicts SET resolved_at = now(), resolved_operation_id = $2 WHERE id = $1;

-- Live bookmarks on repaired source recordings, offered to a successor only where their exact file version is part of
-- it (ADR-0070, ADR-0110).
-- name: ListBookmarksForRepair :many
SELECT * FROM audio_bookmarks WHERE recording_id = ANY(sqlc.arg(recording_ids)::uuid[]) AND NOT deleted ORDER BY user_id, id;

-- name: CopyAudioBookmark :exec
INSERT INTO audio_bookmarks (user_id, id, recording_id, file_id, content_version, offset_ms, layout_revision, note, created_at)
VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, $7, $8);
