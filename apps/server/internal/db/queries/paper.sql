-- Physical copies and paper reading (ADR-0116).

-- name: InsertPhysicalCopy :exec
INSERT INTO physical_copies (id, title_id, library_id, binding, isbn, language, page_count, location, note, acquired_on, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, sqlc.arg(now), sqlc.arg(now));

-- name: GetPhysicalCopy :one
SELECT * FROM physical_copies WHERE id = $1;

-- name: LockPhysicalCopy :one
SELECT * FROM physical_copies WHERE id = $1 FOR UPDATE;

-- name: UpdatePhysicalCopy :one
UPDATE physical_copies SET revision = revision + 1, title_id = $2, library_id = $3, binding = $4, isbn = $5, language = $6,
  page_count = $7, location = $8, note = $9, acquired_on = $10, updated_at = sqlc.arg(now)
WHERE id = $1 RETURNING *;

-- name: RemovePhysicalCopy :one
UPDATE physical_copies SET revision = revision + 1, removed_at = sqlc.arg(now), updated_at = sqlc.arg(now) WHERE id = $1 RETURNING *;

-- name: ListTitleCopies :many
-- The live copies of a title in the caller's libraries, oldest first.
SELECT p.* FROM physical_copies p
JOIN user_library_grants g ON g.library_id = p.library_id AND g.user_id = sqlc.arg(user_id)
WHERE p.title_id = sqlc.arg(title_id) AND p.removed_at IS NULL
ORDER BY p.created_at, p.id;

-- name: CountTitleCopies :one
SELECT count(*) FROM physical_copies WHERE title_id = $1 AND removed_at IS NULL;

-- name: ListCopyLocations :many
-- Locations already used in the caller's libraries, offered as suggestions.
SELECT DISTINCT p.location::text AS location FROM physical_copies p
JOIN user_library_grants g ON g.library_id = p.library_id AND g.user_id = sqlc.arg(user_id)
WHERE p.removed_at IS NULL AND p.location IS NOT NULL
  AND (sqlc.narg(library_id)::uuid IS NULL OR p.library_id = sqlc.narg(library_id))
ORDER BY 1 LIMIT 200;

-- name: FindVisibleTitlesForPaper :many
-- Titles the caller can see that may be the book being added: the same name and first author (ignoring case, spaces and
-- punctuation), or an ebook edition or paper copy with the same ISBN.
SELECT t.id, t.title, t.authors, t.series_name,
  (sqlc.arg(isbn)::text <> '' AND (
     EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id)
             WHERE e.title_id = t.id AND upper(regexp_replace(effective_edition_field(e.id, 'isbn') #>> '{}', '[- ]', '', 'g')) = sqlc.arg(isbn)::text)
     OR EXISTS (SELECT 1 FROM physical_copies p JOIN user_library_grants g ON g.library_id = p.library_id AND g.user_id = sqlc.arg(user_id)
             WHERE p.title_id = t.id AND p.removed_at IS NULL AND p.isbn = sqlc.arg(isbn)::text)))::boolean AS same_isbn
FROM titles t
WHERE EXISTS (SELECT 1 FROM title_holdings h JOIN user_library_grants g ON g.library_id = h.library_id AND g.user_id = sqlc.arg(user_id) WHERE h.title_id = t.id)
  AND (
    (sqlc.arg(name_key)::text <> '' AND regexp_replace(lower(t.title), '[^[:alnum:]]', '', 'g') = sqlc.arg(name_key)::text
      AND regexp_replace(lower(COALESCE(t.authors[1], '')), '[^[:alnum:]]', '', 'g') = sqlc.arg(author_key)::text)
    OR (sqlc.arg(isbn)::text <> '' AND (
     EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id)
             WHERE e.title_id = t.id AND upper(regexp_replace(effective_edition_field(e.id, 'isbn') #>> '{}', '[- ]', '', 'g')) = sqlc.arg(isbn)::text)
     OR EXISTS (SELECT 1 FROM physical_copies p JOIN user_library_grants g ON g.library_id = p.library_id AND g.user_id = sqlc.arg(user_id)
             WHERE p.title_id = t.id AND p.removed_at IS NULL AND p.isbn = sqlc.arg(isbn)::text))))
ORDER BY lower(t.title), t.id LIMIT 20;

-- name: InsertPaperTitle :exec
-- No identifier: a later scan offers its file for review and never joins this title silently.
INSERT INTO titles (id, title, authors, series_name, series_index, group_key) VALUES ($1, $2, $3, $4, $5, $6);

-- name: MovePaperHistory :exec
-- Moving a copy corrects which book it is, so the history made with it moves too.
UPDATE paper_history SET title_id = $2 WHERE copy_id = $1;

-- name: EnsurePaperState :exec
INSERT INTO paper_reading_state (user_id, copy_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: LockPaperState :one
SELECT * FROM paper_reading_state WHERE user_id = $1 AND copy_id = $2 FOR UPDATE;

-- name: GetPaperState :one
SELECT * FROM paper_reading_state WHERE user_id = $1 AND copy_id = $2;

-- name: SetPaperState :one
UPDATE paper_reading_state SET revision = revision + 1, status = $3, page = $4, changed_at = $5
WHERE user_id = $1 AND copy_id = $2 RETURNING *;

-- name: InsertPaperHistory :exec
INSERT INTO paper_history (user_id, title_id, copy_id, event, operation_id, captured_at, received_at)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: ListPaperHistory :many
-- The caller's own events for a title, in receive order. They stay after a copy is removed, as long as the caller can
-- still read the library the copy is in.
SELECT h.id, h.title_id, h.copy_id, h.event, h.captured_at, h.received_at
FROM paper_history h
JOIN physical_copies p ON p.id = h.copy_id
JOIN user_library_grants g ON g.library_id = p.library_id AND g.user_id = h.user_id
WHERE h.user_id = $1 AND h.title_id = $2
ORDER BY h.seq LIMIT $3 OFFSET $4;

-- name: CountPaperHistory :one
SELECT count(*) FROM paper_history h
JOIN physical_copies p ON p.id = h.copy_id
JOIN user_library_grants g ON g.library_id = p.library_id AND g.user_id = h.user_id
WHERE h.user_id = $1 AND h.title_id = $2;

-- name: ListPaperFinishesForStats :many
-- Finishes in the range that were not taken back: the next event for that copy is not "unfinished".
SELECT h.title_id, h.captured_at FROM paper_history h
WHERE h.user_id = sqlc.arg(user_id) AND h.event = 'finished'
  AND h.captured_at >= sqlc.arg(from_time) AND h.captured_at < sqlc.arg(to_time)
  AND COALESCE((SELECT n.event FROM paper_history n WHERE n.user_id = h.user_id AND n.copy_id = h.copy_id AND n.seq > h.seq
                ORDER BY n.seq LIMIT 1), '') <> 'unfinished';

-- name: SetTitleGroupKey :exec
UPDATE titles SET group_key = $2 WHERE id = $1;

-- name: CountTitleFileHoldings :one
-- Ebook editions and recordings of a title. A paper-only title has none and is edited through its own operation.
SELECT ((SELECT count(*) FROM editions e WHERE e.title_id = $1) + (SELECT count(*) FROM active_recordings r WHERE r.title_id = $1))::bigint;

-- name: ListTitleCopyLibraries :many
SELECT DISTINCT library_id FROM physical_copies WHERE title_id = $1 AND removed_at IS NULL;
