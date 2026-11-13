# ADR-0004: Support existing folders and optional managed imports

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Litara scans existing folders and supports approved imports. BookOrbit has configurable book-per-folder and book-per-file grouping, write-back, and renaming controls. Organization ownership is separate from book identity.

## Decision

The user selected scanning existing folders by default with optional managed imports. Existing folder organization is retained by default. Managed importing is an explicit opt-in capability rather than a prerequisite for using Litara.

## Alternatives

- Managed-only storage with application-selected paths.
- Index-only storage with no managed import capability.
- Both modes, as selected.

## Consequences

The scanner and catalog must work without reorganizing files. Managed importing needs explicit destination and collision behavior. File write-back, destructive moves, and unattended import approval were not authorized by choosing this mode.

## Verification

Planned: indexing an existing library leaves its names and contents unchanged; opting into managed import does not change another library's behavior; interrupted imports do not publish incomplete files.

## Open questions

Copy versus move, import review, naming templates, collision policy, metadata write-back, and mode configuration granularity remain undecided.
