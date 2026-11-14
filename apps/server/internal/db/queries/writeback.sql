-- name: CreateWritebackPlan :one
INSERT INTO writeback_plans (library_id, file_id, base_version, kind, format, diff, recording_id, target_rel, base_sha256)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;

-- name: GetWritebackPlan :one
SELECT * FROM writeback_plans WHERE id = $1;

-- name: ApproveWritebackPlan :one
UPDATE writeback_plans SET stage = 'approved', approved_by = $2, updated_at = sqlc.arg(now)::timestamptz
WHERE id = $1 AND stage = 'planned' RETURNING *;

-- name: SetWritebackStage :exec
UPDATE writeback_plans SET stage = $2, detail = $3, staged_path = COALESCE(sqlc.narg(staged_path), staged_path),
    staged_sha256 = COALESCE(sqlc.narg(staged_sha256), staged_sha256), backup_ref = COALESCE(sqlc.narg(backup_ref), backup_ref),
    updated_at = sqlc.arg(now)::timestamptz
WHERE id = $1;

-- name: ListRecoverableWritebacks :many
SELECT * FROM writeback_plans WHERE stage IN ('staged', 'validated', 'backed_up') ORDER BY created_at;

-- name: GetWriterCapability :one
SELECT * FROM writer_capabilities WHERE format = $1;

-- name: SetWriterCapability :exec
UPDATE writer_capabilities SET enabled = $2, evidence_ref = $3 WHERE format = $1;

-- name: GetFileCurrent :one
SELECT o.file_id, o.library_id, o.rel_path, o.size_bytes, o.mtime, v.content_version, v.locator, v.mime_type,
       fp.sha256
FROM file_observations o
JOIN file_versions v ON v.file_id = o.file_id AND v.current
LEFT JOIN fingerprints fp ON fp.content_version = v.content_version
WHERE o.file_id = $1;

-- name: FirstRecordingFile :one
SELECT rf.file_id FROM recording_files rf WHERE rf.recording_id = $1 ORDER BY rf.sequence LIMIT 1;
