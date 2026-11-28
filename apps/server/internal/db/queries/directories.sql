-- Author and series directories (ADR-0100). An author or a series is a name, matched ignoring case; both lists cover
-- only titles held (ebook, recording or paper copy, ADR-0116) in a library the user is granted.

-- name: ListAuthors :many
WITH visible AS (
  SELECT t.id, t.title, t.authors, t.series_name FROM titles t
  WHERE EXISTS (SELECT 1 FROM title_holdings h JOIN user_library_grants g ON g.library_id = h.library_id AND g.user_id = sqlc.arg(user_id) WHERE h.title_id = t.id)
), names AS (
  SELECT v.id, v.title, v.series_name, a.name FROM visible v CROSS JOIN LATERAL unnest(v.authors) AS a(name)
  WHERE btrim(a.name) <> '' AND (sqlc.arg(q)::text = '' OR position(lower(sqlc.arg(q)::text) in lower(a.name)) > 0)
), grouped AS (
  SELECT lower(n.name) AS name_key, (mode() WITHIN GROUP (ORDER BY n.name))::text AS name, count(DISTINCT n.id)::bigint AS titles,
         count(DISTINCT lower(n.series_name)) FILTER (WHERE btrim(n.series_name) <> '')::bigint AS series_count,
         ((array_agg(n.id ORDER BY lower(n.title), n.id))[1])::uuid AS cover_title_id
  FROM names n GROUP BY lower(n.name)
), filed AS (
  -- A saved last name replaces the guess (ADR-0101).
  SELECT g.name_key, g.name, g.titles, g.series_count, g.cover_title_id,
         COALESCE(d.value #>> '{}', guess_last_name(g.name))::text AS last_name,
         (CASE WHEN sqlc.arg(sort)::text = 'first' THEN g.name ELSE COALESCE(d.value #>> '{}', guess_last_name(g.name)) END)::text AS sort_name
  FROM grouped g LEFT JOIN directory_values d ON d.kind = 'author' AND d.name_key = g.name_key AND d.field = 'last_name'
)
SELECT f.name, f.titles, f.series_count, f.cover_title_id, f.last_name, p.version AS photo_version
FROM filed f LEFT JOIN author_photos p ON p.name_key = f.name_key AND p.source <> 'none'
WHERE sqlc.arg(letter)::text = '' OR directory_letter(f.sort_name) = sqlc.arg(letter)::text
ORDER BY lower(f.sort_name), f.name_key
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountAuthorLetters :many
-- How many matching authors are filed under each letter, for the A to Z row and the total.
WITH visible AS (
  SELECT t.id, t.title, t.authors, t.series_name FROM titles t
  WHERE EXISTS (SELECT 1 FROM title_holdings h JOIN user_library_grants g ON g.library_id = h.library_id AND g.user_id = sqlc.arg(user_id) WHERE h.title_id = t.id)
), names AS (
  SELECT v.id, v.title, v.series_name, a.name FROM visible v CROSS JOIN LATERAL unnest(v.authors) AS a(name)
  WHERE btrim(a.name) <> '' AND (sqlc.arg(q)::text = '' OR position(lower(sqlc.arg(q)::text) in lower(a.name)) > 0)
), grouped AS (
  SELECT lower(n.name) AS name_key, (mode() WITHIN GROUP (ORDER BY n.name))::text AS name, count(DISTINCT n.id)::bigint AS titles,
         count(DISTINCT lower(n.series_name)) FILTER (WHERE btrim(n.series_name) <> '')::bigint AS series_count,
         ((array_agg(n.id ORDER BY lower(n.title), n.id))[1])::uuid AS cover_title_id
  FROM names n GROUP BY lower(n.name)
), filed AS (
  -- A saved last name replaces the guess (ADR-0101).
  SELECT g.name_key, g.name, g.titles, g.series_count, g.cover_title_id,
         COALESCE(d.value #>> '{}', guess_last_name(g.name))::text AS last_name,
         (CASE WHEN sqlc.arg(sort)::text = 'first' THEN g.name ELSE COALESCE(d.value #>> '{}', guess_last_name(g.name)) END)::text AS sort_name
  FROM grouped g LEFT JOIN directory_values d ON d.kind = 'author' AND d.name_key = g.name_key AND d.field = 'last_name'
)
SELECT directory_letter(f.sort_name)::text AS letter, count(*)::bigint AS authors
FROM filed f GROUP BY 1 ORDER BY 1;

-- name: ListSeries :many
WITH visible AS (
  SELECT t.id, t.title, t.authors, t.series_name, t.series_index,
    (EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id) WHERE e.title_id = t.id)
      OR NOT EXISTS (SELECT 1 FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id) WHERE r.title_id = t.id)) AS has_ebook,
    (EXISTS (SELECT 1 FROM edition_completion_state c JOIN editions e ON e.id = c.edition_id WHERE c.user_id = sqlc.arg(user_id) AND e.title_id = t.id AND c.finished)
      OR EXISTS (SELECT 1 FROM completion_state c JOIN recordings r ON r.id = c.recording_id WHERE c.user_id = sqlc.arg(user_id) AND r.title_id = t.id AND c.finished)
      OR EXISTS (SELECT 1 FROM paper_reading_state s JOIN physical_copies p ON p.id = s.copy_id WHERE s.user_id = sqlc.arg(user_id) AND p.title_id = t.id AND s.status = 'finished')) AS finished
  FROM titles t
  WHERE t.series_name IS NOT NULL AND btrim(t.series_name) <> ''
    AND (sqlc.arg(q)::text = '' OR position(lower(sqlc.arg(q)::text) in lower(t.series_name)) > 0)
    AND (EXISTS (SELECT 1 FROM title_holdings h JOIN user_library_grants g ON g.library_id = h.library_id AND g.user_id = sqlc.arg(user_id) WHERE h.title_id = t.id))
)
SELECT (mode() WITHIN GROUP (ORDER BY v.series_name))::text AS name, count(*)::bigint AS titles,
       ((array_agg(v.id ORDER BY v.series_index NULLS LAST, lower(v.title), v.id))[1])::uuid AS cover_title_id,
       to_jsonb((array_agg(jsonb_build_object('titleId', v.id, 'title', v.title, 'medium', CASE WHEN v.has_ebook THEN 'ebook' ELSE 'audio' END)
                           ORDER BY v.series_index NULLS LAST, lower(v.title), v.id))[1:5])::jsonb AS covers,
       count(*) FILTER (WHERE v.finished)::bigint AS finished,
       COALESCE(array_agg(DISTINCT v.authors[1]) FILTER (WHERE v.authors[1] IS NOT NULL AND btrim(v.authors[1]) <> ''), '{}')::text[] AS authors
FROM visible v
GROUP BY lower(v.series_name)
ORDER BY CASE WHEN sqlc.arg(sort)::text = 'titles' THEN count(*) END DESC NULLS LAST, lower(v.series_name)
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountSeries :one
SELECT count(DISTINCT lower(t.series_name))::bigint FROM titles t
WHERE t.series_name IS NOT NULL AND btrim(t.series_name) <> ''
  AND (sqlc.arg(q)::text = '' OR position(lower(sqlc.arg(q)::text) in lower(t.series_name)) > 0)
  AND (EXISTS (SELECT 1 FROM title_holdings h JOIN user_library_grants g ON g.library_id = h.library_id AND g.user_id = sqlc.arg(user_id) WHERE h.title_id = t.id));
