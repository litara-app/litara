# ADR-0053: Offer previewed JSON sidecar export alongside in-file updates

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0047 selects sidecar precedence and ADR-0048 includes reviewed in-file updates. Sidecar output remained a separate question after the user chose in-file updates rather than the earlier sidecar-only proposal.

## Decision

The user selected the following on 2026-11-13:

- Also offer a previewed Litara JSON sidecar export in T004.
- Leave existing sidecars untouched unless the user explicitly approves their replacement.

## Alternatives

- Database and in-file updates only.
- Include reviewed JSON sidecar export as well, as selected.

## Consequences

A database/provider metadata update is not automatic sidecar export. Preview its target, fields and any replacement separately from an in-file write; revalidate the approved destination/content before writing. Export content metadata/provenance, never credentials or another user’s personal state. The reader/writer schema must be versioned and preserve intentional clears. Existing OPF input support is not approval for OPF export.

## Verification

Planned for T004: new export, existing-sidecar replacement denied/approved, a destination changed after preview, deliberate clears and no personal/credential data in output. No sidecar was written during this decision session.

## Open questions

ADR-0055/0059 now govern association and safe root containment, and ADR-0057 fixes the optional-backup write profile. Exact JSON schema, export filenames and review-plan/publication transactions must be fixed in the T004 contract/brief.
