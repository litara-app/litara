## 1. Database & Configuration

- [x] 1.1 Add `PendingBook` model to `prisma/schema.prisma` with fields: `id`, `status` (enum: PENDING, APPROVED, REJECTED, COLLISION), `stagedFilePath`, `fileHash`, `targetPath`, `collidingPath`, `overwriteApproved`, and metadata fields (title, authors, seriesName, seriesPosition, publisher, language, description, isbn10, isbn13)
- [x] 1.2 Extend `ServerSettings` model with `libraryWriteEnabled` (Boolean, default false) and `shelfmarkUrl` (String, optional)
- [x] 1.3 Create and run Prisma migration for the above schema changes
- [x] 1.4 Add `BOOK_DROP_PATH` environment variable and volume mount to `docker-compose.yml` with a default of `./book-drop` (separate from `EBOOK_LIBRARY_PATH`)

## 2. Library Write Service

- [x] 2.1 Create `LibraryWriteService` in `apps/api/src/library/` that reuses the existing write-probe mechanism to set `isReadOnly` at init and re-checks before every write
- [x] 2.2 Implement path computation: `first-author/series/title.ext` → `first-author/title.ext` → `unknown/title.ext` → `unknown/original-filename`; sanitize segments (NFC, strip illegal chars, collapse whitespace, truncate to 200 chars)
- [x] 2.3 Implement collision detection: check if `targetPath` exists before writing; if so set `PendingBook.status = COLLISION` and populate `collidingPath`
- [x] 2.4 Implement write operation: create directories as needed, copy staged file to target path; handle overwrite when `overwriteApproved = true`; re-check target existence at write time
- [x] 2.5 After successful write, create `Book` and `BookFile` records in the database (reuse existing scanner record-creation logic)
- [x] 2.6 Write unit tests for path computation covering all four priority cases, multi-author, and sanitization edge cases

## 3. Book Drop Module (API)

- [x] 3.1 Create `BookDropModule` with `BookDropController` and `BookDropService` in `apps/api/src/book-drop/`
- [x] 3.2 Implement `POST /api/v1/book-drop/upload`: stream files via `multer` disk storage to `BOOK_DROP_PATH`; validate extension; compute SHA-256 hash; create `PendingBook` or return 409 on duplicate hash
- [x] 3.3 Implement `GET /api/v1/book-drop/pending` (admin only): return all PENDING and COLLISION records
- [x] 3.4 Implement `PATCH /api/v1/book-drop/:id` (admin only): update metadata fields on a `PendingBook`
- [x] 3.5 Implement `POST /api/v1/book-drop/:id/approve` (admin only): call `LibraryWriteService`; return appropriate errors for read-only volume or disabled writes
- [x] 3.6 Implement `POST /api/v1/book-drop/:id/approve-overwrite` (admin only): validate `status: COLLISION`, set `overwriteApproved = true`, re-run write
- [x] 3.7 Implement `POST /api/v1/book-drop/:id/reject` (admin only): set `status: REJECTED`, leave staged file on disk
- [x] 3.8 Add Swagger decorators and `@ApiBearerAuth()` to all endpoints; run `npm run build` to verify compilation

## 4. Drop Folder Watcher

- [x] 4.1 Add a second chokidar watcher in `BookDropService` scoped to `BOOK_DROP_PATH`; on `add` events validate extension, hash file, create `PendingBook` if not a duplicate
- [x] 4.2 On init, if `BOOK_DROP_PATH` is unset or the directory does not exist, log a warning and skip watcher initialisation without crashing
- [x] 4.3 Ensure `LibraryScannerService` excludes `BOOK_DROP_PATH` from its watch paths to prevent double-ingestion

## 5. Metadata Extraction

- [x] 5.1 Verify existing metadata extractors (epub2, mobi-parser) are called from `BookDropService` when a `PendingBook` is created
- [x] 5.2 For formats with no extractable metadata (cbz, pdf fallback), preserve the original filename as the fallback title

