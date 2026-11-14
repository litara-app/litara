# ADR-0044: Match unique file moves and version changed bytes

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0018 accepts stable opaque file IDs and separate content versions, but leaves rename/move matching open. T004 must distinguish a changed location, changed bytes and an ambiguous duplicate without reinterpreting saved positions.

## Decision

The user selected the following on 2026-11-13:

- Preserve identity for a move/rename only when a full-file fingerprint uniquely matches a missing file in the same library.
- Ambiguous matches require review; filenames and sizes alone are insufficient.
- If bytes change at the same known file path, retain the file ID but create a new content version, invalidate affected recording timelines and leave old saved positions unresolved. Do not assume offsets remain equivalent.

## Alternatives

- New identity for every changed path or replacement.
- Heuristic matching by name/size.
- Unique full-byte matching for moves plus explicit replacement versions, as selected.

## Consequences

A fingerprint is evidence, not the public ID. Track file identity, path/location and content version separately. A same-path replacement does not erase the old content-version/progress evidence. A scan must not finalize a move against a merely unavailable NAS root; establish a reliable missing-file candidate through reconciliation first. Fingerprint complete stable files, not changing partial copies. Separate libraries do not inherit identities automatically from equal bytes. A new location with a still-present original is not a missing-file move candidate.

## Verification

Planned for T004: rename/move uniquely matched bytes, same name/size with different bytes, multiple missing candidates with equal bytes, cross-library duplicate, same-path replacement, partial copy and unavailable share. Verify IDs/version/layout changes and preserved old positions; no implementation or runtime tests were performed in this decision session.

## Open questions

ADR-0058 now selects SHA-256 caching/daily/manual verification; ADR-0050/0059 select stable-file/root reconciliation. ADR-0046 selects reviewed duplicates/import behavior. Concrete matching/reconciliation fixtures and transaction boundaries remain T004 specification work.
