# ADR-0055: Associate sidecars and CUE only without ambiguity

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

The archived audio scanner chose the first CUE directory entry and its inspected parser did not use FILE directives for versioned file anchors. ADR-0029/0042 now require valid associated CUE precedence and whole-source validation. T004 must associate inputs with the right edition/recording rather than inheriting that heuristic.

## Decision

The user selected the following on 2026-11-13:

- Read Litara JSON and OPF sidecars only when they unambiguously belong to a file/edition.
- Automatically associate a CUE only when exactly one valid candidate references files inside the same recording folder/disc tree.
- Multiple candidates require review; never choose the first file found.

## Alternatives

- Require manual association for every input.
- Automatically choose a directory-first CUE or apply folder metadata to every nearby book.
- Unambiguous association plus review, as selected.

## Consequences

After association, apply ADR-0042 whole-source validation and ADR-0029 precedence without mutating raw evidence/user edits. Resolve CUE FILE references to stable file/content identities and file-relative starts; reject unsafe or unresolved references, and preserve raw timebase/frame evidence. A matching basename alone must not override contradictory identity metadata or several possible editions. OPF input does not authorize OPF output; JSON export is separately selected in ADR-0053. Ambiguous/invalid sidecars must be visible issues, not hidden success.

## Verification

Planned for T004: exact matching sidecars, multiple editions in a folder, multiple CUE candidates, multi-disc/multi-file FILE references, missing/unsafe targets, and valid associated CUE taking precedence over embedded chapters while preserving protected edits. No parser/association implementation was added in this session.

## Open questions

Exact association filename/identifier rules, safe path handling and CUE decoding/rounding cases must be concrete in the T004 specification. Chapter starts remain the navigation contract; explicit chapter ends/intro-gap UI are not silently selected here.
