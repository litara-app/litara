# ADR-0039: Gate incomplete recordings and retain versioned downloads

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0025 requires explicit incomplete capability states; ADR-0029 requires known durations for derived recording timelines. The preserved player/Cast/Auto stack consumes ordered file durations before playback. ADR-0018/0019 distinguish stable file identity from changed content.

## Decision

The user selected on 2026-11-13:

- T003 lists recordings with missing files or unknown file durations as incomplete and blocks whole-recording playback and download. Individual-file playback as an incomplete-recording workaround is not selected for T003.
- When server audio bytes change, retain an existing download as its old content version, warn that an update is available, and require explicit redownload. Never silently replace downloaded bytes or transfer a saved position to changed bytes.

Chapterless recordings remain valid; lack of authored chapters alone is not an incomplete-readiness failure.

## Alternatives

- Allow individual available files to play despite incomplete whole-recording timing.
- Block old downloads after a detected replacement.
- Gate incomplete recordings while retaining an explicitly versioned complete old snapshot, as selected.

## Consequences

Recording detail/offline snapshots need stable recording/file IDs, explicit content versions, layout revision, ordered per-file sizes/MIME/duration, effective chapter anchors and derived starts, display metadata, artwork references and explicit capability/issues. Raw paths are not resource IDs. A snapshot is not permission to bypass later access revocation (ADR-0032). Version-change warnings do not invalidate an otherwise complete authorized old download. Reordering alone can reuse compatible file/version anchors under the sync protocol; changed bytes cannot. Interrupted redownloads must not publish a partially replaced snapshot or remove the usable old version.

## Verification

Test missing files, unknown durations, valid chapterless recordings, a complete recording, new bytes versus old downloaded snapshot, explicit interrupted redownload and no silent offset transfer. Verify account/library access checks still block revoked cached content. Planned for T003 with seeded fixtures; ingestion detection belongs to T004.

## Open questions

Detailed manifest endpoint/field names and schema version are contract-authoring work within these rules. File matching/move detection, automatic grouping and CUE association/import remain T004 decisions; no algorithms are accepted here.
