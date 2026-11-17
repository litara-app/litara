-- name: LockRecordingsForRepair :many
SELECT id, title_id, library_id, layout_revision, tombstoned_at, narrators,
       thumbnail_locator, thumbnail_mime, cover_locator, cover_mime
FROM recordings WHERE id = ANY(sqlc.arg(ids)::uuid[]) ORDER BY id FOR UPDATE;

-- name: InsertSuccessorRecording :one
INSERT INTO recordings (id, title_id, library_id, narrators, thumbnail_locator, thumbnail_mime, cover_locator, cover_mime)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING layout_revision;

-- name: TombstoneRecording :exec
UPDATE recordings SET tombstoned_at = now(), successor_ids = $2 WHERE id = $1;

-- name: InsertChapterSource :exec
INSERT INTO chapter_sources (recording_id, source, starts) VALUES ($1, $2, $3);

-- name: InsertRepairPlan :one
INSERT INTO repair_plans (admin_id, library_id, title_id, kind, state, sources, outputs)
VALUES ($1, $2, $3, $4, 'planned', $5, $6) RETURNING *;

-- name: GetRepairPlan :one
SELECT * FROM repair_plans WHERE id = $1;

-- name: LockRepairPlan :one
SELECT * FROM repair_plans WHERE id = $1 FOR UPDATE;

-- name: UpdateRepairPlan :exec
UPDATE repair_plans SET state = $2, revision = revision + 1, result = $3, updated_at = now() WHERE id = $1;

-- name: ListSourcePositions :many
SELECT * FROM position_state WHERE recording_id = ANY(sqlc.arg(ids)::uuid[]) AND file_id IS NOT NULL AND content_version IS NOT NULL AND offset_ms IS NOT NULL;

-- name: GetRecordingLibrary :one
SELECT library_id FROM recordings WHERE id = $1;
