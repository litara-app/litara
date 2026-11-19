# ADR-0078: Report confirmed ebook damage as incomplete

Status: Accepted
Date: 2026-11-18
Decision owner: Repository owner

## Context

T007 F6 found that a truncated EPUB was reported ready because its extension was supported. [T007 handoff](../handoffs/T007.md)

## Decision

The repository owner approved using the existing incomplete readiness state with a file_damaged issue for confirmed structural damage. Start with bounded EPUB and KEPUB container checks and revalidate when file bytes change.

## Alternatives

A separate top-level state would require API and client changes. Deep validation of every entry would increase scan cost. Extension-based readiness leaves confirmed damage undisclosed.

## Consequences

The issue belongs to the exact content version. A damaged edition remains in the catalog, its original remains available through the existing authorized download path, and saved personal state is preserved. Reader entry points show the issue when the current file is damaged. Transient I/O, protection, and validation limits are inconclusive. The initial check covers EPUB container structure, not the integrity of every content entry.

## Verification

Scan a truncated EPUB and verify damage on list, detail, and reader snapshots with normal authorization. Verify the original remains intact. Replace the file with a valid EPUB and confirm the same edition and file IDs, new version, and cleared issue. Exercise pre-existing editions and cases where damage cannot be confirmed.

## Open questions

Structural checks for other formats and full integrity sweeps remain outside this decision's first implementation.
