# ADR-0075: T006 isolated KOReader positions and file identity

Status: Accepted
Date: 2026-11-16
Decision owner: Repository owner

## Context

ADR-0015 requires preserving stale device work and rejects timestamp/highest-percentage arbitration. KOReader progress strings and web Foliate CFIs are different. Archived Litara isolates sources but chooses the first partial-hash match and does not enforce library grants in that adapter; those are reference defects to avoid.

## Decision

On 2026-11-16 the user chose a separate KOReader position source with no automatic web/Android location conversion or completion changes. KOReader sync updates neither web/Android canonical locations nor finished/history state. Show its position/percentage separately in the web edition UI with a clear source label.

Only catalog-bound, currently granted exact file versions participate. Support KOReader's binary partial-content digest mode; do not silently match by filename or title. The digest is a compatibility lookup hint, not a secure content identity. Index it against the existing opaque file ID and strong content version. If lookup is missing, ambiguous, inaccessible or superseded, refuse the write explicitly and retain no guessed canonical update. Partial-hash collisions or identical files attached to multiple editions require a user-selected per-credential binding before sync writes. Never transfer positions to replacement bytes.

Protocol registration is disabled: create/revoke credentials in the signed-in settings UI. Main account creation, password replacement, account deletion, annotation synchronization, external-service sync and Android reader adaptation are outside the KOReader compatibility surface.

## Alternatives

Automatic cross-engine conversion; highest-percentage/latest-clock display arbitration; arbitrary uncatalogued document storage; filename matching; or first-match partial hashes. The user selected separate sources. Broad conversion is deferred.

## Consequences

Preserve raw progress strings as bounded untrusted data and render only escaped text. Document and test the partial-content hash algorithm independently against upstream-generated vectors, including sparse/large files. A replacement must invalidate the lookup/index binding before a stale location can be accepted.

## Verification

Prove account and library isolation, missing/ambiguous/collision binding, stable moves, changed bytes, independent web/Android state and completion, backward KOReader movement, opaque progress strings, and authentic client authentication/digest fixtures. No physical e-reader success is implied by a protocol simulator.

These are implementation acceptance requirements. Preparation checks do not establish runtime or third-party-client success.

## Open questions

None within this T006 assignment boundary. Release/hardware verification remains T007.
