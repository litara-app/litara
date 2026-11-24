-- A session is sent many times under one id: keep the longest active time and the latest end, so a retry or an
-- out-of-order send never shrinks it. An id already used for another edition is left alone.
-- name: UpsertReadingSession :exec
INSERT INTO reading_sessions (user_id, id, edition_id, started_at, ended_at, active_seconds, start_fraction, end_fraction)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (user_id, id) DO UPDATE SET
  ended_at = GREATEST(reading_sessions.ended_at, EXCLUDED.ended_at),
  active_seconds = GREATEST(reading_sessions.active_seconds, EXCLUDED.active_seconds),
  end_fraction = CASE WHEN EXCLUDED.ended_at >= reading_sessions.ended_at THEN EXCLUDED.end_fraction ELSE reading_sessions.end_fraction END,
  updated_at = now()
WHERE reading_sessions.edition_id = EXCLUDED.edition_id;

-- name: ListReadingSessionsForTitle :many
SELECT s.id, s.edition_id, e.title_id, s.started_at, s.ended_at, s.active_seconds, s.start_fraction, s.end_fraction
FROM reading_sessions s JOIN editions e ON e.id = s.edition_id
WHERE s.user_id = $1 AND e.title_id = $2
ORDER BY s.started_at DESC, s.id DESC LIMIT $3 OFFSET $4;

-- name: CountReadingSessionsForTitle :one
SELECT count(*) FROM reading_sessions s JOIN editions e ON e.id = s.edition_id
WHERE s.user_id = $1 AND e.title_id = $2;
