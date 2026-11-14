# ADR-0017: Keep Android under AGPL and backend/web under MIT

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner
Supersedes: [ADR-0012](0012-mit-licensing-direction.md)

## Context

The [Android audit](../research/android/source-provenance.md) identifies outside contributions in the media/download/sync core and AGPL-modified reader assets. A pure MIT import would require additional permission or replacement. After reviewing these findings, the user explicitly accepted AGPL for the Android application.

## Decision

Preserve the Android application's existing AGPL licensing when adapting it into `apps/android/`. Retain MIT for new first-party Go backend and web work. Preserve upstream license texts, copyright notices, and provenance; retain each dependency's applicable license. This supersedes the earlier all-MIT direction rather than rewriting its history.

## Alternatives

- Obtain MIT relicensing permission for all relevant contributions and replace incompatible assets.
- Reimplement affected Android features to meet the earlier all-MIT target.
- Keep Android AGPL and backend/web MIT, as accepted.

## Consequences

MIT relicensing permission is no longer a prerequisite to reusing AGPL Android contributions under their existing license. A complete per-line ownership CSV is useful provenance work, not the critical gate to preserving the player. Notices and source obligations still need attention. The audit flags missing Foliate/vendor notices; importing must restore applicable notices rather than copying that omission. This decision does not authorize copying AGPL reader modifications into the MIT web component, nor does it select a shared reader implementation. Full-build proprietary dependencies retain their own terms.

## Verification

At import, keep an Android-local license and notices, document the component license boundary, inventory bundled source/dependencies, and verify notices are packaged. Root documentation must not describe the whole monorepo as uniformly MIT. Verify release source/notice packaging before publication. No source import or legal-compliance certification was performed here.

## Open questions

Exact SPDX expressions and notices must follow source evidence. Android reader reuse and any shared web assets need separate review. Detailed provenance gaps remain tracked in the audit but no longer imply an MIT relicensing requirement.
