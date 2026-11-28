-- CSV import of paper books (ADR-0117).

-- name: InsertPaperImport :exec
INSERT INTO paper_imports (id, user_id, library_id, source, row_count, created_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: InsertPaperImportRow :copyfrom
INSERT INTO paper_import_rows (import_id, row_no, title, author, data) VALUES ($1, $2, $3, $4, $5);

-- name: DeleteExpiredPaperImports :execrows
-- Only unapplied plans expire; a completed one holds no more than titles and outcomes.
DELETE FROM paper_imports WHERE state <> 'completed' AND expires_at <= sqlc.arg(now);

-- name: CountOpenPaperImports :one
SELECT count(*) FROM paper_imports WHERE user_id = $1 AND state <> 'completed';

-- name: ListPaperImports :many
SELECT * FROM paper_imports WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT 50;

-- name: GetPaperImport :one
SELECT * FROM paper_imports WHERE id = $1 AND user_id = $2;

-- name: GetPaperImportByID :one
SELECT * FROM paper_imports WHERE id = $1;

-- name: LockPaperImport :one
SELECT * FROM paper_imports WHERE id = $1 FOR UPDATE;

-- name: DeletePaperImport :exec
DELETE FROM paper_imports WHERE id = $1;

-- name: SetPaperImportOptions :exec
UPDATE paper_imports SET ownership = $2, shelves = $3, include_reading = $4, revision = revision + 1 WHERE id = $1;

-- name: BumpPaperImport :exec
UPDATE paper_imports SET revision = revision + 1 WHERE id = $1;

-- name: ClearPaperImportSelections :exec
UPDATE paper_import_rows SET selected = NULL WHERE import_id = $1;

-- name: ListPaperImportRows :many
SELECT * FROM paper_import_rows WHERE import_id = $1 ORDER BY row_no;

-- name: GetPaperImportRow :one
SELECT * FROM paper_import_rows WHERE import_id = $1 AND row_no = $2;

-- name: SetPaperImportRowDecision :exec
UPDATE paper_import_rows SET selected = $3, choice = $4, choice_title_id = $5 WHERE import_id = $1 AND row_no = $2;

-- name: SetPaperImportRowPlan :exec
UPDATE paper_import_rows SET planned_action = $3, planned_title_id = $4 WHERE import_id = $1 AND row_no = $2;

-- name: StartPaperImport :exec
UPDATE paper_imports SET state = 'applying', revision = revision + 1, applied_at = sqlc.arg(now), expires_at = sqlc.arg(expires_at) WHERE id = $1;

-- name: NextPaperImportRow :one
SELECT * FROM paper_import_rows WHERE import_id = $1 AND outcome IS NULL ORDER BY row_no LIMIT 1 FOR UPDATE;

-- name: SetPaperImportRowOutcome :exec
UPDATE paper_import_rows SET outcome = $3, outcome_detail = $4, result_title_id = $5, copy_ids = $6
WHERE import_id = $1 AND row_no = $2;

-- name: CompletePaperImport :exec
UPDATE paper_imports SET state = 'completed', revision = revision + 1, completed_at = sqlc.arg(now) WHERE id = $1;

-- name: ScrubPaperImportRows :exec
UPDATE paper_import_rows SET data = NULL WHERE import_id = $1;

-- name: CountPaperImportOutcomes :many
SELECT COALESCE(outcome, '')::text AS outcome, count(*)::bigint AS rows FROM paper_import_rows WHERE import_id = $1 GROUP BY 1;

-- name: ManagesLibrary :one
-- An active administrator with access to the library, checked again when the job runs.
SELECT EXISTS (
  SELECT 1 FROM users u JOIN user_library_grants g ON g.user_id = u.id
  WHERE u.id = sqlc.arg(user_id) AND g.library_id = sqlc.arg(library_id) AND u.is_admin AND u.active);

-- name: CountOtherCopies :one
-- Live copies of the title in the library with this ISBN, or none, that this import did not make.
SELECT count(*) FROM physical_copies p
WHERE p.title_id = sqlc.arg(title_id) AND p.library_id = sqlc.arg(library_id) AND p.removed_at IS NULL
  AND COALESCE(p.isbn, '') = sqlc.arg(isbn)::text AND NOT (p.id = ANY (sqlc.arg(ours)::uuid[]));

-- name: ListPaperImportIndex :many
-- Every title the person can see, with what a row is compared by.
SELECT t.id, t.title, t.authors,
  ARRAY(
    SELECT upper(regexp_replace(effective_edition_field(e.id, 'isbn') #>> '{}', '[- ]', '', 'g'))
    FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id)
    WHERE e.title_id = t.id AND effective_edition_field(e.id, 'isbn') #>> '{}' IS NOT NULL
    UNION
    SELECT p.isbn FROM physical_copies p JOIN user_library_grants g ON g.library_id = p.library_id AND g.user_id = sqlc.arg(user_id)
    WHERE p.title_id = t.id AND p.removed_at IS NULL AND p.isbn IS NOT NULL
  )::text[] AS isbns,
  ARRAY(
    SELECT COALESCE(p.isbn, '') FROM physical_copies p
    WHERE p.title_id = t.id AND p.library_id = sqlc.arg(library_id) AND p.removed_at IS NULL
  )::text[] AS library_copies
FROM titles t
WHERE EXISTS (SELECT 1 FROM title_holdings h JOIN user_library_grants g ON g.library_id = h.library_id AND g.user_id = sqlc.arg(user_id) WHERE h.title_id = t.id);

-- name: HasFinishedTitle :one
-- Whether the account has already finished the title in any form, or recorded a finish date of its own.
SELECT (
  EXISTS (SELECT 1 FROM edition_completion_state c JOIN editions e ON e.id = c.edition_id WHERE c.user_id = $1 AND e.title_id = $2 AND c.finished)
  OR EXISTS (SELECT 1 FROM completion_state c JOIN recordings r ON r.id = c.recording_id WHERE c.user_id = $1 AND r.title_id = $2 AND c.finished)
  OR EXISTS (SELECT 1 FROM paper_reading_state s JOIN physical_copies p ON p.id = s.copy_id WHERE s.user_id = $1 AND p.title_id = $2 AND s.status = 'finished')
  OR EXISTS (SELECT 1 FROM paper_history h WHERE h.user_id = $1 AND h.title_id = $2 AND h.event = 'finished'
             AND COALESCE((SELECT n.event FROM paper_history n WHERE n.user_id = h.user_id AND n.copy_id = h.copy_id AND n.seq > h.seq ORDER BY n.seq LIMIT 1), '') <> 'unfinished')
  OR EXISTS (SELECT 1 FROM title_personal p WHERE p.user_id = $1 AND p.title_id = $2 AND p.finished_at IS NOT NULL)
)::boolean;
