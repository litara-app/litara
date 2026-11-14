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

-- ===== T004: library ingestion, identity, review and write-back (ADR-0044..0061) =====
-- Business state lives in these tables; River jobs only wake work (ADR-0024).
CREATE TABLE library_config (
    library_id          uuid PRIMARY KEY REFERENCES libraries (id) ON DELETE CASCADE,
    mode                text NOT NULL CHECK (mode IN ('index', 'managed')),
    root_path           text NOT NULL CHECK (root_path <> ''),
    follow_symlinks     boolean NOT NULL DEFAULT false,
    -- Operator-supplied identity sentinel (relative path + expected content hash); never auto-created.
    sentinel_path       text,
    sentinel_sha256     text,
    scan_interval_secs  integer NOT NULL DEFAULT 900 CHECK (scan_interval_secs >= 60),
    verify_interval_secs integer NOT NULL DEFAULT 86400 CHECK (verify_interval_secs >= 3600),
    stability_secs      integer NOT NULL DEFAULT 30 CHECK (stability_secs >= 1),
    import_template     text,
    writeback_backups   boolean NOT NULL DEFAULT false,
    backup_root         text,
    provider_order      text[] NOT NULL DEFAULT '{}',
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT writeback_backups OR backup_root IS NOT NULL),
    CHECK (sentinel_path IS NULL OR sentinel_sha256 IS NOT NULL)
);

CREATE TABLE root_health (
    library_id  uuid PRIMARY KEY REFERENCES libraries (id) ON DELETE CASCADE,
    state       text NOT NULL CHECK (state IN ('healthy', 'unavailable', 'identity_mismatch', 'unknown')),
    detail      text,
    checked_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scan_runs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id    uuid NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    trigger       text NOT NULL CHECK (trigger IN ('schedule', 'event', 'manual', 'verify')),
    state         text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'completed', 'failed', 'skipped')),
    health        text CHECK (health IN ('healthy', 'unavailable', 'identity_mismatch')),
    files_seen    integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    started_at    timestamptz,
    completed_at  timestamptz,
    failure       text
);
-- At most one active scan per library (serialization lives in our tables, not the queue).
CREATE UNIQUE INDEX scan_runs_one_active ON scan_runs (library_id) WHERE state IN ('queued', 'running');

CREATE TABLE file_observations (
    file_id            uuid PRIMARY KEY REFERENCES media_files (id),
    library_id         uuid NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    rel_path           text NOT NULL,
    size_bytes         bigint NOT NULL CHECK (size_bytes >= 0),
    mtime              timestamptz NOT NULL,
    first_observed_at  timestamptz NOT NULL DEFAULT now(),
    last_observed_at   timestamptz NOT NULL DEFAULT now(),
    stable             boolean NOT NULL DEFAULT false,
    missing_scans      integer NOT NULL DEFAULT 0 CHECK (missing_scans >= 0),
    missing            boolean NOT NULL DEFAULT false,
    UNIQUE (library_id, rel_path)
);

