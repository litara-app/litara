## Why

Books in a self-hosted library often lack complete metadata — especially ISBNs, Goodreads IDs, and descriptions — because automated scanners rely on filename-based fallbacks. Manually enriching each book one at a time is impractical for large libraries. A bulk metadata matching flow, where the user can configure field sources and their priority order, and optionally guide ambiguous matches, eliminates this friction at scale.

## What Changes

- New **Admin** section: "Metadata Matching" — configures which metadata fields come from which provider and in what order
- Providers: OpenLibrary, Google Books, Goodreads, Hardcover
- Fields can be chained: e.g. fetch ISBN-13 from OpenLibrary → use that ISBN to query Goodreads for rating/ID
- Bulk match trigger: run for all books, a specific library, or a specific shelf
- Guided disambiguation: when OpenLibrary returns multiple candidate books for a title/author query, show up to 3 options and let the user pick before the rest of the chain runs automatically
- Background task execution with progress reporting (reusing the existing Task system)
- Per-field source configuration with drag-to-reorder priority (only fills blank fields by default; overwrite mode optional)

## Capabilities

### New Capabilities

- `bulk-metadata-match`: Bulk metadata enrichment — admin UI to configure field-source mapping, provider chain order, and trigger runs against all books, a library, or a shelf. Includes guided disambiguation flow for ambiguous OpenLibrary results.

### Modified Capabilities

- `metadata-providers`: Existing single-book metadata fetch will be extended to support ISBN-based chained lookups (use ISBN-13 resolved from one provider to query the next). The provider abstraction needs to accept a pre-resolved identifier as a hint.

## Impact

- **Backend**: New `BulkMetadataModule` with controller + service; new `POST /admin/metadata-match/run` endpoint; new `GET /admin/metadata-match/config` + `PUT` for config persistence; extend existing metadata provider services to support ISBN-passthrough; leverage existing `Task` model for background job tracking
- **Frontend**: New Admin sub-page "Metadata Matching"; field-source config table with drag-to-reorder; provider chain visualization; bulk run trigger with scope selector (all / library / shelf); guided disambiguation modal (shows up to 3 OpenLibrary candidates with cover + title + author + year)
- **Database**: New `ServerSettings` key(s) for metadata field config (JSON blob); no new tables required
- **Dependencies**: No new packages; Goodreads access via existing scraping/Hardcover API; OpenLibrary REST API (already used for metadata)
