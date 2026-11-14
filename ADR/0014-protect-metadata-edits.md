# ADR-0014: Protect user metadata and make overwrites explicit

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Litara has provider preferences, locked fields, sidecars, and optional file writes. BookOrbit exposes configurable metadata precedence and write-back. Conflicting sources must not erase deliberate edits unexpectedly.

## Decision

The user selected protecting user edits and locked fields, enriching gaps, and making overwrites and file write-back explicit. Unattended provider refreshes must not override protected values.

## Alternatives

- Prefer configured providers automatically and write results to files.
- Expose fully configurable per-library precedence and automatic write-back immediately.
- Protect edits with explicit overwrite/write-back, as selected.

## Consequences

Track value provenance and protection state so behavior remains understandable after rescan. Stored metadata changes do not inherently authorize changes to book files. A preview/confirmation mechanism for concrete overwrites must be designed, without requiring repeated permission for already configured actions.

## Verification

Planned: rescan/enrichment preserves edited and locked fields, fills allowed gaps, and reports conflicts. File bytes remain unchanged without explicit write-back. Test interruption and NAS failure for any implemented write path.

## Open questions

Precedence between unedited embedded and sidecar values, clearing versus missing values, field-specific matching, provider list, and whether explicit write-back is a per-action or configurable policy remain open.