## 6. Settings API

- [x] 6.1 Add `PUT /api/v1/settings/library` and `GET /api/v1/settings/library` (admin only): manage `libraryWriteEnabled`; include `volumeReadOnly` (live write-probe result) in the response
- [x] 6.2 Add `PUT /api/v1/settings/shelfmark` and `GET /api/v1/settings/shelfmark` (admin only): store and return `shelfmarkUrl` only; accept null/empty to clear

## 7. Web Frontend — Book Drop Upload

- [x] 7.1 Create a Book Drop page (`/book-drop`) accessible to all authenticated users
- [x] 7.2 Implement drag-and-drop and click-to-browse using a Mantine v8 Dropzone component
- [x] 7.3 Show per-file upload progress; on success display extracted title, author, cover thumbnail (if available), and "Pending Review" status
- [x] 7.4 Show inline "Unsupported file type" error for invalid extensions without uploading

## 8. Web Frontend — Admin Book Review

- [x] 8.1 Create an admin-only "Book Review" route (`/admin/book-review`); redirect non-admins
- [x] 8.2 Fetch and display all pending and collision books with cover, metadata, computed target path, and status badge
- [x] 8.3 Implement inline metadata editing (title, authors, series, etc.) with a Save button calling `PATCH /api/v1/book-drop/:id`
- [x] 8.4 Implement Approve action (`POST /api/v1/book-drop/:id/approve`); surface read-only and write-disabled error states with clear messages
- [x] 8.5 Implement Reject action (`POST /api/v1/book-drop/:id/reject`)
- [x] 8.6 For collision entries: show existing file path and a distinctly styled "Approve Overwrite" button with a confirmation dialog calling `POST /api/v1/book-drop/:id/approve-overwrite`

## 9. Web Frontend — Settings & Navigation

- [x] 9.1 Add a Library Writes section to the settings page (admin only) with `libraryWriteEnabled` toggle; show read-only volume warning when `volumeReadOnly: true`
- [x] 9.2 Add a Shelfmark section to the settings page (admin only) with a URL input field and Save button
- [x] 9.3 Add a "Shelfmark" item to the left navigation bar that appears only when `shelfmarkUrl` is configured; include an external-link icon and open the URL in a new tab (`target="_blank" rel="noopener noreferrer"`)

## 10. Mobile — Book Drop Upload

- [x] 10.1 Add a Book Drop screen to the mobile app using `expo-document-picker` for file selection
- [x] 10.2 Upload the selected file to `POST /api/v1/book-drop/upload` with a progress indicator
- [x] 10.3 Show extracted metadata on success; show an inline error for unsupported file types or network failures

## 11. Mobile — Admin Book Review

- [x] 11.1 Add an admin-only "Book Review" screen to the mobile navigation (hidden from non-admins)
- [x] 11.2 Fetch and display pending and collision books with title, author, status, and action buttons (Approve / Reject)
- [x] 11.3 Implement Approve and Reject API calls with list refresh on completion
- [x] 11.4 For collision entries: show a warning banner with the colliding path; present "Approve Overwrite" and "Reject" as the only actions

## 12. Mobile — Shelfmark Navigation Link

- [x] 12.1 Fetch `shelfmarkUrl` from `GET /api/v1/settings/shelfmark` on app load (or alongside other settings)
- [x] 12.2 When `shelfmarkUrl` is set, add a "Shelfmark" item with an external-link icon to the mobile navigation; tapping it calls `Linking.openURL(shelfmarkUrl)`
- [x] 12.3 When `shelfmarkUrl` is null or empty, omit the navigation item entirely

## 13. Documentation & Docker

- [x] 13.1 Update `docker-compose.yml` with the `BOOK_DROP_PATH` volume mount and env var, with a clear comment
- [x] 13.2 Update `CLAUDE.md` environment variable table with `BOOK_DROP_PATH`
