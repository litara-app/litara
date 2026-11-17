-- name: ListPublications :many
-- Granted publications only. A file shared by several recordings appears once, in
-- the lowest-ID granted recording. Search is a literal NFC case-insensitive
-- substring over title, authors and series; no wildcard characters are special.
SELECT x.*, r.cover_locator AS cover_locator, r.cover_mime AS cover_mime
FROM (
  SELECT DISTINCT ON (p.publication_id) p.*
  FROM opds_publication_rows p
  JOIN user_library_grants g ON g.library_id = p.library_id AND g.user_id = sqlc.arg(user_id)
  WHERE (sqlc.narg(library_id)::uuid IS NULL OR p.library_id = sqlc.narg(library_id)::uuid)
    AND (sqlc.narg(media_kind)::text IS NULL OR p.media_kind = sqlc.narg(media_kind)::text)
    AND (sqlc.narg(q)::text IS NULL
         OR position(sqlc.narg(q)::text IN lower(normalize(p.title, NFC))) > 0
         OR position(sqlc.narg(q)::text IN lower(normalize(COALESCE(p.series_name, ''), NFC))) > 0
         OR EXISTS (SELECT 1 FROM unnest(p.authors) a WHERE position(sqlc.narg(q)::text IN lower(normalize(a, NFC))) > 0))
  ORDER BY p.publication_id, p.recording_id NULLS FIRST
) x
LEFT JOIN recordings r ON r.id = x.recording_id
-- Base title first; an audio recording's files stay together in file order; UUID breaks ties.
ORDER BY lower(normalize(x.title, NFC)), x.recording_id NULLS FIRST, x.file_order, x.publication_id
LIMIT sqlc.arg(lim) OFFSET sqlc.arg(off);

-- name: CountPublications :one
SELECT count(*) FROM (
  SELECT DISTINCT p.publication_id
  FROM opds_publication_rows p
  JOIN user_library_grants g ON g.library_id = p.library_id AND g.user_id = sqlc.arg(user_id)
  WHERE (sqlc.narg(library_id)::uuid IS NULL OR p.library_id = sqlc.narg(library_id)::uuid)
    AND (sqlc.narg(media_kind)::text IS NULL OR p.media_kind = sqlc.narg(media_kind)::text)
    AND (sqlc.narg(q)::text IS NULL
         OR position(sqlc.narg(q)::text IN lower(normalize(p.title, NFC))) > 0
         OR position(sqlc.narg(q)::text IN lower(normalize(COALESCE(p.series_name, ''), NFC))) > 0
         OR EXISTS (SELECT 1 FROM unnest(p.authors) a WHERE position(sqlc.narg(q)::text IN lower(normalize(a, NFC))) > 0))
) c;

-- name: GetPublication :one
SELECT x.*, r.cover_locator AS cover_locator, r.cover_mime AS cover_mime
FROM (
  SELECT DISTINCT ON (p.publication_id) p.*
  FROM opds_publication_rows p
  JOIN user_library_grants g ON g.library_id = p.library_id AND g.user_id = sqlc.arg(user_id)
  WHERE p.publication_id = sqlc.arg(publication_id)
  ORDER BY p.publication_id, p.recording_id NULLS FIRST
) x
LEFT JOIN recordings r ON r.id = x.recording_id;

-- name: GetPublicationCover :one
SELECT r.cover_locator, r.cover_mime
FROM opds_publication_rows p
JOIN user_library_grants g ON g.library_id = p.library_id AND g.user_id = sqlc.arg(user_id)
JOIN active_recordings r ON r.id = p.recording_id
WHERE p.publication_id = sqlc.arg(publication_id) AND r.cover_locator IS NOT NULL AND r.cover_mime IS NOT NULL
ORDER BY r.id
LIMIT 1;
