## Why

Litara currently only discovers books by scanning pre-existing library folders, giving users no in-app way to add new books to their collection. This change introduces a book drop flow so users can bring files into Litara, with a lightweight Shelfmark link for users who use that tool to source books.

## What Changes

- **Book Drop**: A dedicated upload/drop zone (web UI + mobile) where users can submit ebook files (.epub, .mobi, .azw, .azw3, .cbz, .pdf). Files land in a staging area, metadata is extracted automatically, users can enrich it from configured external sources, and an admin then approves writing the file to disk.
- **Book Drop Folder**: A second Docker Compose mount (`BOOK_DROP_PATH`) that Litara watches with chokidar. Any file placed there is automatically ingested into the same admin review queue.
- **Admin Book Review Queue**: A new admin-only section (web + mobile) listing all pending ingested books. Admins can enrich metadata, then approve writing to disk. On approval, the file is placed at a computed path (`author/series/title.ext` or `author/title.ext` or `unknown/title.ext`).
- **Name Collision Detection**: Before writing any file to disk, the system checks for an existing file at the target path. If a collision is detected, the admin must explicitly approve overwriting it — surfaced in both web and mobile admin review.
- **Library Write Guard**: All disk writes are gated on the library volume not being mounted read-only (detected at runtime via write probe) and an admin-controlled "allow writes" toggle in server settings.
- **Shelfmark Link**: Admin can optionally enter a Shelfmark URL in server settings. If configured, a link to the Shelfmark instance appears in the left navigation bar (web + mobile) with an external-link icon, opening in a new tab/browser. No Shelfmark API integration — it is a simple hyperlink.
- **Mobile App (Expo)**: The existing `apps/mobile` Expo app gains a file picker upload screen (book drop), an admin book review screen, and the Shelfmark external link in navigation.

## Capabilities

### New Capabilities

- `book-drop-upload`: Web UI, mobile file picker, and API for users to submit ebook files into a staging/review queue, with automatic metadata extraction and optional external metadata enrichment.
- `book-drop-folder`: Background watcher on a configured drop folder mount; detected files are routed into the admin review queue automatically.
- `admin-book-review`: Admin UI (web + mobile) and API for reviewing pending ingested books, enriching metadata, resolving name collisions, and approving/rejecting writes to the library.
- `library-write`: Backend service that computes target file paths and writes approved books to disk, enforcing read-only guards and surfacing collision prompts.
- `shelfmark-integration`: Admin-configurable Shelfmark URL stored in server settings; rendered as an external navigation link (web + mobile) when configured.

### Modified Capabilities

- `smtp-config`: Server settings page gains a Shelfmark URL field and a library write-enable toggle (only shown/usable when the volume is not mounted `:ro`) — spec-level additions to the settings capability.

## Impact

- **API**: New endpoints under `/api/v1/book-drop` (upload, list pending, approve, reject). New `GET /PUT /api/v1/settings/shelfmark` for URL only. New `GET/PUT /api/v1/settings/library` for write toggle.
- **Backend modules**: New `BookDropModule`, `LibraryWriteService`; extension of `ServerSettingsModule`.
- **Database**: New `PendingBook` model (staging metadata + file path + status); `ServerSettings` gains `libraryWriteEnabled` and `shelfmarkUrl`.
- **Docker Compose**: New `BOOK_DROP_PATH` volume mount and env var.
- **Web frontend**: New admin "Book Review" route; book drop upload component; collision approval dialog; Shelfmark external nav link.
- **Mobile (`apps/mobile`)**: New screens — file picker upload (book drop) and admin book review (approve/reject/collision); Shelfmark external link in navigation.
- **Dependencies**: `multer` for file uploads; `expo-document-picker` for mobile file selection.
