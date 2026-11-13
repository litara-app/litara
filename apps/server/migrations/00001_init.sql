-- +goose Up
-- Pre-production baseline: consolidate schema changes here until production (ADR-0030).
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
    inspected_at   timestamptz NOT NULL DEFAULT now(),
    tool_version   text
);

CREATE INDEX inspection_requests_state_idx ON inspection_requests (state, updated_at);

-- ===== T003: accounts, grants, sessions, seeded catalog, progress (ADR-0030..0043) =====
CREATE TABLE server_identity (
    singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    server_id  uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username_key  text NOT NULL UNIQUE,
    username      text NOT NULL,
    display_name  text NOT NULL,
    password_hash text NOT NULL,
    is_admin      boolean NOT NULL DEFAULT false,
    active        boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE libraries (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_library_grants (
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    library_id uuid NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, library_id)
);

CREATE TABLE sessions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind                text NOT NULL CHECK (kind IN ('native', 'web')),
    device_name         text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    last_used_at        timestamptz NOT NULL DEFAULT now(),
    idle_expires_at     timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    revoked_at          timestamptz,
    revoked_reason      text,
    -- SHA-256 verifiers of high-entropy random tokens; plaintext is never stored.
    access_hash         bytea UNIQUE,
    access_expires_at   timestamptz,
    refresh_hash        bytea UNIQUE,
    refresh_generation  integer NOT NULL DEFAULT 1
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- One row per rotation. response_ciphertext (AES-GCM, key from LITARA_SECRET_KEY)
-- holds the recoverable successful response for 60 seconds, then is cleared; the
-- nonsecret old-token verifier + request id remain to classify late retries.
CREATE TABLE refresh_exchanges (
    session_id          uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    old_refresh_hash    bytea NOT NULL,
    request_id          uuid NOT NULL,
    generation          integer NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    response_ciphertext bytea,
    PRIMARY KEY (session_id, old_refresh_hash)
);
CREATE INDEX refresh_exchanges_old_idx ON refresh_exchanges (old_refresh_hash);

CREATE TABLE titles (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title        text NOT NULL,
    authors      text[] NOT NULL DEFAULT '{}',
    series_name  text,
    series_index double precision,
    seed_key     text UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recordings (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title_id          uuid NOT NULL REFERENCES titles (id),
    library_id        uuid NOT NULL REFERENCES libraries (id),
    narrators         text[] NOT NULL DEFAULT '{}',
    layout_revision   uuid NOT NULL DEFAULT gen_random_uuid(),
    thumbnail_locator text,
    thumbnail_mime    text,
    cover_locator     text,
    cover_mime        text,
    seed_key          text UNIQUE,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recordings_library_idx ON recordings (library_id);

-- Stable file identity; bytes live in file_versions (locator is internal only).
CREATE TABLE media_files (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE file_versions (
    content_version uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id         uuid NOT NULL REFERENCES media_files (id),
    locator         text NOT NULL,
    filename        text NOT NULL,
    mime_type       text NOT NULL,
    size_bytes      bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
    duration_ms     bigint CHECK (duration_ms IS NULL OR duration_ms > 0),
    available       boolean NOT NULL DEFAULT true,
    current         boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX file_versions_one_current ON file_versions (file_id) WHERE current;

CREATE TABLE recording_files (
    recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
    sequence     integer NOT NULL CHECK (sequence >= 0),
    file_id      uuid NOT NULL REFERENCES media_files (id),
    PRIMARY KEY (recording_id, sequence),
    UNIQUE (recording_id, file_id) DEFERRABLE INITIALLY DEFERRED
);

-- Seeded normalized candidate chapter sources (T004 owns real CUE/embedded extraction).
-- starts: [{fileId, contentVersion, offsetMs, label}] in recording order.
CREATE TABLE chapter_sources (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
    source       text NOT NULL CHECK (source IN ('user', 'cue', 'embedded')),
    starts       jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (recording_id, source)
);

CREATE TABLE position_state (
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    recording_id    uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
    revision        bigint NOT NULL DEFAULT 0,
    file_id         uuid,
    content_version uuid,
    offset_ms       bigint,
    layout_revision uuid,
    captured_at     timestamptz,
    received_at     timestamptz,
    device_name     text,
    PRIMARY KEY (user_id, recording_id)
);

-- Latest per-device candidate evidence; kept even when the canonical position advances.
CREATE TABLE position_evidence (
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    recording_id    uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
    session_id      uuid NOT NULL,
    file_id         uuid NOT NULL,
    content_version uuid NOT NULL,
    offset_ms       bigint NOT NULL,
    layout_revision uuid NOT NULL,
    captured_at     timestamptz NOT NULL,
    received_at     timestamptz NOT NULL,
    device_name     text NOT NULL,
    PRIMARY KEY (user_id, recording_id, session_id)
);

CREATE TABLE completion_state (
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
    revision     bigint NOT NULL DEFAULT 0,
    finished     boolean NOT NULL DEFAULT false,
    changed_at   timestamptz,
    PRIMARY KEY (user_id, recording_id)
);

CREATE TABLE completion_history (
    seq          bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title_id     uuid NOT NULL REFERENCES titles (id),
    recording_id uuid NOT NULL REFERENCES recordings (id),
    event        text NOT NULL CHECK (event IN ('natural_end', 'manual_finish', 'manual_unfinish')),
    operation_id uuid NOT NULL,
    captured_at  timestamptz NOT NULL,
    received_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, recording_id, operation_id)
);
CREATE INDEX completion_history_title_idx ON completion_history (user_id, title_id, seq);

-- Receipts are never pruned automatically. Idempotency scope: user + recording + operation.
CREATE TABLE operation_receipts (
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
    operation_id uuid NOT NULL,
    kind         text NOT NULL,
    fingerprint  bytea NOT NULL,
    status       integer NOT NULL,
    body         jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, recording_id, operation_id)
);

CREATE TABLE conflicts (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    recording_id          uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
    kind                  text NOT NULL CHECK (kind IN ('position', 'completion')),
    reason                text NOT NULL CHECK (reason IN ('stale_revision', 'layout_changed', 'content_changed', 'completion_changed')),
    operation_id          uuid NOT NULL,
    -- Position conflicts: the attempted PositionWrite position + device context.
    -- Completion conflicts: the attempted CompletionWrite event.
    candidate             jsonb NOT NULL,
    base_revision         bigint NOT NULL,
    layout_revision       uuid,
    created_at            timestamptz NOT NULL DEFAULT now(),
    resolved_at           timestamptz,
    resolved_operation_id uuid
);
CREATE INDEX conflicts_open_idx ON conflicts (user_id, recording_id) WHERE resolved_at IS NULL;

-- +goose Down
DROP TABLE conflicts;
DROP TABLE operation_receipts;
DROP TABLE completion_history;
DROP TABLE completion_state;
DROP TABLE position_evidence;
DROP TABLE position_state;
DROP TABLE chapter_sources;
DROP TABLE recording_files;
DROP TABLE file_versions;
DROP TABLE media_files;
DROP TABLE recordings;
DROP TABLE titles;
DROP TABLE refresh_exchanges;
DROP TABLE sessions;
DROP TABLE user_library_grants;
DROP TABLE libraries;
DROP TABLE users;
DROP TABLE server_identity;
DROP TABLE inspection_results;
DROP TABLE inspection_requests;
