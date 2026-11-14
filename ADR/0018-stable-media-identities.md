# ADR-0018: Play recordings using stable opaque identities and content versions

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

ADR-0006 separates titles, editions/recordings, and files. The [Android contract audit](../research/android/backend-contract.md) finds fragile matching between file and asset identifiers, and Auto currently starts from a book entry. Different recordings can have different narrators, timing, and files.

## Decision

The user selected a specific recording as the Android/Auto playable unit. Use stable opaque identifiers for recordings and files; renaming or moving a file does not change its identifier. Represent content changes with explicit versions. Use the same file identity consistently in catalog, playback, download, and position contracts rather than requiring size/name/format heuristics.

## Alternatives

- Play a title and implicitly choose a default recording.
- Encode paths or content hashes as playback identifiers.
- Stable recording/file IDs plus explicit content versions, as selected.

## Consequences

Paths locate content and hashes help verify it; neither is the API identity. Detecting a move and deciding that changed bytes are a new version still require an ingestion algorithm. IDs must not grant access by themselves. Content version and recording-layout revision represent different changes; do not conflate them with position-update revisions.

## Verification

Planned: rename/move a file without breaking identity; distinguish recordings of the same title; invalidate stale content assumptions after changed bytes; remove Android's heuristic file-to-asset mapping. Do not automatically reuse an old location just because the file ID is unchanged.

## Open questions

Identifier encoding, move/version matching algorithm, primary recording selection in non-Auto UI, layout revision format, and revision retention remain open.
