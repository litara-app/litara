# ADR-0047: Prefer protected edits then sidecar metadata over embedded values

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0014 protects edits/locked fields and permits provider gap-filling, but leaves unedited sidecar/embedded precedence and clearing semantics open.

## Decision

The user selected the following on 2026-11-13:

- Ordinary metadata priority is protected user edits/locks/deliberate clears, then an associated sidecar, embedded metadata and provider gap-filling.
- Keep field provenance and report conflicts rather than overwriting protected values.

## Alternatives

- Prefer embedded metadata over sidecars.
- Let providers replace values automatically.
- User edits → sidecar → embedded → providers with provenance/protection, as selected.

## Consequences

An explicit clear is a protected intentional value, not a gap to refill. Preserve candidate source values so a conflict or fallback can be explained. Fields absent from a source do not instruct deletion. Rescans/provider refreshes must honor current protection at commit time, including edits made while enrichment was queued. Sidecar association and provider ordering/acceptance rules are specified separately; this priority does not itself authorize writing any file.

## Verification

Planned for T004: sidecar/embedded disagreement, protected edit, explicit clear, missing versus null, provider gaps, rescan and a queued enrichment racing with a user edit. No runtime behavior was implemented in this decision session.

## Open questions

ADR-0055 selects unambiguous Litara JSON/OPF association; ADR-0060 selects configurable provider order and uncertain-match review. Concrete field mappings, clear representation and versioned sidecar schema remain contract work.
