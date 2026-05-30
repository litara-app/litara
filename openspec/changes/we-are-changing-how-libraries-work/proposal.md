## Why

Today, "library" is a per-user organizational label with no relationship to disk layout — a single global `WatchedFolder` rooted at `EBOOK_LIBRARY_PATH` ingests every file into `libraryId: null`, and users manually re-tag books afterward. The word implies a place on disk; the data model treats it as a tag. This blocks every feature that should be library-scoped (filesystem routing of dropped books, per-library metadata tuning, per-library scans) and makes the admin experience confusing on a multi-user server.

## What Changes

- **BREAKING**: `Library` becomes **global** (not per-user) and **filesystem-tied**. `Library.userId` is dropped; `Library.path` (a subdirectory of `EBOOK_LIBRARY_PATH`) is added and required. `EBOOK_LIBRARY_PATH` is repurposed from "the one watched folder" to "the root under which all libraries live."
- **BREAKING**: Library create/update/delete and scan endpoints become **admin-only** (`AdminGuard`).
- **BREAKING**: Books can no longer change libraries from the book detail page — library is now derived from disk location.
- **BREAKING**: Pending book approval requires a `targetLibraryId`; the file is written to `{library.path}/{author}/{series}/{title}.{ext}`.
- **BREAKING**: Existing `Library` rows are migrated into per-owner `Shelf` rows (one shelf per `(userId, library)`); the `Library` table is then cleared and `UserBookLibrary` is dropped.
- Libraries gain `iconKey`, `metadataFieldOverrides` (sparse `{field: providerId}`), `metadataProvidersDisabled` (list of provider IDs), and `lastScanAt`.
- Scanner becomes per-library: one chokidar watcher per library path, one scan task per library, and a new `POST /libraries/:id/scan` endpoint. The existing "Force Full Scan" admin action becomes "Force Scan" with a library selector (defaulting to all).
- Bulk enrichment gains explicit `scope: 'library'` support so a single library can be re-enriched in isolation.
- Pending review UI exposes a Target Library selector per pending card and a bulk default at the page level.
- Series, Authors, Annotations, and Dashboard's Recently Added all gain a library multi-select filter.
- A new admin folder-browser endpoint (`GET /admin/folders?path=…`) lists directories under `EBOOK_LIBRARY_PATH` so the new library creation page doesn't require typing absolute paths.
- A new "First Library" step is inserted into the setup wizard so fresh deployments end with at least one library defined.
- Books that the scanner cannot place inside any library (sitting at the root of `EBOOK_LIBRARY_PATH` or in a folder no library covers) are flagged `isOrphan = true` and surfaced via a new admin reassignment endpoint.
- Mobile loses the ability to change a book's library (library is filesystem-tied); shelves remain unchanged.

## Capabilities

### New Capabilities

- `libraries`: Filesystem-tied, global, admin-managed library entities with paths, icons, and per-library metadata config; CRUD endpoints with `AdminGuard`.
- `library-scanner`: Per-library chokidar watchers, per-library scan tasks, library-aware ingest that derives `libraryId` by longest-prefix path match, and orphan flagging when no library covers a file.
- `folder-browser`: Admin-only endpoint that lists directories under `EBOOK_LIBRARY_PATH` (rejecting path traversal) so the library creation UI can pick folders without typing.
- `book-drop-routing`: Target-library selection on pending books, with approval writing the file into the chosen library's folder and creating the `Book` with the resolved `libraryId`.
- `orphan-books`: `isOrphan` flag on books outside any library and admin endpoints to list and reassign them (with file move).

### Modified Capabilities

<!-- None — existing specs don't cover the surfaces being changed. New capabilities above are introduced fresh. -->

## Impact

- **Schema**: `Library`, `Book`, `PendingBook` changes; `UserBookLibrary` and `WatchedFolder` dropped; one data + schema migration that converts existing libraries to shelves.
- **Backend**: `libraries/`, `library/` (scanner + write services), `book-drop/`, `bulk-metadata/`, `metadata/`, `admin/`, `setup/` modules touched.
- **Frontend**: New `LibraryCreatePage`, `LibraryForm`, `FolderBrowserModal` components; updates to `NavbarContent`, `LibraryPage`, `BookDetailPage`, `AdminBookReviewPage`, `GeneralTab`, `SeriesPage`, `AuthorsPage`, `AnnotationsPage`, `Dashboard`, `DashboardSettingsModal`, `SetupPage`.
- **Mobile**: Type updates for the new `Library` shape; library-reassignment UI removed from `LibraryShelfPickerContent` and `BookOptionsSheet`.
- **Env**: `EBOOK_LIBRARY_PATH` semantics change from "the one watched folder" to "the root under which libraries live". No new env vars.
- **Deployments**: Single migration run on next API boot; admins must define at least one library after upgrade or pre-existing books appear as orphans in All Books.
