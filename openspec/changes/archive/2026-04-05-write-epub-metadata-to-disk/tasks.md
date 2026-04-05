## 1. Backend — Epub Write Service

- [x] 1.1 Install `jszip` (or `adm-zip`) and `fast-xml-parser` (check if already present) in `apps/api`
- [x] 1.2 Create `apps/api/src/books/epub-metadata-writer.service.ts` with `writeMetadataToEpub(filePath, metadata)` — locates OPF via `META-INF/container.xml`, patches DC elements, writes to temp file, atomically renames over original
- [x] 1.3 Implement OPF field mapping per design: title, description, authors (replace all creators), publisher, publishedDate, language, isbn13, isbn10, genres+tags (combined subjects), seriesName, seriesNumber, subtitle
- [x] 1.4 Add unit tests for `EpubMetadataWriterService` covering: successful write, failure leaves original intact, only non-null fields are written, authors replace existing creators

## 2. Backend — API Endpoint

- [x] 2.1 Add `POST /books/:bookId/write-epub-metadata` endpoint to `BooksController` (admin-only guard + `DiskWriteGuardService.assertDiskWritesAllowed()`)
- [x] 2.2 Implement handler in `BooksService`: find epub `BookFile`, build metadata payload from book record (with authors, genres, tags, series), call `EpubMetadataWriterService`, return `{ success: true, filePath }`
- [x] 2.3 Return 422 when no epub file exists for the book; return 403 when disk writes are disabled
- [x] 2.4 Add Swagger decorators (`@ApiOperation`, `@ApiResponse`, `@ApiBearerAuth`) to the new endpoint

## 3. Backend — Auto-write on Enrichment Setting

- [x] 3.1 Add `getAutoWriteOnEnrich()` and `setAutoWriteOnEnrich(enabled: boolean)` methods to `BulkMetadataService` using key `auto_write_metadata_on_enrich` in `ServerSettings`
- [x] 3.2 Expose the setting via a new `GET /bulk-metadata/settings/auto-write` and `PUT /bulk-metadata/settings/auto-write` endpoint (or fold into existing bulk-metadata settings endpoint)
- [x] 3.3 In the bulk/guided enrichment pipeline, after saving metadata to DB for a book, check `autoWriteOnEnrich` — if true and the book has an epub file, call `EpubMetadataWriterService`; log and swallow errors so a write failure doesn't fail the enrichment task

## 4. Frontend — Book Modal Button

- [x] 4.1 Fetch `getDiskSettings()` in the book modal (or from a shared server capabilities context/store) to get `{ allowDiskWrites, isReadOnlyMount }`
- [x] 4.2 Add a yellow (`color="yellow"`) "Write to File" button in the book modal, rendered only when the book has at least one epub file
- [x] 4.3 Disable the button with appropriate tooltip when `!allowDiskWrites` ("Enable disk writes in Admin → Disk Settings") or `isReadOnlyMount` ("Library directory is read-only")
- [x] 4.4 On click, call `POST /books/:bookId/write-epub-metadata`, show loading state, display success notification or error message

## 5. Frontend — Admin Settings

- [x] 5.1 Add an "Auto-write metadata to epub after enrichment" toggle to the admin metadata/bulk settings section
- [x] 5.2 Fetch and save the `auto_write_metadata_on_enrich` setting via the new API endpoint
- [x] 5.3 Disable the toggle (with explanatory note) when `allowDiskWrites` is `false` or `isReadOnlyMount` is `true`

## 6. Validation

- [x] 6.1 Run `npm run build` from root and fix any TypeScript errors
- [x] 6.2 Manual test: write metadata for a book with an epub file, open the epub in a reader and verify metadata is updated
- [x] 6.3 Manual test: verify button is disabled when `allowDiskWrites` is off; verify it re-enables after turning it on
- [x] 6.4 Manual test: enable auto-write, run enrichment on an epub book, verify the epub file metadata is updated on disk
