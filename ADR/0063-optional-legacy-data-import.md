# ADR-0063: Offer an explicit legacy-data import for the relaunch

Status: Accepted
Date: 2026-11-14
Decision owner: Repository owner

## Context

On 2026-11-14 the user requested some way for existing Litara users to migrate to the rebuild, while noting the likely small installed base. [ADR-0003](0003-start-fresh.md) selects a fresh database and API and explicitly leaves future optional imports to a separate decision. [ADR-0062](0062-target-litara-2-release.md) selects 2.0.0 as the completed rebuild's release target.

Read-only inspection of the archived `apps/api/prisma/schema.prisma` shows separate library/book/file records, per-user reading progress with reader-specific locations, annotations, shelves, audiobook progress, and credentials. The new title/edition/recording and versioned-position model cannot safely treat those records as interchangeable. Schema inspection alone does not establish conversion fidelity or the schema installed by any existing user.

## Decision

On 2026-11-14 the user explicitly selected personal-state migration as a requirement before 2.0.0 ships. Provide a bounded, explicit one-time import into a fresh 2.0 installation. Preserve the old installation and original media, rescan existing book folders, then preview how legacy records map to new accounts and catalog identities before applying supported data. Migration is optional for an individual installer, but providing and verifying the supported migration path is a release gate.

This supersedes [ADR-0003](0003-start-fresh.md)'s exemption from an initial-release migration requirement. Preserve its fresh-database and new-client-contract decisions: new installations must work without legacy data, and old API/client compatibility is not required.

The accepted migration direction prioritizes user-authored metadata, ordinary shelves, completion state, annotations, and reading/listening progress. Import supported locations only when the matching file and location semantics can be verified. Retain unsupported or ambiguous records in an export/report for manual recovery; do not invent resume offsets or silently discard annotations. The exact automatic-conversion coverage and acceptable manual-recovery limits still require decisions before an implementation brief can claim complete release coverage.

Explicit account mapping and new sign-ins rather than transferring credentials or sessions remain recommendations. Path-root mapping and content evidence for media association, with ambiguous matches requiring review, also remain recommendations pending the concrete migration design.

## Alternatives

- Document backup, fresh setup, and folder rescan only: simplest, but recreates personal application state manually.
- Provide an explicit import with a preview and recovery report: bounded compatibility work focused on preserving personal data.
- Upgrade the old database in place and retain old clients: substantially broader compatibility commitments, conflicting with ADR-0003 unless superseded by an accepted decision.

## Consequences

A migration path can reduce disruption without making the rebuilt runtime depend on the archived application. An importer still requires a supported source-version range, a portable input/export format, identity and account mapping, rerun behavior, and data-fidelity tests. Reader conversion and audio layout differences may limit what can be restored automatically.

The release requirement is accepted; unresolved source formats, conversion rules, credential handling, and recovery limits are not implicitly accepted. No archived-code modifications or in-place legacy database transformations are authorized. The archived application remains read-only reference unless separately requested.

## Verification

Planned acceptance evidence: representative legacy fixtures; source and media unchanged; preview before mutation; explicit account/root mapping; correct catalog matches; preserved supported state; a report covering every imported, skipped, unsupported, or ambiguous record; safe interrupted/repeated imports; and a demonstrated return to the preserved old installation. Runtime and conversion behavior have not been tested.

## Open questions

- Which data categories must import automatically, and which may be retained for manual recovery?
- Which historical versions and installation layouts will be supported?
- Should input come from a separate backup-reading utility or an export offered by a final legacy release?
- How will preview/application, duplicate prevention, account mapping, and restoration be exposed to administrators?
- How should existing automatic container updates be protected from an incompatible major-version switch?
