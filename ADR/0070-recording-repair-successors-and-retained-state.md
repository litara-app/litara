# ADR-0070: Repair recordings through explicit successors while retaining source state

Status: Accepted
Date: 2026-11-14
Decision owner: Repository owner

## Context

ADR-0045 requires identity/history-preserving manual merge/split, but T004 did not implement it. Reusing a completed source recording for a larger merged recording could silently reinterpret completion and canonical resume. T005 needs deterministic behavior before exposing controls.

## Decision

Accepted by explicit user choices on 2026-11-14. The selected policy below was approved during T005 preparation.

Use reviewed repair plans limited to one library and one title. Merge takes at least two active recordings and produces one new successor recording; split takes one active recording and produces at least two new successors. Every source file/version appears exactly once in the explicitly ordered outputs. Reject overlapping inputs, dropped/duplicated files, unknown/changed versions and cross-library/title plans. Linking titles remains a separate explicit operation.

Preview captures source layout revisions, exact memberships/versions, outputs, affected state counts and warnings; counts of personal records do not reveal notes or private content. Administrator plus library grant is required. Approve and apply use operation IDs and a plan revision; application locks sources and rechecks the whole plan atomically. Replays return the original output IDs; a source/content/layout change returns 412 and requires a new preview.

Create new recording UUIDs and retain original recording IDs as non-playable tombstones with successor references. File IDs/content versions remain unchanged. Lists show active successors; an old recording snapshot returns typed 409 recording_repaired with successor IDs visible only with current access. Old position/completion writes return typed 412 recording_repaired and preserve candidate evidence; retained history and the caller's old state remain readable under current grants. Do not physically delete old state, conflicts, operation receipts or history.

New successors initially have no canonical resume and are unfinished. Offer each user's source positions as explicit candidates only where the file/version belongs to that successor; do not auto-select by percentage/clock or mark a new merged recording finished because one source was finished. Preserve source completion/history with its source identity and present it as prior history, not a new completion. A user explicitly resumes/finishes the successor through the normal revisioned protocol. This is a reviewed change of recording organization, not a reinterpretation of the old record.

## Alternatives

- Reuse a source ID and automatically merge state: fewer IDs, but ambiguous completion and resume semantics.
- Explicit successor identities with retained source tombstones/state, as selected.
- Physically delete merged-away rows: violates history/evidence requirements.

## Consequences

T005 extends catalog queries/media authorization and adds reviewed repair APIs/UI. Old clients receive explicit errors rather than being silently redirected to a different layout. Existing Android API behavior must remain intact for unrepaired recordings; repaired-recording UX adaptation is tracked separately if required.

## Verification

Planned: multiple users with different source progress/completions; plan replay/race; disjoint output partition; retained old IDs/history; authorized successor hints; no cross-grant leaks; original bytes/file IDs unchanged; 409 old snapshots; 412 old writes preserving candidates; explicit successor resume/finish.

## Open questions

None within this policy. Exact request/transaction invariants are specified in `contracts/t005/`; they must be tested without silently changing source-state ownership.
