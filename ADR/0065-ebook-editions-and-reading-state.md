# ADR-0065: Use file-anchored ebook editions and revisioned reading state

Status: Accepted
Date: 2026-11-14
Decision owner: Repository owner

## Context

T004 indexes ebook files but has no edition or reading entities. ADR-0006 separates titles/editions/files; ADR-0015 requires revision-aware conflicts and exact-file locations. T005 needs concrete behavior before implementation.

## Decision

Accepted by explicit user choices on 2026-11-14. The selected policy below was approved during T005 preparation.

Use one initial edition per distinct ebook file, retaining its edition and file IDs through a recognized move or same-path content replacement. A replacement changes the content version and invalidates precise old locations; it never silently converts them. Separate translations/formats remain distinct editions, with conservative title association and explicit review rather than title-text-only merging. Manual title linking can preserve edition/file identities.

Use versioned format-specific locators: Foliate CFI for supported reflowable formats, zero-based PDF page plus normalized unrotated crop-box coordinates, and a comic page index plus stable archive entry identity. Validate locators against the exact file/version and renderer compatibility. A percentage is display context, not a resume anchor. Locator conversion across versions/formats is not automatic.

Use server-issued revisions, operation UUID receipts, durable conflicts and explicit resolution for reading positions and completion, following T003's 409/412 behavior. Backward reading is valid. Require explicit manual finish/unfinish for ebook completion in T005; navigating to the last page does not silently finish an edition. Keep edition completion and title history separate. Preserve device candidates and conflict evidence without automatic pruning.

## Alternatives

- Group matching filenames/formats into one edition and resume by percentage: risks collapsing translations and unrelated locations.
- File-anchored editions and typed locations, as selected.
- Add cross-format conversion and automatic completion now: larger scope and unresolved fidelity rules.

## Consequences

T005 owns edition persistence, ingestion integration and reading APIs. File content is never modified by reading. Shared protocol data can support later Android adaptation without copying AGPL code. The scope must not imply a fully adapted Android ebook reader.

## Verification

Planned: scan real generated files; move/replacement; separate translations; title linking; reload/font/layout/zoom/rotation resume; backward saves; two-client 409 conflicts; incompatible-version 412; response-loss replay; manual finish history without finishing sibling editions. Test renderer-produced locators rather than fabricated percentages.

## Open questions

None within the T005 policy. The concrete contract lives in `contracts/t005/`; ADR-0068 places Android ebook adaptation in a separately owned later package. Dependency/engine pins and compatibility evidence are implementation deliverables, not permission to change locator semantics.
