-- name: ListMetadataValues :many
SELECT * FROM metadata_values WHERE subject_kind = $1 AND subject_id = $2 ORDER BY field, source;

-- name: UpsertMetadataValue :exec
INSERT INTO metadata_values (subject_kind, subject_id, field, source, value, protected_clear)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (subject_kind, subject_id, field, source) DO UPDATE SET value = EXCLUDED.value,
    protected_clear = EXCLUDED.protected_clear, updated_at = now();

-- name: DeleteMetadataValue :exec
DELETE FROM metadata_values WHERE subject_kind = $1 AND subject_id = $2 AND field = $3 AND source = $4;

-- name: GetTitleRow :one
SELECT id, title, authors, series_name, series_index, identifier FROM titles WHERE id = $1;

-- name: UpdateTitleFields :exec
UPDATE titles SET title = $2, authors = $3, series_name = $4, series_index = $5 WHERE id = $1;

-- name: GetRecordingRow :one
SELECT id, title_id, library_id, narrators FROM recordings WHERE id = $1;

-- name: UpdateRecordingNarrators :exec
UPDATE recordings SET narrators = $2 WHERE id = $1;

-- name: ListLibraryAssociated :many
SELECT kind, rel_path, recording_id FROM associations
WHERE library_id = $1 AND state = 'associated' AND kind IN ('json', 'opf') AND recording_id IS NOT NULL ORDER BY rel_path;

-- name: GetProviderLookup :one
SELECT * FROM provider_lookups WHERE recording_id = $1 AND provider = $2;

-- name: SetProviderLookup :exec
INSERT INTO provider_lookups (recording_id, provider, outcome, detail) VALUES ($1, $2, $3, $4)
ON CONFLICT (recording_id, provider) DO UPDATE SET outcome = EXCLUDED.outcome, detail = EXCLUDED.detail, looked_up_at = now();
