# ADR-0015: Define reading state and sync conflict behavior

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Litara keeps web and KOReader source progress separately and can display highest or most-recent progress. BookOrbit converts locations and reconciles more device state. ADR-0006 binds precise locations to files, while ADR-0011 defers advanced sync.

## Decision

The user selected keeping device/file positions, using revisions to accept newer updates, and surfacing stale offline conflicts. Permit intentional backward navigation rather than assuming the highest percentage is the intended resume position. Preserve the conflicting update until it can be resolved instead of silently discarding a device's work.

## Alternatives

- Highest percentage wins.
- Last received update wins.
- Revision-aware updates with explicit conflict behavior.

## Consequences

Conflict-aware resume behavior is accepted; its protocol is not yet designed. Rereads, offline updates, finished status, device clock skew, and equivalent file replacements require concrete examples. Cross-format position conversion is outside the first-release default scope. Device clocks alone must not establish revision ordering.

## Verification

Planned: test reading backward, stale offline uploads, two active devices, rereading, and incompatible file locations. Annotation deletion needs an independent reconciliation specification before it is implemented.

## Open questions

Revision issuance, conflict UI/resolution, retention, and a basic KOReader protocol adapter remain open. How should clients without native revision support participate? ADR-0019 selects the audio position anchor, and ADR-0022 selects edition/recording completion with title history.
