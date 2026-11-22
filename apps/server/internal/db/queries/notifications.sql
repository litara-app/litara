-- name: InsertNotification :one
INSERT INTO notifications (user_id, tone, title, detail, source, read_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, tone, title, detail, source, read_at, created_at;

-- name: ListNotifications :many
SELECT id, tone, title, detail, source, read_at, created_at
FROM notifications WHERE user_id = $1
ORDER BY created_at DESC, id DESC LIMIT $2;

-- name: CountUnreadNotifications :one
SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL;

-- name: MarkNotificationsRead :exec
UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL;

-- name: ClearNotifications :exec
DELETE FROM notifications WHERE user_id = $1;

-- Keeps the newest $3 entries that are also newer than $2.
-- name: TrimNotifications :exec
DELETE FROM notifications AS d
WHERE d.user_id = $1 AND (d.created_at < $2 OR d.id IN (
  SELECT n.id FROM notifications n WHERE n.user_id = $1 ORDER BY n.created_at DESC, n.id DESC OFFSET $3));
