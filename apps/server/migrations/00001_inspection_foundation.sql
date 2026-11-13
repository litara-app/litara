-- +goose Up
-- Minimal internal schema for T001 media inspection. Final catalog, edition,
-- library and account tables are intentionally out of scope.
CREATE TABLE inspection_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Deterministic logical identity: sha256 hex of the cleaned absolute path.
    request_key     text NOT NULL UNIQUE,
    source_path     text NOT NULL,
    state           text NOT NULL DEFAULT 'queued'
                    CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    -- Outcome of the most recent attempt (or the terminal outcome).
    outcome         text
                    CHECK (outcome IN ('ok', 'incomplete', 'missing_input', 'unreadable_input',
                                       'malformed_media', 'tool_unavailable', 'tool_failure',
                                       'io_error', 'timeout', 'output_limit', 'cancelled')),
    attempts        integer NOT NULL DEFAULT 0,
    failure_message text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    completed_at    timestamptz
);

CREATE TABLE inspection_results (
    request_id     uuid PRIMARY KEY REFERENCES inspection_requests (id) ON DELETE CASCADE,
    completeness   text NOT NULL CHECK (completeness IN ('complete', 'incomplete')),
    duration_ms    bigint,
    format_name    text,
    result         jsonb NOT NULL,
    inspected_at   timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE inspection_results;
DROP TABLE inspection_requests;