CREATE TABLE fingerprints (
    content_version  uuid PRIMARY KEY REFERENCES file_versions (content_version),
    sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    size_bytes       bigint NOT NULL CHECK (size_bytes >= 0),
    mtime            timestamptz NOT NULL,
    computed_at      timestamptz NOT NULL DEFAULT now(),
    verified_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fingerprints_sha_idx ON fingerprints (sha256);

CREATE TABLE review_items (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id   uuid NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (kind IN ('move', 'grouping', 'ordering', 'association', 'provider', 'import', 'write')),
    -- Stable key so a rescan updates, not duplicates, the same open question.
    subject_key  text NOT NULL,
    state        text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved', 'dismissed')),
    candidates   jsonb NOT NULL,
    resolution   jsonb,
    resolved_by  uuid REFERENCES users (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    resolved_at  timestamptz
);
CREATE UNIQUE INDEX review_items_one_open ON review_items (library_id, kind, subject_key) WHERE state = 'open';

CREATE TABLE move_candidates (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id    uuid NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    missing_file  uuid NOT NULL REFERENCES media_files (id),
    new_rel_path  text NOT NULL,
    sha256        text NOT NULL,
    match_kind    text NOT NULL CHECK (match_kind IN ('unique', 'ambiguous')),
    review_item   uuid REFERENCES review_items (id),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE metadata_values (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_kind text NOT NULL CHECK (subject_kind IN ('title', 'recording')),
    subject_id   uuid NOT NULL,
    field        text NOT NULL,
    source       text NOT NULL CHECK (source IN ('user', 'sidecar', 'embedded', 'provider')),
    value        jsonb,
    -- A protected clear is an explicit user value of "empty" that rescans must keep.
    protected_clear boolean NOT NULL DEFAULT false,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (subject_kind, subject_id, field, source),
    CHECK (source = 'user' OR NOT protected_clear)
);

CREATE TABLE writeback_plans (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id       uuid NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    file_id          uuid NOT NULL REFERENCES media_files (id),
    base_version     uuid NOT NULL REFERENCES file_versions (content_version),
    kind             text NOT NULL CHECK (kind IN ('sidecar', 'in_file')),
    format           text,
    diff             jsonb NOT NULL,
    approved_by      uuid REFERENCES users (id),
    stage            text NOT NULL DEFAULT 'planned'
                     CHECK (stage IN ('planned', 'approved', 'staged', 'validated', 'backed_up', 'published', 'recovered', 'abandoned', 'refused')),
    recording_id     uuid REFERENCES recordings (id) ON DELETE SET NULL,
    target_rel       text NOT NULL,
    base_sha256      text,
    staged_path      text,
    staged_sha256    text,
    backup_ref       text,
    detail           text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (kind <> 'in_file' OR format IS NOT NULL)
);

-- Per-format writer enablement; disabled until fidelity evidence is recorded (ADR-0052).
CREATE TABLE writer_capabilities (
    format       text PRIMARY KEY CHECK (format IN ('epub', 'mp3', 'flac', 'm4a', 'm4b')),
    enabled      boolean NOT NULL DEFAULT false,
    evidence_ref text,
    CHECK (NOT enabled OR evidence_ref IS NOT NULL)
);
INSERT INTO writer_capabilities (format) VALUES ('epub'), ('mp3'), ('flac'), ('m4a'), ('m4b');

-- Files seen but not yet stable (or changed since cataloged). Identity is created only after two
-- unchanged observations at least stability_secs apart (ADR-0050); nothing here is hashed or inspected.
CREATE TABLE file_candidates (
    library_id     uuid NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    rel_path       text NOT NULL,
    size_bytes     bigint NOT NULL CHECK (size_bytes >= 0),
    mtime          timestamptz NOT NULL,
    first_seen_at  timestamptz NOT NULL,
    last_seen_at   timestamptz NOT NULL,
    PRIMARY KEY (library_id, rel_path)
);

-- Normalized inspection result of one content version (T001 inspector output).
CREATE TABLE file_metadata (
    content_version uuid PRIMARY KEY REFERENCES file_versions (content_version),
    completeness    text NOT NULL CHECK (completeness IN ('complete', 'incomplete', 'failed')),
    result          jsonb,
    failure         text,
    inspected_at    timestamptz NOT NULL DEFAULT now()
);

-- Stable key so regrouping updates the same recording instead of duplicating it.
ALTER TABLE recordings ADD COLUMN group_key text;
CREATE UNIQUE INDEX recordings_group_key ON recordings (library_id, group_key) WHERE group_key IS NOT NULL;
ALTER TABLE recordings ADD COLUMN link_state text NOT NULL DEFAULT 'confirmed'
    CHECK (link_state IN ('confirmed', 'provisional'));
ALTER TABLE titles ADD COLUMN group_key text;
ALTER TABLE titles ADD COLUMN identifier text;

-- Sidecar / CUE associations (ADR-0055). Only unambiguous matches are stored as associated.
CREATE TABLE associations (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id    uuid NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    kind          text NOT NULL CHECK (kind IN ('cue', 'json', 'opf')),
    rel_path      text NOT NULL,
    recording_id  uuid REFERENCES recordings (id) ON DELETE SET NULL,
    state         text NOT NULL CHECK (state IN ('associated', 'needs_review', 'invalid')),
    detail        text,
    UNIQUE (library_id, rel_path)
);

-- One row per (recording, provider) so external lookups are not repeated (ADR-0049/0060).
CREATE TABLE provider_lookups (
    recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
    provider     text NOT NULL CHECK (provider IN ('open_library', 'google_books', 'audnexus')),
    outcome      text NOT NULL CHECK (outcome IN ('applied', 'no_match', 'needs_review', 'error', 'skipped')),
    detail       text,
    looked_up_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (recording_id, provider)
);

-- Reviewed, copy-only managed imports (ADR-0046/0054). The source is never modified or removed.
CREATE TABLE import_plans (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id   uuid NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    source_path  text NOT NULL,
    state        text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'approved', 'running', 'completed', 'failed', 'cancelled')),
    created_by   uuid REFERENCES users (id),
    approved_by  uuid REFERENCES users (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    approved_at  timestamptz,
    completed_at timestamptz
);

CREATE TABLE import_items (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id          uuid NOT NULL REFERENCES import_plans (id) ON DELETE CASCADE,
    source_rel       text NOT NULL,
    source_sha256    text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    size_bytes       bigint NOT NULL CHECK (size_bytes >= 0),
    target_rel       text NOT NULL,
    suffixed         boolean NOT NULL DEFAULT false,
    duplicate_of     uuid REFERENCES media_files (id),
    decision         text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'import', 'skip')),
    state            text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'copying', 'verified', 'published', 'failed', 'skipped')),
    detail           text,
    UNIQUE (plan_id, source_rel),
    UNIQUE (plan_id, target_rel)
);

-- +goose Down
DROP TABLE import_items;
DROP TABLE import_plans;
DROP TABLE provider_lookups;
DROP TABLE associations;
DROP TABLE file_metadata;
DROP TABLE file_candidates;
DROP TABLE writer_capabilities;
DROP TABLE writeback_plans;
DROP TABLE metadata_values;
DROP TABLE move_candidates;
DROP TABLE review_items;
DROP TABLE fingerprints;
DROP TABLE file_observations;
DROP TABLE scan_runs;
DROP TABLE root_health;
DROP TABLE library_config;
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
