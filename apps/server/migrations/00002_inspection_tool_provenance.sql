-- +goose Up
-- Non-destructive upgrade: add columns/indexes only; existing rows remain valid.
ALTER TABLE inspection_results ADD COLUMN tool_version text;
CREATE INDEX inspection_requests_state_idx ON inspection_requests (state, updated_at);

-- +goose Down
DROP INDEX inspection_requests_state_idx;
ALTER TABLE inspection_results DROP COLUMN tool_version;
