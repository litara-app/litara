# ADR-0043: Retain sync evidence and scope T003 to a seeded integration slice

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

T001 and T002 provide durable jobs and a preserved native baseline. T003 must prove the new contract without choosing T004 ingestion policies or prematurely discarding offline conflict evidence.

## Decision

The user accepted on 2026-11-13:

- Retain unresolved sync conflicts, operation receipts and locked account data without automatic pruning until a retention policy is selected.
- Use seeded multi-file recordings for the first Android/server integration slice.
- Full scanning/import and separate reread-history controls remain later work.

Operation receipts here mean progress/completion idempotency records, not native credential recovery payloads; the latter retain the 60-second bound selected in ADR-0036.

## Alternatives

- Choose time-based pruning before T003.
- Make T003 depend on a complete scanner/importer.
- Retain evidence and build the seeded first slice, as selected.

## Consequences

Storage can grow during pre-production; report that boundary instead of silently adding cleanup. Retain conflict candidates until explicit resolution, and keep operation receipts sufficient to reproduce prior results while authorized. Retention is not permission to expose another user’s data or reenable a revoked account. An explicit account/data deletion workflow requires its own policy; no destructive background cleanup is selected. Scope includes auth/library grants, recording list/detail/search, byte-exact media/artwork delivery, positions/conflicts/completion, account-scoped downloads and the Android adapter with L6 regression. Schema/model/endpoint fixtures must be concrete before coding. Full file matching, grouping and real ingestion remain T004; full web reader/library UI remains T005.

## Verification

Prove login/grants, seeded multi-file recording playback, Range/HEAD/retry behavior, offline snapshot/account separation, progress retry/conflict resolution, completion controls and retained sync evidence. Use both Android distributions and retain Cast/Auto regression coverage; physical hardware acceptance is still a separate gate. Planned for T003.

## Open questions

A future retention/deletion policy is required before production, along with production API compatibility/deprecation and deployment/release decisions. Those deferred production decisions do not authorize automatic pruning in T003.
