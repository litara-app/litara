# ADR-0052: Enable metadata writes only for fidelity-tested formats

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0048 selects in-file metadata writes but does not promise safe writing for every recognized format. EPUB/container/tag rewrites can lose content, chapters, artwork or unsupported metadata even without deliberate transcoding.

## Decision

The user selected the following on 2026-11-13:

- Initially target EPUB, MP3, FLAC and M4A/M4B for in-file metadata updates.
- Enable each writer only after round-trip tests demonstrate preservation of book/audio content, chapters and artwork.
- Keep other formats explicitly read-only for metadata writing until separately verified.
- No transcoding or format conversion.

## Alternatives

- Initially target only EPUB/MP3/FLAC.
- Decide every format separately before development.
- Target the listed formats while gating each on demonstrated fidelity, as selected.

## Consequences

Recognition/read support and tag-write support are separate capability states. A failed or incomplete fidelity check leaves that writer disabled with an explicit reason; it must not silently strip chapters/artwork or rewrite media encoding. List the approved fields/format combinations, provenance and evidence for each enabled writer. Existing user approval is tied to a concrete metadata plan, not permission for format conversion or automatic future writer enablement.

## Verification

Planned for T004: before/after text/audio payload equivalence, chapter/artwork preservation, unsupported-field handling, malformed/protected inputs and representative EPUB/MP3/FLAC/M4A/M4B round trips. Record writer/tool versions; recognition alone is not a pass. No format writer was built or tested during this decision session.

## Open questions

Exact writer packages, allowed field mappings, validation procedures and filesystem publication safety must be specified/tested during implementation within this fidelity gate.
