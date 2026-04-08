## Context

Litara currently only discovers books by watching pre-configured library folders — there is no in-app mechanism to add new books. The library folder may be mounted read-only (`:ro` in Docker Compose), in which case writes must be entirely blocked. When the volume is writable, an admin-controlled toggle gates whether Litara is allowed to write at all, giving operators an extra safety layer.

One acquisition path is introduced: **Book Drop** — users upload ebook files via the web UI or mobile file picker; files can also arrive via a watched drop folder on disk. All acquired files pass through an **Admin Book Review Queue** (web + mobile) before touching the library on disk.

Shelfmark is supported as a simple external link only — no API integration.

## Goals / Non-Goals

**Goals:**

- Accept ebook files via UI upload (web + mobile file picker) and via a watched drop folder.
- Extract metadata automatically; allow admin enrichment from existing external sources.
- Compute destination paths deterministically (`author/series/title.ext` etc.).
- Detect name collisions and require explicit admin approval before overwriting.
- Detect read-only volume mount at runtime; block all writes when `:ro`.
- Show a Shelfmark external nav link (web + mobile) when a URL is configured — nothing more.
- Mobile app (Expo) gets book drop upload and admin review screens using the same API endpoints.

**Non-Goals:**

- Any Shelfmark API integration (search proxy, credentials, session management).
- Non-admin users approving or writing files to disk.
- Editing or deleting ebook files already in the library (existing data integrity rule).
- Converting between ebook formats.
- Bulk batch-approval of pending books (v1 is one-at-a-time).

## Decisions

### 1. Staging storage: drop folder as staging area

**Decision:** Uploaded files are written to `BOOK_DROP_PATH` (a separate Docker volume mount, fully independent from `EBOOK_LIBRARY_PATH`), not into the library. The drop folder watcher picks them up uniformly regardless of whether the file arrived via UI upload or an external tool placing files there directly. A single ingestion code path handles both.

`BOOK_DROP_PATH` defaults to `./book-drop` in docker-compose and must not overlap with `EBOOK_LIBRARY_PATH` to avoid the library scanner double-ingesting drop folder files.

**Alternatives considered:**

- Separate staging volume distinct from book drop: more explicit but doubles mount config for operators.
- In-memory/temp dir: files lost on restart before admin review.

### 2. Read-only detection: write probe at startup

**Decision:** A write probe (creating and immediately deleting a `.litara-write-probe` temp file) already exists in the codebase. `LibraryWriteService` will reuse/extend that existing probe rather than introduce a new mechanism. If the probe fails with `EROFS` or `EACCES`, an in-memory `isReadOnly` flag short-circuits all write operations with a clear error. The probe is re-run on each write attempt (mounts can change in theory).

**Alternatives considered:**

- `fs.access(path, fs.constants.W_OK)`: less reliable cross-platform; doesn't catch all Docker `:ro` cases.
- Env var flag: requires operator awareness; Docker `:ro` would still allow writes if the flag was wrong.

### 3. PendingBook database model

A new `PendingBook` Prisma model holds:

- `id`, `status` (`PENDING` | `APPROVED` | `REJECTED` | `COLLISION`)
- `stagedFilePath` — absolute path in the drop folder
- Extracted + admin-edited metadata fields (title, authors, series, etc.)
- `targetPath` — computed destination path (populated at approval time)
- `collidingPath` — path of the existing file if a collision is detected
- `overwriteApproved` — boolean, must be `true` before a collision file is written

**Rejection behavior:** When an admin rejects a pending book, the staged file is left on disk and the record is marked `status: REJECTED`. Cleanup of the drop folder is the operator's responsibility. No automatic deletion.

### 4. Path computation

Priority order for the destination path:

1. `<library-root>/<author>/<series>/<title>.<ext>` — when series is known
2. `<library-root>/<author>/<title>.<ext>` — when author is known, no series
3. `<library-root>/unknown/<title>.<ext>` — when title is known, no author
4. `<library-root>/unknown/<original-filename>` — when no metadata at all

**Multi-author:** When a book has multiple authors, only the first author is used for the folder name, keeping paths short.

Author and series names are sanitized (strip illegal filesystem chars, collapse whitespace, normalize Unicode to NFC, truncate path segments to 200 chars).

### 5. Collision handling

Before writing, `LibraryWriteService` checks if the computed `targetPath` exists on disk. If yes:

- `PendingBook.status` → `COLLISION`, `collidingPath` populated.
- Admin sees a warning in the review UI (web + mobile) with details of both the existing and incoming file.
- Admin must click a separate "Approve Overwrite" action; only then is `overwriteApproved = true` and the write proceeds.
- `LibraryWriteService` re-checks existence at write time and returns a clear error if the file has since been removed externally.

### 6. Shelfmark: external link only

**Decision:** Store only `shelfmarkUrl` (a plain string) in `ServerSettings`. No credentials, no API proxy, no search. When set, both web and mobile navigation render a "Shelfmark" item with an external-link icon. Web opens a new tab (`target="_blank"`); mobile uses `Linking.openURL`.

**Rationale:** Keeps Litara simple and avoids coupling to Shelfmark's API internals. Users source books in Shelfmark independently and drop them into the book drop folder.

### 7. Drop folder scanning: chokidar (consistent with library scanner)

The existing `LibraryScannerService` uses chokidar for continuous watching. The drop folder uses a second chokidar watcher instance scoped to `BOOK_DROP_PATH`. On `add` events, the file is SHA-256 hashed and a `PendingBook` record created (if not already present by hash). This is preferable to polling for consistency and responsiveness.

### 8. Mobile (Expo)

The mobile app reuses the same `/api/v1/book-drop` endpoints. New screens:

- **Book Drop** — `expo-document-picker` to select a local ebook file, upload to `POST /api/v1/book-drop/upload`.
- **Admin Book Review** — list of pending books with approve/reject actions; collision warning shown inline. Visible only to admin users.
- **Shelfmark nav link** — appears in navigation when `shelfmarkUrl` is configured; tapping opens the external URL via `Linking.openURL`.

## Risks / Trade-offs

- **Large file uploads blocking the API process** → Mitigation: use streaming multipart (`multer` with `diskStorage` writing directly to `BOOK_DROP_PATH`); never buffer entire file in memory.
- **Drop folder and library on same volume** → Mitigation: documented requirement that `BOOK_DROP_PATH` must be a separate mount; library scanner excludes `BOOK_DROP_PATH`.
- **Path sanitization edge cases** (Unicode authors, very long names) → Mitigation: truncate segments to 200 chars, normalize Unicode NFC, strip control characters.
- **Admin approves overwrite then file is deleted externally** → Mitigation: `LibraryWriteService` re-checks existence at write time and returns a clear error.

## Migration Plan

1. Add Prisma migration: new `PendingBook` model + `ServerSettings` new fields (`libraryWriteEnabled`, `shelfmarkUrl`).
2. Add `BOOK_DROP_PATH` volume mount to `docker-compose.yml` (default: `./book-drop`).
3. Deploy backend changes (additive — no existing endpoints modified).
4. Deploy web frontend changes (admin review page only visible to admins).
5. Release mobile app update with new Book Drop and Admin Review screens.
6. **Rollback**: revert Prisma migration; remove new endpoints and screens. No existing library data is affected.

## Open Questions

- **Drop folder file cleanup UI**: Should there be a way for admins to bulk-clear `REJECTED` records from the review queue? Not in scope for v1 but worth tracking.
