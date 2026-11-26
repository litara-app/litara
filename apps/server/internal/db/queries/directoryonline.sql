-- Online author and series data (ADR-0102 to ADR-0106).

-- name: DirectoryProviders :many
-- The providers enabled in any library the user is granted that holds a title of this author or series (ADR-0104).
SELECT DISTINCT p.provider::text AS provider
FROM titles t
CROSS JOIN LATERAL (
  SELECT e.library_id FROM editions e WHERE e.title_id = t.id
  UNION SELECT r.library_id FROM active_recordings r WHERE r.title_id = t.id
) held
JOIN user_library_grants g ON g.library_id = held.library_id AND g.user_id = sqlc.arg(user_id)
JOIN library_config lc ON lc.library_id = held.library_id
CROSS JOIN LATERAL unnest(lc.provider_order) AS p(provider)
WHERE CASE WHEN sqlc.arg(kind)::text = 'author' THEN EXISTS (SELECT 1 FROM unnest(t.authors) AS a(name) WHERE lower(a.name) = sqlc.arg(name_key)::text)
           ELSE lower(t.series_name) = sqlc.arg(name_key)::text END
ORDER BY 1;

-- name: SeriesLookupBooks :many
-- A few of the user's books in a series, to find the series through: those with an ISBN first, then in reading order.
SELECT t.title, t.authors, COALESCE(isbn.value, '')::text AS isbn
FROM titles t
LEFT JOIN LATERAL (
  SELECT NULLIF(effective_edition_field(e.id, 'isbn') #>> '{}', '') AS value
  FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id)
  WHERE e.title_id = t.id
  ORDER BY 1 NULLS LAST LIMIT 1
) isbn ON true
WHERE lower(t.series_name) = sqlc.arg(name_key)::text
  AND (EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id) WHERE e.title_id = t.id)
    OR EXISTS (SELECT 1 FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id) WHERE r.title_id = t.id))
ORDER BY (isbn.value IS NULL), t.series_index NULLS LAST, lower(t.title), t.id
LIMIT 4;

-- name: OwnedForSeries :many
-- Every title the user can see that could be a member of a series: those in it, and those by one of its authors, so a
-- book filed under no series, or another one, is still recognised as owned. author_keys are lowercased letters and digits.
SELECT t.title, t.authors, t.series_index, COALESCE(lower(t.series_name) = sqlc.arg(name_key)::text, false)::boolean AS in_series
FROM titles t
WHERE (lower(t.series_name) = sqlc.arg(name_key)::text
    OR EXISTS (SELECT 1 FROM unnest(t.authors) AS a(name)
               WHERE regexp_replace(lower(a.name), '[^[:alnum:]]', '', 'g') = ANY (sqlc.arg(author_keys)::text[])))
  AND (EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id) WHERE e.title_id = t.id)
    OR EXISTS (SELECT 1 FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id) WHERE r.title_id = t.id));

-- name: GetSeriesMatch :one
SELECT provider, provider_ref, provider_name, url FROM series_matches WHERE name_key = $1;

-- name: UpsertSeriesMatch :exec
INSERT INTO series_matches (name_key, provider, provider_ref, provider_name, url, matched_by) VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (name_key) DO UPDATE SET provider = EXCLUDED.provider, provider_ref = EXCLUDED.provider_ref,
  provider_name = EXCLUDED.provider_name, url = EXCLUDED.url, matched_by = EXCLUDED.matched_by, matched_at = now();

-- name: DeleteSeriesMatch :exec
DELETE FROM series_matches WHERE name_key = $1;

-- name: DeleteSeriesMembers :exec
DELETE FROM series_members WHERE name_key = $1;

-- name: InsertSeriesMember :exec
INSERT INTO series_members (name_key, position, title, authors, released, url, cover, cover_version)
VALUES ($1, $2, $3, $4, $5, $6, sqlc.narg(cover), CASE WHEN sqlc.narg(cover)::bytea IS NULL THEN NULL ELSE gen_random_uuid() END);

-- name: ListSeriesMembers :many
SELECT position, title, authors, released, url, cover_version FROM series_members WHERE name_key = $1 ORDER BY position;

-- name: GetSeriesMemberCover :one
SELECT cover, cover_version FROM series_members WHERE name_key = $1 AND position = $2;
