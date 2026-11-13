# ADR-0029: Define recording chapter positions, sources, and fallback markers

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner
Updated: 2026-11-13
Accepted: 2026-11-13

## Context

ADR-0018 selects recordings as playable units and stable versioned file identities. ADR-0019 anchors saved audio positions to a file/version plus millisecond offset. The preserved Android player expects chapter starts on a whole-recording timeline and uses known file durations to translate between queue positions and recording time.

The old Litara extractor returns embedded chapters relative to a file and also parses CUE chapter definitions. The [Android contract audit](../research/android/backend-contract.md) identifies whole-recording chapter metadata as necessary for the preserved player and Cast proxy, which deliberately hides some embedded container chapter tracks from the receiver. Clients need one coherent recording description rather than reconstructing it through file/asset heuristics.

## Decision

The user accepted the following choices on 2026-11-13:

- Keep chapters specific to their recording. Anchor each chapter start to a file/content version plus its offset in milliseconds; expose server-derived whole-recording millisecond starts to clients. The user confirmed file-relative positions after discussing occasional import-order repairs.
- Calculate whole-recording start from preceding known file durations plus the chapter's file-relative offset, consistent with ADR-0019. Unknown timing remains explicit under ADR-0025 rather than being fabricated as zero.
- After protected explicit user edits, prefer a valid associated CUE sidecar, then embedded chapter metadata.
- If no chapter definitions exist, generate navigation markers at file boundaries and distinguish them from authored chapters.

These choices govern chapter behavior. They do not approve a complete manifest field list or freeze the API. Stable file/content identities, ordered recordings, and layout-change detection remain governed by ADR-0018/0019. Original media is preserved; this decision does not authorize container rewriting or conversion.

## Alternatives

- Store only whole-recording chapter offsets: simpler representation, but edits to file order/durations can invalidate their meaning.
- Return only per-file chapter offsets and let clients compute the recording timeline: distributes ordering/rounding/readiness logic across clients.
- Prefer embedded chapters over CUE or require explicit source selection when both exist.
- Leave chapterless recordings without chapter navigation, rather than synthesizing file-boundary markers.

## Consequences

The selected representations will become part of the shared web/Android contract and offline recording metadata. File ordering/content changes must invalidate affected derived timelines instead of silently changing saved locations. Raw extraction results and effective user-selected metadata should remain distinguishable so rescan does not overwrite edits or hide source conflicts.

Reordering is an occasional import/library repair scenario: incorrect filename sorting, reversed disc order, or insertion of a previously missing track. A user-facing reorder feature is not required by this proposal. The primary reason for file-relative chapter anchors is retaining the source file's local chapter positions and aligning them with ADR-0019; repairing order is an additional benefit, not the sole justification.

This decision does not freeze endpoint names, identifier encoding, the detailed manifest/offline snapshot schema, progress concurrency/status codes, library permissions, grouping rules, or conversion behavior. Chapter source validation, invalid/out-of-range positions, duplicate starts, intro gaps, cross-file ranges, and missing durations need explicit validation rules before implementation. Chapterless single-file recordings must not be rejected merely for lacking chapters.

## Verification

Planned: a three-file recording with known durations maps file-relative chapters to exact whole-recording starts; reordering preserves file anchors and changes the layout revision. File replacement surfaces version incompatibility. Embedded/CUE conflicts and rescans preserve explicit edits. Generated file markers are distinguishable from authored chapters. Missing timing produces an incomplete capability state. Web and Android use the same contract fixtures, including chapters spanning file boundaries and chapterless recordings. No manifest API or player changes have been implemented in this ADR task.

## Open questions

Exact manifest fields/versioning, CUE association/validation, source-level error handling, duplicate/out-of-range chapter starts, cross-file ranges, intro gaps, and playback readiness with incomplete durations remain to be specified. The chapter-position/source/fallback choices above are accepted; there is no published manifest API yet.

## References

- [Stable media identity](0018-stable-media-identities.md)
- [File-anchored progress](0019-file-anchored-audio-positions.md)
- [Protected metadata edits](0014-protect-metadata-edits.md)
- [Android chapter normalization](https://github.com/deranjer/bookorbit-android/blob/a55eaa13d8ba27cd143dda882836ed35a4dc923f/app/src/main/java/com/bookorbit/feature/player/PlaybackQueue.kt)
- Historical Litara: `archive/litara-v1/apps/api/src/audiobook/audiobook-metadata.service.ts`.
