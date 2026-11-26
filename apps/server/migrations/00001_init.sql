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
    -- A short name from the web app's icon set (null means the default icon).
    icon       text CHECK (icon IS NULL OR icon ~ '^[a-z0-9-]{1,32}$'),
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
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- Advances whenever a stored metadata value of the title or of one of its recordings changes, from any source, so an
    -- audiobook metadata save based on an older revision is a conflict instead of an overwrite (ADR-0095 decision 4).
    metadata_revision bigint NOT NULL DEFAULT 0 CHECK (metadata_revision >= 0)
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
    created_at        timestamptz NOT NULL DEFAULT now(),
    -- A repaired recording keeps its ID as a non-playable tombstone with ordered
    -- successor references (ADR-0070). Its state, history and conflicts stay.
    tombstoned_at     timestamptz,
    successor_ids     uuid[] NOT NULL DEFAULT '{}'
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
    reason                text NOT NULL CHECK (reason IN ('stale_revision', 'layout_changed', 'content_changed', 'completion_changed', 'recording_repaired', 'repair_source')),
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
    -- Whether auto-fill may use one clear title-and-author match when a book has no identifier (ADR-0090). Off by default.
    autofill_title_match boolean NOT NULL DEFAULT false,
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
    -- A lock is the person's own choice and separate from the value (ADR-0097): only a user row can be locked, and a
    -- locked field accepts no change until it is unlocked. Unlocking keeps the value.
    locked       boolean NOT NULL DEFAULT false,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (subject_kind, subject_id, field, source),
    CHECK (source = 'user' OR NOT protected_clear),
    CHECK (source = 'user' OR NOT locked)
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

-- T005 editions (ADR-0065): each distinct ebook/comic file owns one edition. The file
-- ID is the stable identity across moves and same-path replacements. Library
-- access is derived from the edition's library; no recording is ever faked.
CREATE TABLE editions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title_id    uuid NOT NULL REFERENCES titles (id),
    library_id  uuid NOT NULL REFERENCES libraries (id),
    file_id     uuid NOT NULL UNIQUE REFERENCES media_files (id),
    revision    bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    label       text NOT NULL DEFAULT '',
    language    text,
    format      text NOT NULL CHECK (format IN ('epub', 'kepub', 'mobi', 'azw', 'azw3', 'fb2', 'pdf', 'cbz', 'cbr', 'cb7')),
    -- provisional links are conservative guesses that await review (ADR-0061).
    link_state  text NOT NULL DEFAULT 'provisional' CHECK (link_state IN ('confirmed', 'provisional')),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX editions_title_idx ON editions (title_id);
CREATE INDEX editions_library_idx ON editions (library_id);

-- A Litara JSON or OPF sidecar, and a sidecar export plan, can belong to one ebook edition instead of a recording (ADR-0081).
ALTER TABLE associations ADD COLUMN edition_id uuid REFERENCES editions (id) ON DELETE SET NULL;
ALTER TABLE writeback_plans ADD COLUMN edition_id uuid REFERENCES editions (id) ON DELETE SET NULL;

-- T005 personal reading state for editions (ADR-0065). Revisions start at 0 (absent row).
CREATE TABLE edition_position_state (
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    edition_id      uuid NOT NULL REFERENCES editions (id),
    revision        bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    file_id         uuid,
    content_version uuid,
    locator         jsonb,
    captured_at     timestamptz,
    received_at     timestamptz,
    device_name     text,
    PRIMARY KEY (user_id, edition_id)
);

-- Latest per-device candidate evidence; kept when the canonical position advances.
CREATE TABLE edition_position_evidence (
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    edition_id      uuid NOT NULL REFERENCES editions (id),
    session_id      uuid NOT NULL,
    file_id         uuid NOT NULL,
    content_version uuid NOT NULL,
    locator         jsonb NOT NULL,
    captured_at     timestamptz NOT NULL,
    received_at     timestamptz NOT NULL,
    device_name     text NOT NULL,
    PRIMARY KEY (user_id, edition_id, session_id)
);

CREATE TABLE edition_completion_state (
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    edition_id uuid NOT NULL REFERENCES editions (id),
    revision   bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    finished   boolean NOT NULL DEFAULT false,
    changed_at timestamptz,
    PRIMARY KEY (user_id, edition_id)
);

-- Immutable per-edition title history; recording history stays in completion_history.
CREATE TABLE edition_history (
    seq             bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title_id        uuid NOT NULL REFERENCES titles (id),
    edition_id      uuid NOT NULL REFERENCES editions (id),
    file_id         uuid NOT NULL,
    content_version uuid NOT NULL,
    event           text NOT NULL CHECK (event IN ('manual_finish', 'manual_unfinish')),
    operation_id    uuid NOT NULL,
    captured_at     timestamptz NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, operation_id)
);
CREATE INDEX edition_history_title_idx ON edition_history (user_id, title_id, seq);

