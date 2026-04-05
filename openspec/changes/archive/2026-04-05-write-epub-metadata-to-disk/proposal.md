## Why

Users manage ebook metadata within Litara, but changes only live in the database — the epub files themselves remain unmodified. Writing metadata back to epub files makes the library portable: if a user moves their files or uses another reader, enriched metadata travels with the books.

## What Changes

- Add a **Write Metadata to File** button (yellow) in the book modal, enabled only when the library directory is writable (not mounted read-only) AND the admin setting permits it
- Clicking the button overwrites all metadata fields that have a value directly into the epub file on disk (title, authors, description, publisher, date, language, ISBN, series info, genres/tags, etc.)
- Add admin settings for write-back control: a toggle to **allow writing metadata to epub files** (global gate), and a toggle to **auto-write metadata to epub on enrichment** — when enabled, every metadata enrichment run also writes the result back to the epub file automatically
- Backend detects at runtime whether the library directory is writable (probe write test), and exposes this as part of the server capabilities response so the UI can enable/disable the button accordingly
- Backend endpoint to accept a write-metadata-to-epub request for a given book

## Capabilities

### New Capabilities

- `epub-metadata-write`: Write current Litara metadata back into an epub file on disk, covering all supported metadata fields. Triggered manually via UI button or automatically after enrichment.

### Modified Capabilities

- `admin-password-reset`: No changes needed — unrelated admin settings pattern is reused but no spec changes required.

## Impact

- **Backend**: New `BookFilesModule` or extension of `LibraryModule` — new service method using `epub2` or a write-capable library (e.g., `epub-metadata`) to patch epub OPF/metadata; new API endpoint `POST /books/:id/write-metadata`
- **Frontend**: Book modal gets a yellow "Write to File" button; admin settings page gets a new toggle
- **Environment**: No new env vars — writability is detected at runtime by probing the library directory for write access
- **Database**: New `ServerSettings` fields: `allowWriteMetadataToFile` (boolean, default `false`) and `autoWriteMetadataOnEnrich` (boolean, default `false`)
- **Dependencies**: May need a new npm package capable of writing epub metadata (e.g., `epub-parser`, `epub-craft`, or direct ZIP/XML manipulation)
