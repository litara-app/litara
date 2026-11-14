-- name: InsertLibrary :one
INSERT INTO libraries (id, name) VALUES ($1, $2) RETURNING *;

-- name: GetLibraryConfig :one
SELECT * FROM library_config WHERE library_id = $1;

-- name: UpsertLibraryConfig :one
INSERT INTO library_config (library_id, mode, root_path, follow_symlinks, sentinel_path, sentinel_sha256,
                            scan_interval_secs, verify_interval_secs, stability_secs, import_template,
                            writeback_backups, backup_root, provider_order)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
ON CONFLICT (library_id) DO UPDATE SET
    mode = EXCLUDED.mode, root_path = EXCLUDED.root_path, follow_symlinks = EXCLUDED.follow_symlinks,
    sentinel_path = EXCLUDED.sentinel_path, sentinel_sha256 = EXCLUDED.sentinel_sha256,
    scan_interval_secs = EXCLUDED.scan_interval_secs, verify_interval_secs = EXCLUDED.verify_interval_secs,
    stability_secs = EXCLUDED.stability_secs, import_template = EXCLUDED.import_template,
    writeback_backups = EXCLUDED.writeback_backups, backup_root = EXCLUDED.backup_root,
    provider_order = EXCLUDED.provider_order, updated_at = now()
RETURNING *;

-- name: GetRootHealth :one
SELECT * FROM root_health WHERE library_id = $1;

-- name: UpsertRootHealth :exec
INSERT INTO root_health (library_id, state, detail, checked_at) VALUES ($1, $2, $3, now())
ON CONFLICT (library_id) DO UPDATE SET state = EXCLUDED.state, detail = EXCLUDED.detail, checked_at = now();