-- One receipt namespace per authenticated user across every T005 personal mutation kind.
-- Never pruned automatically. Fingerprint covers method, resource and semantic request.
CREATE TABLE t005_receipts (
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    operation_id uuid NOT NULL,
    fingerprint  bytea NOT NULL,
    status       integer NOT NULL,
    body         jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, operation_id)
);

CREATE TABLE t005_conflicts (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    resource_kind         text NOT NULL CHECK (resource_kind IN ('position', 'completion', 'annotation', 'shelf', 'membership', 'shelf-order')),
    resource_id           uuid NOT NULL,
    edition_id            uuid REFERENCES editions (id),
    reason                text NOT NULL CHECK (reason IN ('stale_revision', 'content_changed', 'locator_incompatible', 'deleted', 'access_changed')),
    operation_id          uuid NOT NULL,
    candidate             jsonb NOT NULL,
    base_revision         bigint NOT NULL,
    current_revision      bigint NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    resolved_at           timestamptz,
    resolved_operation_id uuid,
    resolved_revision     bigint
);
CREATE INDEX t005_conflicts_user_idx ON t005_conflicts (user_id, resource_id, created_at);

-- T005 private annotations (ADR-0066). Client-generated UUID; kind immutable; deleting keeps
-- a tombstone. Content columns stay as private evidence after deletion; the wire hides them.
CREATE TABLE annotations (
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    id              uuid NOT NULL,
    edition_id      uuid NOT NULL REFERENCES editions (id),
    revision        bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    kind            text NOT NULL CHECK (kind IN ('highlight', 'note', 'bookmark')),
    deleted         boolean NOT NULL DEFAULT false,
    file_id         uuid NOT NULL,
    content_version uuid NOT NULL,
    locator         jsonb NOT NULL,
    selection       jsonb,
    text            text NOT NULL DEFAULT '',
    quote           text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id)
);
CREATE INDEX annotations_edition_idx ON annotations (user_id, edition_id, id);

-- T005 manual and smart shelves (ADR-0066). Kind is immutable; non-owners never edit.
CREATE TABLE shelves (
    id         uuid PRIMARY KEY,
    owner_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    revision   bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    kind       text NOT NULL CHECK (kind IN ('manual', 'smart')),
    visibility text NOT NULL CHECK (visibility IN ('private', 'shared')),
    name       text NOT NULL,
    filter     jsonb,
    deleted    boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'manual') = (filter IS NULL))
);
CREATE INDEX shelves_owner_idx ON shelves (owner_id, id);

-- Manual membership: unique per shelf/title with a stable total order. Smart shelves
-- never materialize membership.
CREATE TABLE shelf_titles (
    shelf_id uuid NOT NULL REFERENCES shelves (id),
    title_id uuid NOT NULL REFERENCES titles (id),
    position bigint NOT NULL,
    PRIMARY KEY (shelf_id, title_id)
);
CREATE INDEX shelf_titles_order_idx ON shelf_titles (shelf_id, position, title_id);

-- T005 per-edition metadata sources (ADR-0065). Protected user edits/clears outrank
-- sidecar, embedded and provider values; the file name is a computed lowest fallback.
CREATE TABLE edition_metadata_values (
    edition_id      uuid NOT NULL REFERENCES editions (id),
    field           text NOT NULL CHECK (field IN ('title', 'authors', 'series_name', 'series_index', 'language', 'tags', 'publisher', 'published', 'page_count', 'isbn', 'description',
                                             'subtitle', 'genres', 'moods', 'age_rating', 'asin', 'open_library_id', 'google_books_id', 'hardcover_id', 'goodreads_id', 'public_rating', 'public_rating_count')),
    source          text NOT NULL CHECK (source IN ('user', 'sidecar', 'embedded', 'provider')),
    value           jsonb,
    protected_clear boolean NOT NULL DEFAULT false,
    -- The person's lock (ADR-0097), as on metadata_values.
    locked          boolean NOT NULL DEFAULT false,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (edition_id, field, source),
    CHECK (source = 'user' OR NOT protected_clear),
    CHECK (source = 'user' OR NOT locked)
);

-- Personal rating, review and reading-date overrides (ADR-0081). Private to the account; a revisioned whole-row write.
-- rating_halves counts half stars (1 to 10). Derived dates come from reading history; started_at and finished_at are the
-- person's own overrides and win until cleared.
CREATE TABLE title_personal (
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title_id      uuid NOT NULL REFERENCES titles (id),
    revision      bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    rating_halves smallint CHECK (rating_halves BETWEEN 1 AND 10),
    review        text CHECK (review IS NULL OR char_length(review) <= 20000),
    started_at    timestamptz,
    finished_at   timestamptz,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, title_id)
);

