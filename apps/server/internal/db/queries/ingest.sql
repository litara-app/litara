-- name: CreateScanRun :one
INSERT INTO scan_runs (library_id, trigger) VALUES ($1, $2)
ON CONFLICT (library_id) WHERE state IN ('queued', 'running') DO NOTHING
RETURNING *;

-- name: GetScanRun :one
SELECT * FROM scan_runs WHERE id = $1;

-- name: MarkScanRunning :one
UPDATE scan_runs SET state = 'running', started_at = COALESCE(started_at, sqlc.arg(now)::timestamptz)
WHERE id = $1 AND state IN ('queued', 'running') RETURNING *;

-- name: FinishScanRun :exec
UPDATE scan_runs SET state = $2, health = $3, files_seen = $4, failure = $5, completed_at = sqlc.arg(now)::timestamptz
WHERE id = $1 AND state IN ('queued', 'running');

-- name: ListDueLibraries :many
SELECT c.library_id FROM library_config c
WHERE NOT EXISTS (
    SELECT 1 FROM scan_runs r
    WHERE r.library_id = c.library_id
      AND (r.state IN ('queued', 'running')
           OR (r.created_at > sqlc.arg(now)::timestamptz - make_interval(secs => c.scan_interval_secs)))
);

-- name: ListObservations :many
SELECT o.file_id, o.rel_path, o.size_bytes, o.mtime, o.missing_scans, o.missing,
       v.content_version, v.locator, v.available,
       fp.sha256, fp.size_bytes AS fp_size, fp.mtime AS fp_mtime, fp.verified_at
FROM file_observations o
JOIN file_versions v ON v.file_id = o.file_id AND v.current
LEFT JOIN fingerprints fp ON fp.content_version = v.content_version
WHERE o.library_id = $1
ORDER BY o.rel_path;

-- name: ListCandidates :many
SELECT * FROM file_candidates WHERE library_id = $1;

-- name: UpsertCandidate :exec
INSERT INTO file_candidates (library_id, rel_path, size_bytes, mtime, first_seen_at, last_seen_at)
VALUES ($1, $2, $3, $4, sqlc.arg(now)::timestamptz, sqlc.arg(now)::timestamptz)
ON CONFLICT (library_id, rel_path) DO UPDATE SET
    size_bytes = EXCLUDED.size_bytes, mtime = EXCLUDED.mtime,
    first_seen_at = CASE WHEN file_candidates.size_bytes = EXCLUDED.size_bytes AND file_candidates.mtime = EXCLUDED.mtime
                         THEN file_candidates.first_seen_at ELSE EXCLUDED.first_seen_at END,
    last_seen_at = EXCLUDED.last_seen_at;

-- name: DeleteCandidate :exec
DELETE FROM file_candidates WHERE library_id = $1 AND rel_path = $2;

-- name: DeleteCandidatesNotIn :exec
DELETE FROM file_candidates WHERE library_id = $1 AND NOT (rel_path = ANY(sqlc.arg(paths)::text[]));

-- name: InsertMediaFile :exec
INSERT INTO media_files (id) VALUES ($1);

-- name: InsertFileVersion :exec
INSERT INTO file_versions (content_version, file_id, locator, filename, mime_type, size_bytes, duration_ms, available, current)
VALUES ($1, $2, $3, $4, $5, $6, $7, true, true);

-- name: RetireCurrentVersion :exec
UPDATE file_versions SET current = false WHERE file_id = $1 AND current;

-- name: SetCurrentVersionAvailable :exec
UPDATE file_versions SET available = $2 WHERE file_id = $1 AND current;

-- name: SetVersionLocator :exec
UPDATE file_versions SET locator = $2, filename = $3 WHERE file_id = $1 AND current;

-- name: InsertFingerprint :exec
INSERT INTO fingerprints (content_version, sha256, size_bytes, mtime, computed_at, verified_at)
VALUES ($1, $2, $3, $4, sqlc.arg(now)::timestamptz, sqlc.arg(now)::timestamptz);

-- name: TouchFingerprint :exec
UPDATE fingerprints SET size_bytes = $2, mtime = $3, verified_at = sqlc.arg(now)::timestamptz WHERE content_version = $1;

-- name: InsertObservation :exec
INSERT INTO file_observations (file_id, library_id, rel_path, size_bytes, mtime, first_observed_at, last_observed_at, stable)
VALUES ($1, $2, $3, $4, $5, sqlc.arg(now)::timestamptz, sqlc.arg(now)::timestamptz, true);

-- name: UpdateObservation :exec
UPDATE file_observations SET rel_path = $2, size_bytes = $3, mtime = $4, last_observed_at = sqlc.arg(now)::timestamptz,
    missing_scans = 0, missing = false, stable = true
WHERE file_id = $1;

-- name: TouchObservations :exec
UPDATE file_observations SET last_observed_at = sqlc.arg(now)::timestamptz, missing_scans = 0, missing = false
WHERE file_id = ANY(sqlc.arg(file_ids)::uuid[]);

-- name: MarkObservationsAbsent :exec
UPDATE file_observations SET missing_scans = missing_scans + 1, missing = (missing_scans + 1 >= 2)
WHERE file_id = ANY(sqlc.arg(file_ids)::uuid[]);

-- name: BumpLayoutForFile :exec
UPDATE recordings SET layout_revision = gen_random_uuid()
WHERE id IN (SELECT recording_id FROM recording_files WHERE file_id = $1);

-- name: InsertFileMetadata :exec
INSERT INTO file_metadata (content_version, completeness, result, failure)
VALUES ($1, $2, $3, $4)
ON CONFLICT (content_version) DO UPDATE SET completeness = EXCLUDED.completeness, result = EXCLUDED.result,
    failure = EXCLUDED.failure, inspected_at = now();

-- name: UpsertOpenReview :one
INSERT INTO review_items (library_id, kind, subject_key, candidates) VALUES ($1, $2, $3, $4)
ON CONFLICT (library_id, kind, subject_key) WHERE state = 'open' DO UPDATE SET candidates = EXCLUDED.candidates
RETURNING *;

-- name: ListOpenReviews :many
SELECT * FROM review_items WHERE library_id = $1 AND state = 'open' ORDER BY created_at, id;

-- name: CloseReviewByKey :exec
UPDATE review_items SET state = 'resolved', resolved_at = sqlc.arg(now)::timestamptz, resolution = '{"auto": true}'::jsonb
WHERE library_id = $1 AND kind = $2 AND subject_key = $3 AND state = 'open';

-- name: SetRootHealthAt :exec
INSERT INTO root_health (library_id, state, detail, checked_at) VALUES ($1, $2, $3, sqlc.arg(now)::timestamptz)
ON CONFLICT (library_id) DO UPDATE SET state = EXCLUDED.state, detail = EXCLUDED.detail, checked_at = EXCLUDED.checked_at;

-- name: ListDueVerification :many
SELECT c.library_id FROM library_config c
WHERE NOT EXISTS (
    SELECT 1 FROM scan_runs r
    WHERE r.library_id = c.library_id
      AND (r.state IN ('queued', 'running')
           OR (r.trigger = 'verify' AND r.created_at > sqlc.arg(now)::timestamptz - make_interval(secs => c.verify_interval_secs)))
);
