## Context

Litara already has a `DiskWriteGuardService` that:

- Stores an `allow_disk_writes` admin setting in `ServerSettings`
- Probes the library directory at runtime to detect read-only mounts
- Exposes `getDiskSettings()` returning `{ allowDiskWrites, isReadOnlyMount }`

The existing disk-write gate (used for sidecar writes) is the correct foundation. This change adds epub metadata write-back on top of it, with one additional admin toggle for the auto-write-on-enrichment behaviour.

## Goals / Non-Goals

**Goals:**

- Allow an admin to manually write Litara's current metadata for a book back into its epub file on disk
- Allow auto-write-back after bulk/guided metadata enrichment (opt-in admin setting)
- Reuse the existing `DiskWriteGuardService` — no new env vars
- Only epub files are in scope for now

**Non-Goals:**

- Writing metadata to mobi, azw, cbz, or pdf files
- Reading metadata back from the file after a write (round-trip verification)
- Exposing per-user write controls — this is an admin-level setting only

## Decisions

### 1. Epub write library

**Decision**: Use direct ZIP + XML manipulation (Node.js `adm-zip` or `jszip` + `fast-xml-parser`) rather than a dedicated epub-write library.

**Rationale**: No maintained npm package for epub metadata _writing_ exists with a stable API. The epub format is a ZIP archive; the OPF metadata file (`content.opf` or equivalent) is plain XML. Parsing and patching the OPF in-place is straightforward and keeps the dependency footprint small. The approach:

1. Open the epub as a ZIP
2. Locate the OPF file (via `META-INF/container.xml`)
3. Parse the OPF XML, patch `<dc:*>` and `<meta>` elements
4. Replace the OPF entry in the ZIP and write back to disk

**Alternative considered**: `epub-edit` / `epub-craft` npm packages — both unmaintained.

### 2. Gate: reuse existing DiskWriteGuardService

**Decision**: The write-to-file button is enabled only when `allowDiskWrites === true` AND `isReadOnlyMount === false`. No new env var is introduced.

**Rationale**: The existing `getDiskSettings()` endpoint already returns both flags. The frontend already fetches this for the Disk Settings admin panel. The book modal can read the same server capabilities response.

### 3. New admin setting: `auto_write_metadata_on_enrich`

**Decision**: A single new `ServerSettings` key `auto_write_metadata_on_enrich` (default `false`) controls whether the bulk/guided enrichment pipeline calls the epub write service after applying metadata.

**Rationale**: Auto-write is risky (modifies files in bulk) so it is opt-in and scoped to admin settings. It lives alongside the existing `metadata_field_config` and `metadata_match_throttle_ms` settings in `BulkMetadataService`.

### 4. API endpoint

**Decision**: `POST /api/v1/books/:bookId/write-epub-metadata` — protected by JWT + admin role + disk write guard. Returns `{ success: true, filePath: string }` or an error.

**Rationale**: Keeps book-file operations under the books resource. The endpoint is idempotent (re-writing the same metadata is safe).

### 5. OPF fields to write

All Litara metadata fields that have a value are written. Fields with null/empty values are left untouched in the OPF (not removed). Fields written:

| Litara field  | OPF element                             |
| ------------- | --------------------------------------- |
| title         | `<dc:title>`                            |
| subtitle      | `<meta property="dcterms:alternative">` |
| description   | `<dc:description>`                      |
| authors       | `<dc:creator>` (one element per author) |
| publisher     | `<dc:publisher>`                        |
| publishedDate | `<dc:date>`                             |
| language      | `<dc:language>`                         |
| isbn13        | `<dc:identifier scheme="ISBN-13">`      |
| isbn10        | `<dc:identifier scheme="ISBN-10">`      |
| genres        | `<dc:subject>` (one per genre)          |
| tags          | `<dc:subject>` (appended, deduplicated) |
| seriesName    | `<meta name="calibre:series">`          |
| seriesNumber  | `<meta name="calibre:series_index">`    |

## Risks / Trade-offs

- **File corruption** → Mitigation: write to a temp file first; only replace the original on success. If ZIP manipulation fails, the original is untouched.
- **Epub spec variance** → Some epubs use EPUB 2 OPF, others EPUB 3. Both use the same `<dc:*>` namespace; the write service handles both by preserving the existing OPF structure and only patching matching elements.
- **Concurrent writes** → If two write requests come in for the same book simultaneously, the second one will overwrite the first (last-write-wins). Acceptable for now given admin-only access.
- **Large files** → Loading the full epub into memory to re-ZIP could be slow for very large files. Mitigation: use streaming ZIP patching if this becomes a problem (deferred).
