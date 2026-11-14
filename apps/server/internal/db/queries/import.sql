-- name: CreateImportPlan :one
INSERT INTO import_plans (library_id, source_path, created_by) VALUES ($1, $2, $3) RETURNING *;

-- name: GetImportPlan :one
SELECT * FROM import_plans WHERE id = $1;

-- name: InsertImportItem :one
INSERT INTO import_items (plan_id, source_rel, source_sha256, size_bytes, target_rel, suffixed, duplicate_of, decision)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;

-- name: ListImportItems :many
SELECT * FROM import_items WHERE plan_id = $1 ORDER BY source_rel;

-- name: SetImportDecision :one
UPDATE import_items SET decision = $3 WHERE plan_id = $1 AND id = $2 AND state = 'planned' RETURNING *;

-- name: ApproveImportPlan :one
UPDATE import_plans SET state = 'approved', approved_by = $2, approved_at = sqlc.arg(now)::timestamptz
WHERE id = $1 AND state = 'planned' RETURNING *;

-- name: StartImportPlan :one
UPDATE import_plans SET state = 'running' WHERE id = $1 AND state IN ('approved', 'running') RETURNING *;

-- name: FinishImportPlan :exec
UPDATE import_plans SET state = $2, completed_at = sqlc.arg(now)::timestamptz WHERE id = $1 AND state = 'running';

-- name: SetImportItemState :exec
UPDATE import_items SET state = $2, detail = $3 WHERE id = $1;

-- name: ListFingerprintMatches :many
SELECT o.file_id, fp.sha256 FROM fingerprints fp
JOIN file_versions v ON v.content_version = fp.content_version AND v.current
JOIN file_observations o ON o.file_id = v.file_id
WHERE o.library_id = $1 AND fp.sha256 = ANY(sqlc.arg(hashes)::text[]);

-- name: GetImportPlanFor :one
SELECT * FROM import_plans WHERE id = $1 AND library_id = $2;
