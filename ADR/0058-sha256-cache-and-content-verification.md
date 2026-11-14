# ADR-0058: Cache SHA-256 fingerprints with daily and manual verification

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0044 accepts full-file evidence for unique moves and byte changes; ADR-0050 supplies stable-file observation and scan scheduling. The fingerprint algorithm/cache verification policy remained open.

## Decision

The user selected the following on 2026-11-13:

- Use full SHA-256 for new/changed files and move candidates.
- Cache fingerprints while size and modification time remain unchanged.
- Add configurable full-content verification, daily by default, plus manual verification to detect changed bytes with preserved size/timestamps.
- Do not claim instant detection of those preserved-stat changes.

## Alternatives

- Rehash every file on every 15-minute reconciliation scan.
- Only manual full verification.
- Cached SHA-256 with daily/manual content verification, as selected.

## Consequences

Streaming full-byte hashes remain evidence, not public file IDs. Coalesce verification jobs and bound I/O so scheduled checks do not create unbounded NAS reads. Cache validation follows accepted stable-file observations and metadata rechecks around hashing; a changing file yields a retry/incomplete state, not a trusted partial hash. Explicitly document the preserved-stat detection window and what is checked at serving/publication boundaries rather than asserting instantaneous detection. Any media-serving change needed to enforce version consistency must be integrated with T003 through its ownership/handoff, not implemented concurrently without a narrowed scope.

## Verification

Planned for T004: full-byte equality, cache reuse, same-size/mtime-preserved modification found by verification, daily/manual scheduling, changing files during hashing, cancellation/restart, missing-root scan and bounded NAS I/O. No scanner runtime was exercised in this decision session.

## Open questions

None within this record’s policy scope. Concrete interfaces/fixtures must be specified in the T004 execution brief.
