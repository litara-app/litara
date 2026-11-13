# ADR-0019: Anchor audio positions to versioned files and detect layout changes

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

The Android player can convert file-relative and whole-recording time. The audit proposes newer capture timestamps winning, but ADR-0015 already accepts revision-aware conflicts and forbids device clocks alone from establishing order. Replacing or reordering audio files can invalidate absolute time.

## Decision

The user selected storing audio positions as file ID/content version plus an offset in milliseconds. Derive whole-recording time from the ordered file manifest. Detect recording-layout changes rather than silently interpreting a saved position against a different layout. Apply ADR-0015 revision/conflict behavior; do not adopt the audit's client-timestamp-only winner policy.

## Alternatives

- Store only whole-recording time against the current file order.
- Store only percentage.
- Versioned file plus offset, as selected.

## Consequences

Recording detail needs explicit file order and durations. Retain capture timestamps as context without letting clock skew or delayed upload silently win. Position revision, content version, and layout revision have distinct purposes. A file-anchored position does not automatically survive re-encoding, splitting, or replacement; incompatible versions need explicit handling.

## Verification

Planned: reorder files, replace/re-encode one file, change durations, replay an operation, upload stale offline progress, and intentionally seek backward. Resume must preserve or surface the original position rather than silently landing elsewhere. Client adaptations must test conflict paths and recoverable pending writes.

## Open questions

Manifest/position protocol, idempotency and revision issuance, exact conflict statuses, conflict UI, clamping policy, and safe remapping remain open. No fixed synchronization-latency guarantee is accepted from the audit.
