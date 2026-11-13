# ADR-0040: Use idempotent revisioned audio writes with explicit conflicts

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0015/0019 accept revision-aware file/version positions and layout-change detection; ADR-0034 chooses a user resume decision for stale offline updates. T003 needs concrete request/error behavior.

## Decision

The user accepted this protocol on 2026-11-13:

- The server issues position revisions. A write carries its base revision and unique operation ID, scoped to the authenticated user and recording.
- Repeating an identical operation returns its original result; it must not apply twice. Reusing an ID with different data is not an identical retry and must be rejected.
- A stale base revision returns HTTP 409 and saves the conflicting candidate without overwriting the current position.
- Changed file/content or recording-layout versions return HTTP 412.
- After reordering, the same file/content-version offset can be reused only after validation against the new layout. Changed bytes require an explicitly selected new position.
- Reject invalid offsets rather than silently clamping.

Capture time remains context, not the ordering authority. Deliberate backward seeks with the current revision are valid.

## Alternatives

- Last-arrival or client-clock winners.
- Silent offset clamping or cross-version remapping.
- Explicit revisions/idempotency and 409/412 handling, as selected.

## Consequences

The revision check, position update, conflict capture and operation receipt must be atomic. Authenticate and authorize before revealing any receipt; scope idempotency to user/recording and payload so retries cannot expose another account. For a new operation, validate file/content/layout before accepting a base revision; 412 keeps the original candidate recoverable. A retry of an already-recorded operation returns its prior result only when still authorized. Conflict resolution is a new operation against the current revision and may itself conflict. Missing position needs a typed explicit absence in the shared contract. Server revision, content version and layout revision remain distinct.

## Verification

Test identical retries after response loss, different payload/same ID, simultaneous writes, backward seek, stale offline candidate persisted on 409, layout change on 412, preserved compatible anchor after reorder, incompatible bytes, invalid offsets, restart and account isolation. Planned for T003.

## Open questions

ADR-0043 now selects retention without automatic pruning. Exact endpoint/request field names, explicit no-position shape, typed error codes and response fields must be frozen in shared contract fixtures before implementation, preserving these accepted semantics. Completion events follow the same retry/conflict principles without inferring completion merely from position.
