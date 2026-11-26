# ADR-0105: Store author photos like covers and refuse out-of-date edits

Status: Accepted
Date: 2026-11-26
Decision owner: Repository owner
Amends: [ADR-0102](0102-editable-lockable-author-data.md), [ADR-0104](0104-author-and-series-page-defaults.md)

## Context

Stage 2 of [ADR-0104](0104-author-and-series-page-defaults.md) adds author photos and shared editing of author and series details. [ADR-0102](0102-editable-lockable-author-data.md) and ADR-0104 left photo storage and limits, and what happens when two administrators edit at once, open. [ADR-0086](0086-cover-replacement.md) already sets both for covers, and [ADR-0095](0095-field-level-metadata-editing-and-provider-review.md) refuses out-of-date book metadata saves.

## Decision

On 2026-11-26 the owner chose, from the offered options:

1. **Photos follow the cover rules of ADR-0086.** A photo is added by uploading an image or giving an image address. It is stored in the database as a JPEG the server re-encodes, longest side at most 1600 px with metadata stripped. Sources are limited to 10 MiB of JPEG, PNG or WebP, judged by content. An address is fetched under ADR-0086's address, redirect, time and size limits.
2. **An out-of-date edit is refused, as for books.** A save carries the revision the form was loaded from. A stale save is a conflict and stores nothing.

Online photo search remains stage 3 of ADR-0104.

## Alternatives

- Upload only: no server-side fetching, but the chosen mockup's image address field is left out.
- Last save wins, as covers do: simpler, but one administrator can silently overwrite another's changes.

## Consequences

The database grows with each stored photo, and backups include them. The cover image pipeline and fetcher are reused. Because a photo change is an edit to the author, it carries a revision too, unlike a cover change.

## Verification

Done on 2026-11-26 (Go integration test `TestAuthorAndSeriesDetails` against PostgreSQL 17.6): upload and address fetch each store a JPEG the server re-encoded, with a 2000 px upload served at 1600 px; an SVG upload and a stale upload store nothing; a stale detail save is a conflict; a viewer without a grant gets neither details nor photo. Address fetching in this test used a local server with the private-address guard off, as the cover tests do; the guard itself is the cover fetcher's and is covered by its tests. The oversize, polyglot, decompression-bomb and redirect inputs were not repeated for photos.

## Open questions

None within this record's scope.
