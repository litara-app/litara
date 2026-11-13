# ADR-0023: Retain full and Cast-free F-Droid Android builds

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

The existing native project has a full distribution containing the Google Cast SDK and a Cast-free fdroid distribution. The audit reports both build variants passing emulator checks, but no new physical Cast/head-unit testing.

## Decision

The user selected keeping both the full build with Chromecast and the Cast-free F-Droid build. Keep shared playback/Auto behavior where supported without requiring the proprietary Cast dependency in the F-Droid variant.

## Alternatives

- Ship only the full build initially.
- Ship only the Cast-free build initially.
- Keep both distributions, as selected.

## Consequences

Dependency selection and user interface must reflect each distribution's capabilities. AGPL application source does not change the proprietary SDK's own terms. Updating libraries or changing variants must retain both build paths and applicable notices. F-Droid publication/eligibility is a separate verification, not established by naming a flavor fdroid.

## Verification

Planned: build/lint/test both variants; inspect the F-Droid artifact/dependency graph for excluded Google Cast components; verify full-build Cast on real hardware; verify Auto on supported devices/head units. Audit emulator results are a reference baseline, not new-stack acceptance.

## Open questions

Application IDs, signing and upgrade continuity, distribution channels, release automation, and store metadata remain open.
