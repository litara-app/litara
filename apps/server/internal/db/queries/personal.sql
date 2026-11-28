-- name: GetTitlePersonal :one
SELECT user_id, title_id, revision, rating_halves, review, started_at, finished_at, updated_at
FROM title_personal WHERE user_id = $1 AND title_id = $2;

-- name: InsertTitlePersonal :exec
INSERT INTO title_personal (user_id, title_id, revision, rating_halves, review, started_at, finished_at, updated_at)
VALUES ($1, $2, 1, $3, $4, $5, $6, $7);

-- name: UpdateTitlePersonal :exec
UPDATE title_personal
SET revision = revision + 1, rating_halves = $3, review = $4, started_at = $5, finished_at = $6, updated_at = $7
WHERE user_id = $1 AND title_id = $2;

-- Absent dates come back as the Unix epoch (a sentinel the caller treats as "none").
-- name: DerivedTitleDates :one
-- Ebook reading and paper reading (ADR-0116). A paper finish that was taken back leaves no date.
SELECT
  COALESCE(LEAST(
    (SELECT MIN(s.captured_at) FROM edition_position_state s JOIN editions e ON e.id = s.edition_id
      WHERE s.user_id = $1 AND e.title_id = $2 AND s.captured_at IS NOT NULL),
    (SELECT MIN(h.captured_at) FROM paper_history h WHERE h.user_id = $1 AND h.title_id = $2 AND h.event = 'started')),
    'epoch'::timestamptz)::timestamptz AS started_at,
  COALESCE(GREATEST(
    (SELECT MAX(c.changed_at) FROM edition_completion_state c JOIN editions e ON e.id = c.edition_id
      WHERE c.user_id = $1 AND e.title_id = $2 AND c.finished),
    (SELECT MAX(h.captured_at) FROM paper_history h WHERE h.user_id = $1 AND h.title_id = $2 AND h.event = 'finished'
      AND COALESCE((SELECT n.event FROM paper_history n WHERE n.user_id = h.user_id AND n.copy_id = h.copy_id AND n.seq > h.seq
                    ORDER BY n.seq LIMIT 1), '') <> 'unfinished')),
    'epoch'::timestamptz)::timestamptz AS finished_at;

-- name: GetEditionCreatedAt :one
SELECT created_at FROM editions WHERE id = $1;
