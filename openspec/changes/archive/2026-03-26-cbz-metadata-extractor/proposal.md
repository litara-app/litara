## Why

CBZ files currently fall back to filename-only metadata, giving them no title, author, publisher, or cover data. The CBZ format has a well-established metadata standard (`ComicInfo.xml` inside the ZIP) used by virtually all comic managers (ComicRack, Komga, Kavita), and we should extract it the same way we do for EPUB and MOBI.

## What Changes

- New `@litara/cbz-parser` monorepo package that reads CBZ/CBR ZIPs and extracts `ComicInfo.xml` metadata and the cover image (first image in the archive).
- `extract-file-metadata.ts` gains a CBZ branch that calls the new parser instead of the filename fallback.
- Cover extraction in the library scanner gains a CBZ branch using the new parser.

## Capabilities

### New Capabilities

- `cbz-metadata`: Extracts title, authors (Writer field), publisher, series, published date, description, language, genres, and tags from `ComicInfo.xml`; falls back to filename parsing if the file has no `ComicInfo.xml`. Also extracts the cover image (first sorted image entry in the archive).

### Modified Capabilities

- `book-metadata-extraction`: The extraction pipeline now handles CBZ/CBR in addition to EPUB/MOBI. No spec-level requirement changes — this is an implementation gap fill.

## Impact

- **New package**: `packages/cbz-parser` (similar structure to `packages/mobi-parser`)
- **Dependencies added**: `adm-zip` (ZIP reading) and `fast-xml-parser` (XML parsing) as deps of the new package
- **API files changed**: `extract-file-metadata.ts`, `library-scanner.service.ts` (cover extraction path)
- **No breaking changes** — CBZ files already exist in the scanner; this improves data quality without changing any interfaces
