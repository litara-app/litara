# ADR-0025: Target broad first-release formats with explicit capability states

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Old Litara recognizes more extensions than its rich metadata extraction supports. BookOrbit advertises a broader reader/media range. Merely indexing a filename does not establish successful extraction, reading, seeking, or client playback.

## Decision

The user selected BookOrbit's broad ebook/comic/audio range as the first-release target rather than limiting full support to a small core. The user also accepted retaining files visibly in an explicit incomplete/unsupported state when required parsing capabilities fail, and requiring capability verification before claiming full support.

| Family | First-release target |
| --- | --- |
| Ebooks | EPUB, KEPUB, MOBI, AZW, AZW3, FB2 |
| Documents | PDF |
| Comics | CBZ, CBR, CB7 |
| Audio | M4B, M4A, MP3, OPUS, OGG, FLAC |

## Alternatives

- Fully support EPUB/PDF/CBZ and M4B/M4A/MP3, keeping other formats index/download-only initially.
- Add legacy ebook formats but defer the broader comic/audio range.
- Target the broad range with honest capability reporting, as selected.

## Consequences

This is a target, not a statement of completed support or universal codec playback on every client. Track recognition, metadata/artwork, timing/chapters, reading/playback, delivery, and progress separately. Unsupported variants remain visible without fabricated durations or broken multi-file seeking. Distinguish containers from codecs and DRM-free supported content from encrypted files; DRM removal is not a selected feature. Do not silently reduce a target format to download-only and call it fully supported. Conversion and per-client playback guarantees remain undecided.

## Verification

Create a representative corpus per target format and record each client/capability result. Include multi-file audio, variable bitrate, MP4 chapter variants, fixed-layout books, solid comic archives, damaged/encrypted inputs, and large files. Demonstrate explicit incomplete states and preserve originals. None of this format coverage has been implemented or runtime-verified in the replacement.

## Open questions

Exact codec/profile matrix, unsupported-client behavior, conversion policy, metadata extractors, annotation capabilities by format, archive limits, and the release gate for remaining capability gaps remain open.

## References

- [BookOrbit advertised formats](https://github.com/bookorbit/bookorbit#features)
- [Existing audit contract](../research/android/backend-contract.md)
