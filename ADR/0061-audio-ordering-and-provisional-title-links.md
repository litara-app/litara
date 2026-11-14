# ADR-0061: Order audio from consistent evidence and review uncertain title links

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0045 accepts conservative grouping but leaves concrete ordering and automatic relationship evidence for specification. T004 must construct ordered multi-file recordings without letting filenames or folder layout silently define a work identity.

## Decision

The user selected the following on 2026-11-13:

- Prefer complete consistent disc/track tags for automatic audio ordering.
- Otherwise use an unambiguous natural filename/disc-folder order.
- Conflicting or ambiguous ordering requires review.
- Automatically link editions/recordings only when strong identifiers and metadata agree; uncertain links remain provisional items for review.

## Alternatives

- Require manual ordering/title links for every new recording.
- Always sort by raw filename or link by display title alone.
- Evidence-based order/linking with provisional review states, as selected.

## Consequences

Keep ordering evidence and review issues so repairs can be explained. Distinct translations remain separate editions and narrator/abridgement variants separate recordings under the accepted title model. Do not silently discard contradictory tags to force a filename fallback. File IDs/content versions and historical anchors survive manual repair; recording-layout revisions change when membership/order changes. A natural filename fallback is allowed only when unambiguous, not as permission to hide suspected missing tracks or conflicting disc structure.

## Verification

Planned for T004: complete tags across discs, natural 2-versus-10 filename ordering, conflicting tags/filenames, duplicate track numbers, ambiguous folder sets, strong identifier agreement, contradictory title evidence, provisional review and identity/history preservation after ordering/merge/split repair. No scanner or catalog behavior was implemented/tested in this decision session.

## Open questions

Exact deterministic comparison/normalization and representative association/grouping fixtures must be documented in the T004 brief. These details must not introduce a new automatic identity equivalence or cross-format position conversion.
