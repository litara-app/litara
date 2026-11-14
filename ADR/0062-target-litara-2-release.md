# ADR-0062: Target Litara 2.0.0 for the rebuilt release

Status: Accepted
Date: 2026-11-14
Decision owner: Repository owner

## Context

The user reports T004 merged and wants to discuss the rebuilt Litara's re-release, including a path for existing users. The archived package manifest identifies the historical application as 1.41.1. On 2026-11-14 the user explicitly requested: "Version bump to version 2.0.0 for the next release (when ready, still a ways to go)".

## Decision

The next finished release of the rebuilt Litara will be version 2.0.0. This records the release target now; it does not declare the application ready, publish artifacts, create a release tag, or change development builds to advertise a finished release.

The usable-release scope and verification requirements remain governed by [ADR-0011](0011-first-usable-release.md). Pre-production schema consolidation remains governed by [ADR-0030](0030-consolidate-preproduction-migrations.md).

## Alternatives

- Continue the historical 1.x release line despite the replacement architecture and client contracts.
- Target 2.0.0 for the completed rebuild, as selected.
- Publish 2.0.0 immediately, which the user explicitly did not request.

## Consequences

Release preparation must align the product release identity, release notes, and applicable packaged version displays with 2.0.0. Development and preview builds must be distinguishable from that finished release. The product major version does not require renumbering the independently versioned public API.

Historical manifests and release configuration remain read-only reference. This decision does not select publishing automation, Android application identity/signing, update channels, or legacy migration behavior.

## Verification

Before release, verify the built artifacts report the intended version, the release tag and notes agree, and the accepted first-release and hardware acceptance gates have evidence. These are planned checks, not completed runtime or hardware verification.

## Open questions

Preview version naming, publishing/update-channel policy, and platform packaging remain undecided. [ADR-0063](0063-optional-legacy-data-import.md) now requires a verified personal-state migration path before 2.0.0 ships; its detailed coverage remains open. [ADR-0064](0064-pause-github-actions-until-release-readiness.md) pauses GitHub Actions until an explicit readiness decision.
