-- name: InsertInspectionRequest :one
INSERT INTO inspection_requests (request_key, source_path)
VALUES ($1, $2)
ON CONFLICT (request_key) DO NOTHING
RETURNING *;

-- name: GetInspectionRequestByKey :one
SELECT * FROM inspection_requests WHERE request_key = $1;

-- name: GetInspectionRequest :one
SELECT * FROM inspection_requests WHERE id = $1;

-- name: ResetInspectionRequest :one
-- Explicit re-inspection: only terminal requests can be reset.
UPDATE inspection_requests
SET state = 'queued', outcome = NULL, failure_message = NULL,
    started_at = NULL, completed_at = NULL, updated_at = now()
WHERE id = $1 AND state IN ('completed', 'failed', 'cancelled')
RETURNING *;

-- name: MarkInspectionRunning :one
-- Guards against re-running a request that already reached a terminal state.
UPDATE inspection_requests
SET state = 'running', attempts = attempts + 1, started_at = now(), updated_at = now()
WHERE id = $1 AND state IN ('queued', 'running')
RETURNING *;

-- name: MarkInspectionRetry :exec
UPDATE inspection_requests
SET state = 'queued', outcome = $2, failure_message = $3, updated_at = now()
WHERE id = $1 AND state IN ('queued', 'running');

-- name: MarkInspectionFailed :exec
UPDATE inspection_requests
SET state = 'failed', outcome = $2, failure_message = $3,
    completed_at = now(), updated_at = now()
WHERE id = $1 AND state IN ('queued', 'running');

-- name: MarkInspectionCancelled :exec
UPDATE inspection_requests
SET state = 'cancelled', outcome = 'cancelled', failure_message = $2,
    completed_at = now(), updated_at = now()
WHERE id = $1 AND state IN ('queued', 'running');

-- name: MarkInspectionCompleted :execrows
UPDATE inspection_requests
SET state = 'completed', outcome = $2, failure_message = NULL,
    completed_at = now(), updated_at = now()
WHERE id = $1 AND state IN ('queued', 'running');

-- name: UpsertInspectionResult :exec
INSERT INTO inspection_results (request_id, completeness, duration_ms, format_name, result, tool_version)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (request_id) DO UPDATE
SET completeness = EXCLUDED.completeness, duration_ms = EXCLUDED.duration_ms,
    format_name = EXCLUDED.format_name, result = EXCLUDED.result,
    tool_version = EXCLUDED.tool_version, inspected_at = now();

-- name: GetInspectionResult :one
SELECT * FROM inspection_results WHERE request_id = $1;
