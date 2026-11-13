# ADR-0042: Validate chapter sources as a whole before falling back

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0029 accepts user edits, valid CUE, embedded chapters and generated file-boundary markers in that precedence, while leaving source validation unresolved. Invalid chapter entries can produce inconsistent playback timelines across clients.

## Decision

The user selected on 2026-11-13:

- Reject a chapter source as a whole if any start is negative, duplicated, out of order or outside its source file.
- Report the issue and try the next source using protected explicit edits, associated CUE, then embedded metadata.
- If no valid chapter source is available, create clearly labeled generated file-boundary navigation markers.
- Preserve raw evidence and user edits. Never overwrite explicit edits automatically.

This selects whole-source validation instead of salvaging a partly invalid source.

## Alternatives

- Salvage valid entries from a partly invalid source, potentially changing its intended structure.
- Reject the invalid source with a visible issue and use a valid fallback, as selected.

## Consequences

Validate starts in recording order while respecting file-relative anchors: a later file’s offset may restart at zero and is not by itself out of order. Compare anchored/derived recording positions, not just raw offsets from different files. A start at or beyond a known file duration is outside that file; unknown duration cannot prove a valid whole timeline and follows ADR-0039 incomplete readiness. Preserve invalid edited source data for repair even while showing a fallback. Do not merge conflicting sources into invented extra chapters or fabricate unknown durations. Generated markers are not authored chapters; a chapterless single-file recording remains valid. T003 exercises this policy with seeded normalized sources; real CUE discovery/association/parser implementation belongs to T004.

## Verification

Test negative/duplicate/descending/out-of-range starts, file-relative starts across a multi-file recording, invalid edited/CUE source falling back without mutation, all sources invalid with labeled generated markers and no authored chapters. Planned shared fixtures for T003/T004; no parser was implemented in this decision session.

## Open questions

CUE association with library files, cross-file explicit chapter ends, intro-gap presentation and source editing UI remain separate T004/T005 specifications. T003 requires starts for navigation; it must not claim explicit-end interval semantics were selected here.
