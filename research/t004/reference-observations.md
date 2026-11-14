# T004 reference observations

Date: 2026-11-13. Read-only source/documentation observations; these do not accept new architecture or authorize implementation.

## Archived Litara

- archive/litara-v1/apps/api/src/audiobook/audiobook-scanner.service.ts loadCueChapters selects the first directory entry ending in .cue. The surrounding chapter code calls it only when embedded chapters were absent. This differs from accepted ADR-0029/0042 CUE precedence and whole-source validation; do not port that behavior blindly.
- archive/litara-v1/apps/api/src/audiobook/audiobook-metadata.service.ts parseCueFile recognizes TITLE/TRACK/INDEX 01 and converts frames using 75 frames/second, then derives ends from later starts/total duration. The inspected function does not use FILE directives to anchor entries to distinct versioned files. T004 needs explicit file association and the accepted file-relative model, not an assumed whole-folder duration.
- The archived audio scanner streams bytes through SHA-256. The library scanner also uses file hashes and a KOReader hash. These are code observations, not approval to make hashes the public file ID or copy the old matching/grouping behavior.

## Provider documentation checked

- [Open Library API guidance](https://openlibrary.org/developers/api) documents read-only search/lookup APIs, client identification, caching and rate limits. Context7 was consulted for current documentation. Implementation must respect the current provider policy rather than bulk scraping a library through the public API.
- [Google Books API usage](https://developers.google.com/books/docs/v1/using) and [volume search](https://developers.google.com/books/docs/v1/reference/volumes/list) describe read-only metadata searches and application/API-key identification. Query metadata need not include book-file uploads. Configuration/keys stay local.
- [Audnexus project README](https://github.com/laxamentumtech/audnexus) currently directs new projects to AudiobookDB and states Audnexus remains maintained. This notice was confirmed through Context7 and the primary repository. AudiobookDB's site did not load through the browsing tool in this session; no claims about its current API/terms/readiness are made. Provider selection must follow the user's explicit answer, not a presumed migration.

No scanner/provider/parser code, runtime media tests, external library uploads, or NAS/hardware acceptance were performed for this decision session. T003's active source, schema and contract ownership remain untouched.
