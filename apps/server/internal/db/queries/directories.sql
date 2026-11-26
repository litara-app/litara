-- Author and series directories (ADR-0100). An author or a series is a name, matched ignoring case; both lists cover
-- only titles with an edition or an active recording in a library the user is granted.

-- name: ListAuthors :many
WITH visible AS (
  SELECT t.id, t.title, t.authors, t.series_name FROM titles t
  WHERE EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id) WHERE e.title_id = t.id)
     OR EXISTS (SELECT 1 FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id) WHERE r.title_id = t.id)
), names AS (
  SELECT v.id, v.title, v.series_name, a.name FROM visible v CROSS JOIN LATERAL unnest(v.authors) AS a(name)
  WHERE btrim(a.name) <> '' AND (sqlc.arg(q)::text = '' OR position(lower(sqlc.arg(q)::text) in lower(a.name)) > 0)
)
SELECT (mode() WITHIN GROUP (ORDER BY n.name))::text AS name, count(DISTINCT n.id)::bigint AS titles,
       count(DISTINCT lower(n.series_name)) FILTER (WHERE btrim(n.series_name) <> '')::bigint AS series_count,
       ((array_agg(n.id ORDER BY lower(n.title), n.id))[1])::uuid AS cover_title_id
FROM names n
GROUP BY lower(n.name)
ORDER BY lower(n.name)
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountAuthors :one
WITH visible AS (
  SELECT t.id, t.authors FROM titles t
  WHERE EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id) WHERE e.title_id = t.id)
     OR EXISTS (SELECT 1 FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id) WHERE r.title_id = t.id)
)
SELECT count(DISTINCT lower(a.name))::bigint
FROM visible v CROSS JOIN LATERAL unnest(v.authors) AS a(name)
WHERE btrim(a.name) <> '' AND (sqlc.arg(q)::text = '' OR position(lower(sqlc.arg(q)::text) in lower(a.name)) > 0);

-- name: ListSeries :many
WITH visible AS (
  SELECT t.id, t.title, t.authors, t.series_name, t.series_index,
    EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id) WHERE e.title_id = t.id) AS has_ebook,
    (EXISTS (SELECT 1 FROM edition_completion_state c JOIN editions e ON e.id = c.edition_id WHERE c.user_id = sqlc.arg(user_id) AND e.title_id = t.id AND c.finished)
      OR EXISTS (SELECT 1 FROM completion_state c JOIN recordings r ON r.id = c.recording_id WHERE c.user_id = sqlc.arg(user_id) AND r.title_id = t.id AND c.finished)) AS finished
  FROM titles t
  WHERE t.series_name IS NOT NULL AND btrim(t.series_name) <> ''
    AND (sqlc.arg(q)::text = '' OR position(lower(sqlc.arg(q)::text) in lower(t.series_name)) > 0)
    AND (EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id) WHERE e.title_id = t.id)
      OR EXISTS (SELECT 1 FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id) WHERE r.title_id = t.id))
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
  AND (EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id) WHERE e.title_id = t.id)
    OR EXISTS (SELECT 1 FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id) WHERE r.title_id = t.id));
