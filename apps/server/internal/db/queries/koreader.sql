-- name: InsertDigest :exec
INSERT INTO koreader_digests (file_id, content_version, digest) VALUES ($1, $2, $3) ON CONFLICT (file_id, content_version) DO NOTHING;

-- name: ListUnindexedFiles :many
-- Current, available, size-known ebook/comic file versions without a digest row. Bounded by the caller.
SELECT fv.file_id, fv.content_version, fv.locator, fv.size_bytes
FROM file_versions fv
JOIN editions e ON e.file_id = fv.file_id
WHERE fv.current AND fv.available AND fv.size_bytes IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM koreader_digests d WHERE d.file_id = fv.file_id AND d.content_version = fv.content_version)
ORDER BY random()
LIMIT sqlc.arg(lim);

-- name: ListDigestCandidates :many
-- Joins catalog, current version and the caller's grants before matching, so an
-- inaccessible file with the same digest is neither disclosed nor selected.
SELECT e.id AS edition_id, d.file_id, d.content_version
FROM koreader_digests d
JOIN file_versions fv ON fv.file_id = d.file_id AND fv.content_version = d.content_version AND fv.current AND fv.available
JOIN editions e ON e.file_id = d.file_id
JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = $1
WHERE d.digest = $2
ORDER BY d.file_id;

-- name: GetDigest :one
SELECT digest FROM koreader_digests WHERE file_id = $1 AND content_version = $2;

-- name: FileCurrentGranted :one
-- Is this exact version current, available, edition-bound and granted to the user? Returns the edition.
SELECT e.id AS edition_id
FROM editions e
JOIN file_versions fv ON fv.file_id = e.file_id AND fv.current AND fv.available
JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id)
WHERE e.file_id = sqlc.arg(file_id) AND fv.content_version = sqlc.arg(content_version);

-- name: GetActiveBinding :one
SELECT * FROM koreader_bindings WHERE credential_id = $1 AND document = $2 AND NOT deleted;

-- name: GetOwnBindingForUpdate :one
SELECT * FROM koreader_bindings WHERE id = $1 AND user_id = $2 FOR UPDATE;

-- name: GetBindingAny :one
SELECT * FROM koreader_bindings WHERE id = $1;

-- name: InsertBinding :one
INSERT INTO koreader_bindings (id, user_id, credential_id, document, file_id, content_version, revision) VALUES ($1, $2, $3, $4, $5, $6, 1) RETURNING *;

-- name: UpdateBinding :one
UPDATE koreader_bindings SET credential_id = $2, document = $3, file_id = $4, content_version = $5, revision = revision + 1 WHERE id = $1 RETURNING *;

-- name: DeleteBinding :one
UPDATE koreader_bindings SET deleted = true, revision = revision + 1 WHERE id = $1 RETURNING *;

-- name: ListBindings :many
SELECT b.* FROM koreader_bindings b WHERE b.user_id = $1 AND NOT b.deleted AND EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = $1 WHERE e.file_id = b.file_id) ORDER BY b.id LIMIT $2 OFFSET $3;

-- name: CountBindings :one
SELECT count(*) FROM koreader_bindings b WHERE b.user_id = $1 AND NOT b.deleted AND EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = $1 WHERE e.file_id = b.file_id);

-- name: EnsureSource :exec
INSERT INTO koreader_sources (user_id, file_id, content_version) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;

-- name: LockSource :one
SELECT * FROM koreader_sources WHERE user_id = $1 AND file_id = $2 AND content_version = $3 FOR UPDATE;

-- name: GetSource :one
SELECT * FROM koreader_sources WHERE user_id = $1 AND file_id = $2 AND content_version = $3;

-- name: SetSource :one
UPDATE koreader_sources
SET revision = revision + 1, document = $4, progress = $5, percentage = $6, device = $7, device_id = $8, accepted_ts = $9
WHERE user_id = $1 AND file_id = $2 AND content_version = $3
RETURNING *;

-- name: GetBaseline :one
SELECT * FROM koreader_baselines WHERE credential_id = $1 AND file_id = $2 AND content_version = $3;

-- name: SetBaseline :exec
INSERT INTO koreader_baselines (credential_id, file_id, content_version, revision, adoptable)
VALUES ($1, $2, $3, $4, NULL)
ON CONFLICT (credential_id, file_id, content_version) DO UPDATE SET revision = EXCLUDED.revision, adoptable = NULL;

-- name: SetAdoptable :exec
INSERT INTO koreader_baselines (credential_id, file_id, content_version, revision, adoptable)
VALUES ($1, $2, $3, NULL, $4)
ON CONFLICT (credential_id, file_id, content_version) DO UPDATE SET adoptable = EXCLUDED.adoptable;

-- name: GetKoReceipt :one
SELECT * FROM koreader_receipts WHERE credential_id = $1 AND file_id = $2 AND content_version = $3 AND fingerprint = $4;

-- name: InsertKoReceipt :exec
INSERT INTO koreader_receipts (credential_id, file_id, content_version, fingerprint, accepted, wire_status, wire_code, source_revision, accepted_ts, conflict_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING;

-- name: HasUnresolvedKoConflict :one
SELECT EXISTS (SELECT 1 FROM koreader_conflicts WHERE credential_id = $1 AND file_id = $2 AND content_version = $3 AND resolved_at IS NULL);

-- name: InsertKoConflict :one
INSERT INTO koreader_conflicts (user_id, credential_id, file_id, content_version, reason, fingerprint, document, progress, percentage, device, device_id, created_source_revision)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
ON CONFLICT (credential_id, file_id, content_version, fingerprint) DO UPDATE SET fingerprint = EXCLUDED.fingerprint
RETURNING *;

-- name: GetOwnKoConflictForUpdate :one
SELECT * FROM koreader_conflicts WHERE id = $1 AND user_id = $2 FOR UPDATE;

-- name: ListKoConflicts :many
SELECT c.* FROM koreader_conflicts c WHERE c.user_id = $1 AND EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = $1 WHERE e.file_id = c.file_id) ORDER BY c.created_at, c.id LIMIT $2 OFFSET $3;

-- name: CountKoConflicts :one
SELECT count(*) FROM koreader_conflicts c WHERE c.user_id = $1 AND EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = $1 WHERE e.file_id = c.file_id);

-- name: ResolveKoConflict :one
UPDATE koreader_conflicts SET resolved_at = COALESCE(resolved_at, now()), resolution = $2, revision = revision + 1 WHERE id = $1 RETURNING *;

-- name: BumpKoConflict :one
UPDATE koreader_conflicts SET revision = revision + 1 WHERE id = $1 RETURNING *;

-- name: GetEditionCurrentFile :one
SELECT e.file_id, fv.content_version
FROM editions e JOIN file_versions fv ON fv.file_id = e.file_id AND fv.current
WHERE e.id = $1;

-- name: CurrentVersionOf :one
SELECT content_version FROM file_versions WHERE file_id = $1 AND current;

-- name: GetOwnKoConflict :one
SELECT * FROM koreader_conflicts WHERE id = $1 AND user_id = $2;

-- name: FileGrantedToUser :one
-- Does the user hold a library grant covering this file's edition (any version)? Management reads and settlements of
-- retained KOReader state require it, so revoking a library also hides and freezes its positions and candidates.
SELECT e.id AS edition_id
FROM editions e
JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = sqlc.arg(user_id)
WHERE e.file_id = sqlc.arg(file_id)
LIMIT 1;

-- name: GetOwnBindingAny :one
SELECT * FROM koreader_bindings WHERE id = $1 AND user_id = $2;