-- T005 comic page extraction (ADR-0067): one durable job and manifest per file
-- version and extraction profile. Cache files live outside the library roots;
-- paths are derived from the row ID and never exposed.
CREATE TABLE comic_extractions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id          uuid NOT NULL REFERENCES media_files (id),
    content_version  uuid NOT NULL,
    profile          text NOT NULL,
    status           text NOT NULL CHECK (status IN ('processing', 'ready', 'incomplete', 'unsupported')),
    manifest_version uuid NOT NULL DEFAULT gen_random_uuid(),
    pages            jsonb NOT NULL DEFAULT '[]',
    issues           jsonb NOT NULL DEFAULT '[]',
    cache_bytes      bigint NOT NULL DEFAULT 0 CHECK (cache_bytes >= 0),
    reserved_bytes   bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_used_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (file_id, content_version, profile)
);

-- Active recordings: every catalog, count, scan and authorization query reads this
-- view so a tombstoned source can never be listed, served or matched again.
CREATE VIEW active_recordings AS SELECT * FROM recordings WHERE tombstoned_at IS NULL;

-- T005 reviewed recording repair plans (ADR-0070). Sources and outputs are the
-- immutable reviewed layout; the plan revision gates approve/execute/cancel.
CREATE TABLE repair_plans (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id   uuid NOT NULL REFERENCES users (id),
    library_id uuid NOT NULL REFERENCES libraries (id),
    title_id   uuid NOT NULL REFERENCES titles (id),
    kind       text NOT NULL CHECK (kind IN ('merge', 'split')),
    state      text NOT NULL CHECK (state IN ('planned', 'approved', 'applied', 'cancelled', 'stale')),
    revision   bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    sources    jsonb NOT NULL,
    outputs    jsonb NOT NULL,
    result     jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- T006 integrations (ADR-0073..0076). The settings singleton starts with every
-- integration disabled; revisions start at zero. Protocol credentials are
-- separate from login sessions: only a slow verifier of the presented secret is
-- stored (for koreader the verifier covers the transmitted MD5 x-auth-key).
CREATE TABLE integration_settings (
    singleton                  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    revision                   bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    opds_enabled               boolean NOT NULL DEFAULT false,
    email_enabled              boolean NOT NULL DEFAULT false,
    koreader_enabled           boolean NOT NULL DEFAULT false,
    max_attachment_bytes       bigint NOT NULL DEFAULT 26214400 CHECK (max_attachment_bytes BETWEEN 1 AND 104857600),
    max_deliveries_per_hour    integer NOT NULL DEFAULT 10 CHECK (max_deliveries_per_hour BETWEEN 1 AND 100),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);
INSERT INTO integration_settings (singleton) VALUES (true);

CREATE TABLE integration_credentials (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (kind IN ('opds', 'koreader')),
    username     text NOT NULL UNIQUE,
    label        text NOT NULL,
    verifier     text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    revoked_at   timestamptz,
    last_used_at timestamptz
);
CREATE INDEX integration_credentials_user_idx ON integration_credentials (user_id, created_at, id);

-- T006 OPDS publications (ADR-0073): one row per downloadable original. An
-- ebook/comic publication is the edition (its ID is the stable publication ID);
-- an audio publication is one file of an active recording (its file ID is the
-- publication ID). Only current, available files with known size appear, so no
-- advertised link names absent bytes. Grants are joined by the queries.
-- Effective descriptive value of an edition or a title (ADR-0047 order: user, sidecar, embedded, provider). A protected
-- clear is a user row with a null value, so it wins and yields null. Used by feeds that list many books at once.
CREATE FUNCTION effective_edition_field(ed uuid, f text) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT value FROM edition_metadata_values WHERE edition_id = ed AND field = f
    ORDER BY CASE source WHEN 'user' THEN 0 WHEN 'sidecar' THEN 1 WHEN 'embedded' THEN 2 ELSE 3 END LIMIT 1
$$;
CREATE FUNCTION effective_title_field(tid uuid, f text) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT value FROM metadata_values WHERE subject_kind = 'title' AND subject_id = tid AND field = f
    ORDER BY CASE source WHEN 'user' THEN 0 WHEN 'sidecar' THEN 1 WHEN 'embedded' THEN 2 ELSE 3 END LIMIT 1
$$;

CREATE VIEW opds_publication_rows AS
SELECT e.id AS publication_id,
       CASE WHEN e.format IN ('cbz', 'cbr', 'cb7') THEN 'comic' ELSE 'ebook' END::text AS media_kind,
       e.library_id, t.id AS title_id, t.title, t.authors, t.series_name, t.series_index,
       e.language, e.label, '{}'::text[] AS narrators,
       e.file_id, fv.content_version, fv.filename, fv.mime_type, fv.size_bytes, fv.created_at AS updated_at,
       NULL::uuid AS recording_id, 0::int AS file_order, 1::int AS file_count,
       (effective_edition_field(e.id, 'publisher') #>> '{}')::text AS publisher,
       (effective_edition_field(e.id, 'published') #>> '{}')::text AS published,
       (effective_edition_field(e.id, 'isbn') #>> '{}')::text AS isbn,
       (effective_edition_field(e.id, 'description') #>> '{}')::text AS synopsis,
       (effective_edition_field(e.id, 'page_count') #>> '{}')::int AS page_count
FROM editions e
JOIN titles t ON t.id = e.title_id
JOIN file_versions fv ON fv.file_id = e.file_id AND fv.current AND fv.available AND fv.size_bytes IS NOT NULL
UNION ALL
SELECT rf.file_id AS publication_id, 'audio'::text AS media_kind,
       r.library_id, t.id AS title_id, t.title, t.authors, t.series_name, t.series_index,
       NULL::text AS language, ''::text AS label, r.narrators,
       rf.file_id, fv.content_version, fv.filename, fv.mime_type, fv.size_bytes, fv.created_at AS updated_at,
       r.id AS recording_id, (rf.sequence + 1)::int AS file_order,
       (SELECT count(*)::int FROM recording_files c WHERE c.recording_id = r.id) AS file_count,
       (effective_title_field(t.id, 'publisher') #>> '{}')::text AS publisher,
       (effective_title_field(t.id, 'published') #>> '{}')::text AS published,
       (effective_title_field(t.id, 'isbn') #>> '{}')::text AS isbn,
       (effective_title_field(t.id, 'description') #>> '{}')::text AS synopsis,
       NULL::int AS page_count
FROM recording_files rf
JOIN active_recordings r ON r.id = rf.recording_id
JOIN titles t ON t.id = r.title_id
JOIN file_versions fv ON fv.file_id = rf.file_id AND fv.current AND fv.available AND fv.size_bytes IS NOT NULL;

-- T006 KOReader (ADR-0075/0076): a position source separate from web/Android
-- state and completion. Everything is keyed to an exact file version so bytes
-- are never given a position saved for other bytes.
CREATE TABLE koreader_digests (
    file_id         uuid NOT NULL REFERENCES media_files (id),
    content_version uuid NOT NULL REFERENCES file_versions (content_version),
    digest          text NOT NULL CHECK (digest ~ '^[0-9a-f]{32}$'),
    computed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (file_id, content_version)
);
CREATE INDEX koreader_digests_digest_idx ON koreader_digests (digest);

CREATE TABLE koreader_bindings (
    id              uuid PRIMARY KEY,
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    credential_id   uuid NOT NULL REFERENCES integration_credentials (id),
    document        text NOT NULL CHECK (document ~ '^[0-9a-f]{32}$'),
    file_id         uuid NOT NULL REFERENCES media_files (id),
    content_version uuid NOT NULL REFERENCES file_versions (content_version),
    revision        bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    deleted         boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX koreader_bindings_active ON koreader_bindings (credential_id, document) WHERE NOT deleted;
CREATE INDEX koreader_bindings_user_idx ON koreader_bindings (user_id, id);

-- Canonical KOReader position per owner and exact file version. Revision 0 = no position.
CREATE TABLE koreader_sources (
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    file_id         uuid NOT NULL REFERENCES media_files (id),
    content_version uuid NOT NULL REFERENCES file_versions (content_version),
    revision        bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    document        text,
    progress        text,
    percentage      double precision,
    device          text,
    device_id       text,
    accepted_ts     bigint,
    PRIMARY KEY (user_id, file_id, content_version)
);

-- Per-device adopted baseline. revision is what the device last provably saw or
-- wrote; adoptable is set only by an explicit owner resolution and is consumed
-- by the device's next read if the source still has that revision.
CREATE TABLE koreader_baselines (
    credential_id   uuid NOT NULL REFERENCES integration_credentials (id),
    file_id         uuid NOT NULL REFERENCES media_files (id),
    content_version uuid NOT NULL REFERENCES file_versions (content_version),
    revision        bigint,
    adoptable       bigint,
    PRIMARY KEY (credential_id, file_id, content_version)
);

CREATE TABLE koreader_conflicts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    credential_id   uuid NOT NULL REFERENCES integration_credentials (id),
    file_id         uuid NOT NULL REFERENCES media_files (id),
    content_version uuid NOT NULL REFERENCES file_versions (content_version),
    reason          text NOT NULL CHECK (reason IN ('baseline_required', 'stale_revision', 'content_changed', 'unresolved_candidate')),
    fingerprint     bytea NOT NULL,
    document        text NOT NULL,
    progress        text NOT NULL,
    percentage      double precision NOT NULL,
    device          text NOT NULL,
    device_id       text,
    revision        bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_source_revision bigint NOT NULL,
    resolved_at     timestamptz,
    resolution      text CHECK (resolution IN ('keep_server', 'use_candidate')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (credential_id, file_id, content_version, fingerprint)
);
CREATE INDEX koreader_conflicts_user_idx ON koreader_conflicts (user_id, created_at, id);

-- Immutable per-payload outcomes. A repeat of an accepted payload replays only
-- while that result is still canonical; a repeat of a refused payload always
-- replays its recorded failure. Never pruned automatically.
CREATE TABLE koreader_receipts (
    credential_id   uuid NOT NULL REFERENCES integration_credentials (id),
    file_id         uuid NOT NULL REFERENCES media_files (id),
    content_version uuid NOT NULL REFERENCES file_versions (content_version),
    fingerprint     bytea NOT NULL,
    accepted        boolean NOT NULL,
    wire_status     integer NOT NULL,
    wire_code       integer,
    source_revision bigint,
    accepted_ts     bigint,
    conflict_id     uuid REFERENCES koreader_conflicts (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (credential_id, file_id, content_version, fingerprint)
);

-- T006 email delivery (ADR-0074). SMTP passwords are recoverable secrets, so they
-- are stored only as AES-256-GCM ciphertext under an operator-supplied key ring
-- (key ID + nonce + ciphertext); nothing here derives from a login secret.
CREATE TABLE smtp_configs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_kind   text NOT NULL CHECK (owner_kind IN ('server', 'personal')),
    user_id      uuid REFERENCES users (id) ON DELETE CASCADE,
    revision     bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    enabled      boolean NOT NULL DEFAULT false,
    host         text NOT NULL DEFAULT '',
    port         integer NOT NULL DEFAULT 587 CHECK (port BETWEEN 1 AND 65535),
    tls_mode     text NOT NULL DEFAULT 'starttls' CHECK (tls_mode IN ('starttls', 'implicit', 'local_test_plain')),
    username     text NOT NULL DEFAULT '',
    from_address text NOT NULL DEFAULT '',
    key_id       text,
    nonce        bytea,
    ciphertext   bytea,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CHECK ((owner_kind = 'server' AND user_id IS NULL) OR (owner_kind = 'personal' AND user_id IS NOT NULL)),
    CHECK ((ciphertext IS NULL) = (nonce IS NULL) AND (ciphertext IS NULL) = (key_id IS NULL))
);
CREATE UNIQUE INDEX smtp_configs_server_one ON smtp_configs (owner_kind) WHERE owner_kind = 'server';
CREATE UNIQUE INDEX smtp_configs_personal_one ON smtp_configs (user_id) WHERE owner_kind = 'personal';
CREATE UNIQUE INDEX smtp_configs_nonce_unique ON smtp_configs (key_id, nonce) WHERE nonce IS NOT NULL;

CREATE TABLE delivery_recipients (
    id         uuid PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    revision   bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    deleted    boolean NOT NULL DEFAULT false,
    name       text NOT NULL,
    address    text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_recipients_user_idx ON delivery_recipients (user_id, created_at, id);

-- One row per explicit send intent. Recipient and transport identity are
-- snapshotted by revision; passwords and file bytes are never stored here.
-- attempt_open is the durable submission boundary: set after the server accepts
-- DATA and before the message terminator can be sent.
CREATE TABLE deliveries (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    file_id            uuid NOT NULL REFERENCES media_files (id),
    content_version    uuid NOT NULL REFERENCES file_versions (content_version),
    recipient_id       uuid NOT NULL REFERENCES delivery_recipients (id),
    recipient_revision bigint NOT NULL,
    recipient_name     text NOT NULL,
    recipient_address  text NOT NULL,
    transport          text NOT NULL CHECK (transport IN ('server', 'personal')),
    transport_revision bigint NOT NULL,
    state              text NOT NULL CHECK (state IN ('queued', 'sending', 'retry_wait', 'accepted', 'failed', 'outcome_unknown', 'cancelled')),
    attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    attempt_open       boolean NOT NULL DEFAULT false,
    revision           bigint NOT NULL DEFAULT 0,
    code               text,
    resend_of          uuid REFERENCES deliveries (id),
    next_attempt_at    timestamptz NOT NULL DEFAULT now(),
    -- A live attempt holds a lease; only an expired lease means the worker crashed.
    lease_until        timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_user_idx ON deliveries (user_id, created_at, id);

-- The per-title rows the library list and the filter tree read (ADR-0085). One definition, so GET /titles and
-- POST /titles/search cannot drift. Counts, formats and libraries include only the caller's granted libraries.
CREATE FUNCTION title_rows(p_user uuid) RETURNS TABLE (
    id uuid, title text, authors text[], series_name text, series_index double precision,
    edition_count bigint, recording_count bigint, languages text[], formats text[], library_ids uuid[],
    added_at timestamptz, publisher text, published text, page_count int, rating_halves smallint, status text,
    has_description boolean
) LANGUAGE sql STABLE AS $$
  SELECT t.id, t.title, t.authors, t.series_name, t.series_index,
    (SELECT count(*) FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = p_user WHERE e.title_id = t.id)::bigint AS edition_count,
    (SELECT count(*) FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = p_user WHERE r.title_id = t.id)::bigint AS recording_count,
    COALESCE((SELECT array_agg(DISTINCT e.language) FILTER (WHERE e.language IS NOT NULL)
              FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = p_user WHERE e.title_id = t.id), '{}')::text[] AS languages,
    (COALESCE((SELECT array_agg(DISTINCT e.format ORDER BY e.format) FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = p_user WHERE e.title_id = t.id), '{}')::text[]
      || CASE WHEN EXISTS (SELECT 1 FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = p_user WHERE r.title_id = t.id) THEN ARRAY['audio']::text[] ELSE '{}'::text[] END)::text[] AS formats,
    COALESCE((SELECT array_agg(DISTINCT x.library_id ORDER BY x.library_id) FROM (
        SELECT e.library_id FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = p_user WHERE e.title_id = t.id
        UNION SELECT r.library_id FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = p_user WHERE r.title_id = t.id) x), '{}')::uuid[] AS library_ids,
    (SELECT min(x.created_at) FROM (
        SELECT e.created_at FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = p_user WHERE e.title_id = t.id
        UNION ALL SELECT r.created_at FROM active_recordings r JOIN user_library_grants g ON g.library_id = r.library_id AND g.user_id = p_user WHERE r.title_id = t.id) x)::timestamptz AS added_at,
    COALESCE((SELECT s.v FROM (SELECT NULLIF(effective_edition_field(e.id, 'publisher') #>> '{}', '') AS v, e.created_at FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = p_user WHERE e.title_id = t.id) s WHERE s.v IS NOT NULL ORDER BY s.created_at LIMIT 1),
             NULLIF(effective_title_field(t.id, 'publisher') #>> '{}', ''))::text AS publisher,
    COALESCE((SELECT s.v FROM (SELECT NULLIF(effective_edition_field(e.id, 'published') #>> '{}', '') AS v, e.created_at FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = p_user WHERE e.title_id = t.id) s WHERE s.v IS NOT NULL ORDER BY s.created_at LIMIT 1),
             NULLIF(effective_title_field(t.id, 'published') #>> '{}', ''))::text AS published,
    (SELECT s.v FROM (SELECT (effective_edition_field(e.id, 'page_count') #>> '{}')::int AS v, e.created_at FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = p_user WHERE e.title_id = t.id) s WHERE s.v IS NOT NULL ORDER BY s.created_at LIMIT 1)::int AS page_count,
    (SELECT p.rating_halves FROM title_personal p WHERE p.user_id = p_user AND p.title_id = t.id)::smallint AS rating_halves,
    CASE
      WHEN EXISTS (SELECT 1 FROM edition_completion_state c JOIN editions e ON e.id = c.edition_id WHERE c.user_id = p_user AND e.title_id = t.id AND c.finished)
        OR EXISTS (SELECT 1 FROM completion_state c JOIN recordings r ON r.id = c.recording_id WHERE c.user_id = p_user AND r.title_id = t.id AND c.finished) THEN 'finished'
      WHEN EXISTS (SELECT 1 FROM edition_position_state s JOIN editions e ON e.id = s.edition_id WHERE s.user_id = p_user AND e.title_id = t.id AND s.captured_at IS NOT NULL)
        OR EXISTS (SELECT 1 FROM position_state s JOIN recordings r ON r.id = s.recording_id WHERE s.user_id = p_user AND r.title_id = t.id AND s.captured_at IS NOT NULL) THEN 'reading'
      ELSE 'unread' END::text AS status
    ,
    COALESCE(NULLIF(effective_title_field(t.id, 'description') #>> '{}', '') IS NOT NULL
      OR EXISTS (SELECT 1 FROM editions e JOIN user_library_grants g ON g.library_id = e.library_id AND g.user_id = p_user WHERE e.title_id = t.id AND NULLIF(effective_edition_field(e.id, 'description') #>> '{}', '') IS NOT NULL), false) AS has_description
  FROM titles t
$$;

-- Covers chosen for a title (ADR-0086), one per medium. The image is a bounded JPEG re-encoded by the server, so the
-- table stays small; source "none" records that the files have no cover, so extraction is not retried on every request.
CREATE TABLE title_covers (
    title_id   uuid NOT NULL REFERENCES titles (id) ON DELETE CASCADE,
    medium     text NOT NULL CHECK (medium IN ('ebook', 'audio')),
    source     text NOT NULL CHECK (source IN ('upload', 'url', 'search', 'extracted', 'none')),
    image      bytea,
    version    uuid NOT NULL DEFAULT gen_random_uuid(),
    updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (title_id, medium),
    CHECK ((source = 'none') = (image IS NULL))
);

-- Saved author and series details (ADR-0102 to ADR-0105). Authors and series are names matched ignoring case, so
-- both are keyed by the lowercased name: after a rename in title metadata the details stay under the old name.
-- The revision covers every field and the author's photo.
CREATE TABLE directory_entries (
    kind     text NOT NULL CHECK (kind IN ('author', 'series')),
    name_key text NOT NULL,
    revision bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, name_key)
);

-- One saved edit per field. A null value is a deliberate clear; without a row the field falls back to its source.
CREATE TABLE directory_values (
    kind       text NOT NULL,
    name_key   text NOT NULL,
    field      text NOT NULL,
    value      jsonb,
    locked     boolean NOT NULL DEFAULT false,
    -- Set for a value applied from a provider, which is credited with a link (ADR-0106).
    provider     text,
    provider_url text,
    updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((provider IS NULL) = (provider_url IS NULL)),
    PRIMARY KEY (kind, name_key, field),
    FOREIGN KEY (kind, name_key) REFERENCES directory_entries (kind, name_key) ON DELETE CASCADE
);

-- An author's photo, stored like a cover (ADR-0105): a bounded JPEG the server re-encoded. Source "none" has no image
-- and exists only to hold a lock.
CREATE TABLE author_photos (
    kind       text NOT NULL DEFAULT 'author' CHECK (kind = 'author'),
    name_key   text PRIMARY KEY,
    source     text NOT NULL CHECK (source IN ('upload', 'url', 'provider', 'none')),
    image      bytea,
    locked     boolean NOT NULL DEFAULT false,
    provider     text,
    provider_url text,
    version    uuid NOT NULL DEFAULT gen_random_uuid(),
    updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (kind, name_key) REFERENCES directory_entries (kind, name_key) ON DELETE CASCADE,
    CHECK ((source = 'none') = (image IS NULL)),
    CHECK ((source = 'provider') = (provider IS NOT NULL)),
    CHECK ((provider IS NULL) = (provider_url IS NULL))
);

-- The provider record an administrator matched a series to (ADR-0103).
CREATE TABLE series_matches (
    kind          text NOT NULL DEFAULT 'series' CHECK (kind = 'series'),
    name_key      text PRIMARY KEY,
    provider      text NOT NULL,
    provider_ref  text NOT NULL,
    provider_name text NOT NULL,
    url           text NOT NULL,
    matched_by    uuid REFERENCES users (id) ON DELETE SET NULL,
    matched_at    timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (kind, name_key) REFERENCES directory_entries (kind, name_key) ON DELETE CASCADE
);

-- The provider's numbered books of a matched series, for showing the ones a viewer lacks. Display information only:
-- they are not catalog titles. Covers are re-encoded copies (ADR-0106).
CREATE TABLE series_members (
    name_key      text NOT NULL REFERENCES series_matches (name_key) ON DELETE CASCADE,
    position      integer NOT NULL CHECK (position >= 1),
    title         text NOT NULL,
    authors       text[] NOT NULL DEFAULT '{}',
    released      text NOT NULL DEFAULT '',
    url           text NOT NULL DEFAULT '',
    cover         bytea,
    cover_version uuid,
    PRIMARY KEY (name_key, position),
    CHECK ((cover IS NULL) = (cover_version IS NULL))
);

-- The guessed last name of an author (ADR-0101, ADR-0104): the last word, keeping common surname prefixes with it
-- ("Ursula K. Le Guin") and skipping suffixes such as "Jr.". "Last, First" is read as written. An administrator can
-- correct any guess.
-- +goose StatementBegin
CREATE FUNCTION guess_last_name(p_name text) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
    suffixes constant text[] := ARRAY['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'esq'];
    prefixes constant text[] := ARRAY['al', 'bin', 'da', 'das', 'de', 'del', 'della', 'den', 'der', 'di', 'dos', 'du',
                                      'el', 'ibn', 'la', 'le', 'saint', 'st', 'ten', 'ter', 'van', 'von'];
    cleaned text := btrim(regexp_replace(p_name, '\s+', ' ', 'g'));
    parts text[] := string_to_array(cleaned, ',');
    words text[];
    last_word int;
    first_word int;
BEGIN
    IF array_length(parts, 1) > 1 THEN
        IF btrim(parts[1]) <> '' AND NOT (lower(replace(btrim(parts[2]), '.', '')) = ANY (suffixes)) THEN
            RETURN btrim(parts[1]);
        END IF;
        cleaned := btrim(parts[1]);
    END IF;
    words := string_to_array(cleaned, ' ');
    last_word := array_length(words, 1);
    IF last_word IS NULL THEN
        RETURN btrim(p_name);
    END IF;
    WHILE last_word > 1 AND lower(replace(words[last_word], '.', '')) = ANY (suffixes) LOOP
        last_word := last_word - 1;
    END LOOP;
    first_word := last_word;
    -- The first word is never taken as a prefix, so "Van Morrison" is filed under M.
    WHILE first_word > 2 AND lower(replace(words[first_word - 1], '.', '')) = ANY (prefixes) LOOP
        first_word := first_word - 1;
    END LOOP;
    RETURN array_to_string(words[first_word:last_word], ' ');
END
$$;
-- +goose StatementEnd

-- The A to Z letter a name is filed under, with accents removed; empty when it starts with anything else.
CREATE FUNCTION directory_letter(p_name text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE WHEN c <> '' AND strpos('ABCDEFGHIJKLMNOPQRSTUVWXYZ', c) > 0 THEN c ELSE '' END
    FROM (SELECT upper(left(normalize(ltrim(translate(p_name, 'ØøŁłÆæŒœĐđÞþ', 'OoLlAaOoDdTt'), ' "''(['), NFD), 1)) AS c) AS first_letter
$$;

-- Whether the server may query third-party sites for covers. Off until an administrator turns it on (ADR-0086).
CREATE TABLE cover_settings (
    singleton      boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    search_enabled boolean NOT NULL DEFAULT false,
    updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO cover_settings (singleton) VALUES (true);

-- Each account's notification history (ADR-0089): the results of its own actions, and entries added by background work.
-- The newest 500 entries or 90 days are kept, whichever is fewer; the service trims on every insert.
CREATE TABLE notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    tone       text NOT NULL CHECK (tone IN ('success', 'info', 'warning', 'error')),
    title      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
    detail     text CHECK (detail IS NULL OR char_length(detail) <= 2000),
    source     text NOT NULL CHECK (source IN ('user', 'system')),
    read_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_recent ON notifications (user_id, created_at DESC, id DESC);

-- One row per reading session (ADR-0092): when an account read an edition, for how long, and from where to where in the
-- book as a fraction. The browser sends a session by its own id repeatedly, so the row is an idempotent upsert.
CREATE TABLE reading_sessions (
    user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    id             uuid NOT NULL,
    edition_id     uuid NOT NULL REFERENCES editions (id),
    started_at     timestamptz NOT NULL,
    ended_at       timestamptz NOT NULL,
    active_seconds integer NOT NULL CHECK (active_seconds BETWEEN 0 AND 86400),
    start_fraction real CHECK (start_fraction IS NULL OR start_fraction BETWEEN 0 AND 1),
    end_fraction   real CHECK (end_fraction IS NULL OR end_fraction BETWEEN 0 AND 1),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id),
    CHECK (ended_at >= started_at)
);
CREATE INDEX reading_sessions_user_time ON reading_sessions (user_id, started_at DESC);
CREATE INDEX reading_sessions_edition ON reading_sessions (edition_id, user_id, started_at DESC);

-- +goose Down
DROP TABLE reading_sessions;
DROP TABLE notifications;
DROP TABLE deliveries;
DROP TABLE delivery_recipients;
DROP TABLE smtp_configs;
DROP TABLE koreader_receipts;
DROP TABLE koreader_conflicts;
DROP TABLE koreader_baselines;
DROP TABLE koreader_sources;
DROP TABLE koreader_bindings;
DROP TABLE koreader_digests;
DROP VIEW opds_publication_rows;
DROP FUNCTION effective_title_field(uuid, text);
DROP FUNCTION effective_edition_field(uuid, text);
DROP TABLE integration_credentials;
DROP TABLE integration_settings;
DROP TABLE repair_plans;
DROP VIEW active_recordings;
DROP TABLE comic_extractions;
DROP TABLE title_personal;
DROP TABLE edition_metadata_values;
DROP TABLE shelf_titles;
DROP TABLE shelves;
DROP TABLE annotations;
DROP TABLE t005_conflicts;
DROP TABLE t005_receipts;
DROP TABLE edition_history;
DROP TABLE edition_completion_state;
DROP TABLE edition_position_evidence;
DROP TABLE edition_position_state;
DROP TABLE editions;
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
DROP TABLE IF EXISTS series_members;
DROP TABLE IF EXISTS series_matches;
DROP TABLE IF EXISTS author_photos;
DROP TABLE IF EXISTS directory_values;
DROP TABLE IF EXISTS directory_entries;
DROP FUNCTION IF EXISTS directory_letter(text);
DROP FUNCTION IF EXISTS guess_last_name(text);
DROP TABLE IF EXISTS cover_settings;
DROP TABLE IF EXISTS title_covers;
DROP FUNCTION IF EXISTS title_rows(uuid);
DROP TABLE libraries;
DROP TABLE users;
DROP TABLE server_identity;
DROP TABLE inspection_results;
DROP TABLE inspection_requests;
