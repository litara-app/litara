-- name: GetShelf :one
SELECT * FROM shelves WHERE id = $1;

-- name: InsertShelf :exec
INSERT INTO shelves (id, owner_id, kind, visibility, name, filter, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $7);

-- name: UpdateShelf :exec
UPDATE shelves SET revision = revision + 1, visibility = $2, name = $3, filter = $4, updated_at = $5 WHERE id = $1;

-- name: BumpShelf :exec
UPDATE shelves SET revision = revision + 1, updated_at = $2 WHERE id = $1;

-- name: TombstoneShelf :exec
UPDATE shelves SET revision = revision + 1, deleted = true, updated_at = $2 WHERE id = $1;

-- name: ListShelvesPage :many
SELECT * FROM shelves s
WHERE CASE WHEN sqlc.arg(scope)::text = 'mine'
           THEN s.owner_id = sqlc.arg(user_id) AND (sqlc.arg(include_deleted)::boolean OR NOT s.deleted)
           ELSE s.visibility = 'shared' AND NOT s.deleted AND s.owner_id <> sqlc.arg(user_id) END
ORDER BY s.id LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountShelvesPage :one
SELECT count(*) FROM shelves s
WHERE CASE WHEN sqlc.arg(scope)::text = 'mine'
           THEN s.owner_id = sqlc.arg(user_id) AND (sqlc.arg(include_deleted)::boolean OR NOT s.deleted)
           ELSE s.visibility = 'shared' AND NOT s.deleted AND s.owner_id <> sqlc.arg(user_id) END;

-- Members visible to a viewer: a title in at least one granted library.
-- name: ListVisibleShelfMembers :many
SELECT m.title_id FROM shelf_titles m
WHERE m.shelf_id = sqlc.arg(shelf_id)
  AND (EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id) WHERE e.title_id = m.title_id)
    OR EXISTS (SELECT 1 FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id) WHERE r.title_id = m.title_id))
ORDER BY m.position, m.title_id;

-- name: ListShelfMemberRows :many
SELECT title_id, position FROM shelf_titles WHERE shelf_id = $1 ORDER BY position, title_id;

-- name: HasShelfMember :one
SELECT EXISTS (SELECT 1 FROM shelf_titles WHERE shelf_id = $1 AND title_id = $2);

-- name: AppendShelfMember :exec
INSERT INTO shelf_titles (shelf_id, title_id, position)
VALUES ($1, $2, COALESCE((SELECT max(position) FROM shelf_titles WHERE shelf_id = $1), 0) + 1);

-- name: DeleteShelfMember :exec
DELETE FROM shelf_titles WHERE shelf_id = $1 AND title_id = $2;

-- name: SetShelfMemberPosition :exec
UPDATE shelf_titles SET position = $3 WHERE shelf_id = $1 AND title_id = $2;

-- name: UserSeesTitle :one
SELECT (EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = $1 WHERE e.title_id = $2)
     OR EXISTS (SELECT 1 FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = $1 WHERE r.title_id = $2))::boolean;

-- name: ListTitlesByIDs :many
SELECT t.id, t.title, t.authors, t.series_name,
       (SELECT count(*) FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id) WHERE e.title_id = t.id)::bigint AS edition_count,
       (SELECT count(*) FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = sqlc.arg(user_id) WHERE r.title_id = t.id)::bigint AS recording_count,
       COALESCE((SELECT array_agg(DISTINCT e.language) FILTER (WHERE e.language IS NOT NULL)
                 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id)
                 WHERE e.title_id = t.id), '{}')::text[] AS languages
FROM titles t WHERE t.id = ANY(sqlc.arg(ids)::uuid[]);
