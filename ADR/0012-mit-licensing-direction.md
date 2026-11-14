# ADR-0012: Target MIT licensing for the new stack

Status: Superseded
Date: 2026-11-12
Decision owner: Repository owner
Superseded by: [ADR-0017](0017-separate-android-agpl-license.md)

## Context

Historical decision, replaced by ADR-0017 after the Android audit and the user's acceptance of an AGPL Android component. The original rationale below is retained.

Existing Litara declares MIT. The selected Android starting point declares AGPL-3.0. BookOrbit declares AGPL-3.0-only with additional terms. When asked about licensing direction, the user explicitly chose: Move it all to MIT.

## Decision

Use MIT as the intended license for new first-party backend, web, and Android work. Apply that direction to reused source only where the necessary rights are established. Preserve third-party licenses, copyright notices, and provenance. Do not interpret this decision as permission from unidentified third-party rights holders.

## Alternatives

- MIT backend/web with a separately licensed AGPL Android application.
- AGPL for the whole new stack.
- MIT direction throughout, as requested, with source rights checked before reuse.

## Consequences

The existing root MIT license remains. Before Android source is brought into the active MIT stack, inspect authorship and imported/derived material, establish permission where needed, or replace incompatible material. If that prevents preserving selected work, bring the concrete conflict back to the user rather than silently dropping Cast/Auto or changing the licensing direction. Referencing BookOrbit behavior does not imply importing its implementation.

## Verification

Before source import/release, produce a source provenance and dependency-license inventory, retain required notices, and identify any unresolved files. No Android source has been imported or relicensed in this task.

## Open questions

Who holds rights to the Android Cast/Auto/player/reader source and any imported assets? Which files can be relicensed, and which need replacement? The direction is accepted; this rights audit is incomplete.
