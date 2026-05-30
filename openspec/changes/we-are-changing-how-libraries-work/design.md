## Context

Litara's current `Library` model is a per-user organizational tag (`Library.userId` FK to `User`), and the scanner uses a single global `WatchedFolder` rooted at `EBOOK_LIBRARY_PATH`. Every ingested file ends up with `libraryId: null`, and books are associated to libraries through the `UserBookLibrary` join table. As a result:

- Two users can have completely different libraries pointing at no place in particular.
- The book-drop / pending-review flow approves files to disk but cannot route them into a specific library folder.
- Metadata source preferences (which provider supplies which field) are global, so users cannot say "this library is audiobooks, prefer Audnexus" or "this library is ebooks, never call Audnexus".
- Scanning is all-or-nothing. There's no per-library rescan and no per-library progress indicator.
- The mental model for users is muddled: a "library" with no fixed location on disk doesn't match what the word implies.

This design switches `Library` to a globally-shared, admin-managed, filesystem-tied entity. `EBOOK_LIBRARY_PATH` is repurposed from "the watched folder" to "the root under which all library folders live." Existing per-user `Library` rows are preserved by converting each into a per-user `Shelf` (which is already user-scoped and has the same role as a "personal tag").

The new model unifies organization and ingestion: a book exists in exactly one library by virtue of its file path. Shelves (still per-user) carry forward all subjective grouping.

## Goals / Non-Goals

**Goals:**

- Make `Library` filesystem-tied: every library has a unique `path` that must live under `EBOOK_LIBRARY_PATH`, and a book's `libraryId` is fully derivable from where its file sits on disk.
- Make `Library` global and admin-managed; remove user scoping entirely.
- Preserve all existing organizational intent by migrating today's per-user libraries to per-user shelves.
- Enable per-library metadata configuration (overriding the global field→provider map and disabling specific providers per library) without forcing admins to re-configure everything per library.
- Enable per-library scans with a task-backed progress signal that the library page can poll to refresh book listings live.
- Route approved pending books into the correct library folder on disk.
- Add a library multi-select filter to Series, Authors, Annotations, and the dashboard's Recently Added section without rebuilding their existing UIs.
- Ship a folder-browser endpoint and UI so admins don't have to type absolute paths.
- Insert a "First Library" step into the setup wizard so fresh installs end with at least one library defined.

**Non-Goals:**

- Real-time push (SSE / WebSocket) for scan progress. The existing `Task` poll pattern is sufficient.
- Per-library user-level permissions (who can view which library). Out of scope.
- Backfilling the full `BookFilterPanel` (genres, tags, moods, etc.) onto Series / Authors / Annotations pages. Those pages get only a library multi-select.
- Reworking the shelves UI beyond accepting migrated rows.
- Changing the disk layout convention `{author}/{series}/{title}.{ext}` produced by `LibraryWriteService`; only the root prefix changes (from `EBOOK_LIBRARY_PATH` to `library.path`).
- Audiobook-scanner refactor beyond making it library-aware on the same code path.

## Decisions

### Library is global, not user-scoped

`Library.userId` is dropped along with the `User.libraries` relation. All authenticated users see the same set of libraries.

**Why:** A library tied to a folder on a shared server is shared. Per-user libraries pointing at the same path would be redundant and confusing.
**Alternative considered:** Keep per-user libraries with an optional `userId`. Rejected — it duplicates the role of shelves (which are already per-user) and makes "what does this folder belong to" ambiguous.

### Library mutation is admin-only

`POST/PATCH/DELETE /libraries` and `POST /libraries/:id/scan` are guarded by `JwtAuthGuard + AdminGuard`. `GET` endpoints remain open to any authenticated user.

**Why:** Library definitions affect every user and touch filesystem state. Admin-only matches the "global, filesystem-tied" semantics.
**Alternative considered:** Any authenticated user can create libraries. Rejected — non-admins shouldn't be able to declare new directories as libraries on a shared server.

### Library folders must live under EBOOK_LIBRARY_PATH

The library `path` field is validated on create/update: must be absolute, must resolve to a directory inside `EBOOK_LIBRARY_PATH`, must not equal an existing library path, must not be an ancestor or descendant of an existing library path.

**Why:** Constrains attack surface for the folder-browser endpoint (no arbitrary filesystem traversal), keeps the file layout predictable, and matches the use case the user described ("`EBOOK_LIBRARY_PATH/ebooks/`, `EBOOK_LIBRARY_PATH/audiobooks/`").
**Alternative considered:** Allow any readable path. Rejected — broader filesystem exposure via the browser API and harder to validate.

### Per-library metadata config is override-with-fallback

`Library.metadataFieldOverrides` is a sparse `{field: providerId}` map; only fields the admin explicitly overrode are stored. The new `MetadataService.resolveFieldConfig(libraryId?)` merges the global field config with the library's overrides (overrides win per-field) and then filters the result by `Library.metadataProvidersDisabled`.

**Why:** Admins typically want one or two adjustments per library, not a full re-mapping. Inheritance keeps new libraries easy to set up and lets a global change (e.g., new provider) propagate to libraries that didn't opt out.
**Alternative considered:** Each library carries a full standalone field config. Rejected — more upfront configuration per library, more drift over time.

### Scanning is per-library, task-backed, poll-driven

The scanner registers one chokidar watcher per library path and exposes `triggerLibraryScan(libraryId, opts)`. The existing `triggerFullScanTask` becomes a thin loop that calls the per-library version. The frontend polls `GET /admin/tasks/:id` every 2s while a scan is active and re-fetches book pages as `processed` advances.

**Why:** Polling reuses the exact pattern already used for bulk metadata; no new infrastructure. The latency (≤ 2s for new books to appear on the page) is fine for a scan UX.
**Alternatives considered:**

- SSE — adds a one-way streaming endpoint and connection lifecycle handling. Defensible but not needed for the latency budget.
- WebSockets — adds bidirectional channel, auth handshake, reconnect logic. Overkill for one-way progress.

### Existing libraries migrate to per-owner shelves

For every existing `Library`, insert one `Shelf` per `userId` with the same `name`. Move `UserBookLibrary` rows into `BookShelf` rows linking each user's books to the new shelf. Then drop `UserBookLibrary` and clear `Library`.

**Why:** Shelves are already user-scoped, already support arbitrary per-user grouping, and already have a many-to-many book join. They are the natural home for "this user's notion of `Library X`". Nothing is lost.
**Alternative considered:** Drop existing library data entirely. Rejected — destroys organizational metadata for no reason.

### Books outside any library are flagged orphan, not deleted

The scanner sets `Book.isOrphan = true` when a file's path is not under any `Library.path`. Orphans remain visible in `All Books`. A new admin endpoint lists orphans and reassigns them (moving the file into the chosen library's folder via `LibraryWriteService`, then setting `libraryId` and clearing `isOrphan`).

**Why:** Non-destructive. Books retain user metadata (ratings, shelves, reading progress, annotations). Admins can clean up incrementally.
**Alternative considered:** Hide or delete orphans on migration. Rejected — destructive and would frustrate users with pre-existing libraries that don't align with the new folder layout.

### Pending books require a target library before approval

`PendingBook.targetLibraryId` (nullable in DB but required at approval time). The approval flow refuses to write to disk without one and computes the destination as `{library.path}/{author}/{series}/{title}.{ext}` using the existing `LibraryWriteService` path builder.

**Why:** Pending review is the only place admins explicitly route a file. Forcing the choice at approval time is the simplest invariant and matches the new "library = folder" model.

### Folder-browser endpoint, not an OS file picker

`GET /admin/folders?path=<relative>` returns immediate child directories of `{EBOOK_LIBRARY_PATH}/{path}`. Resolves symlinks and rejects any resolved path that escapes the root. Returns `[{name, relPath, hasChildren}]` so the UI can render a click-to-drill tree.

**Why:** Admins use a browser; the server has filesystem access; this is the simplest cross-platform UI for picking folders. Constraining to `EBOOK_LIBRARY_PATH` keeps the surface tight.

### Library content type is implicit, not a declared enum

There is no `type: 'ebook' | 'audiobook'` column. Instead, `metadataProvidersDisabled` lets admins exclude Audnexus from an ebook library (or any other audio provider). The scanner ingests every supported format inside a library regardless.

**Why:** The original request specifically mentioned "disable audiobook sources for that library if no audiobooks in it" — this is metadata config, not a type system. Avoids modeling questions like "what if a library has both?"

## Risks / Trade-offs

- **Risk:** Existing deployments will see books appear as orphans after migration if pre-existing books were dropped directly at `EBOOK_LIBRARY_PATH` root → **Mitigation:** Orphan flag + reassignment endpoint + clear release-note guidance ("define at least one library covering your existing folders before upgrading, or use the orphan reassignment tool after").
- **Risk:** Two users could disagree about a library's name or icon (it's now global) → **Mitigation:** Admin-only mutation. Non-admin users see the admin's chosen names.
- **Risk:** Folder-browser endpoint could be abused for filesystem reconnaissance → **Mitigation:** AdminGuard, hard root at `EBOOK_LIBRARY_PATH`, resolve symlinks and reject any path that doesn't stay inside the root.
- **Risk:** Per-library scan watchers multiply chokidar processes → **Mitigation:** Cap at one watcher per `Library` row; libraries are admin-created and small in number. Watchers are cleaned up on library delete.
- **Risk:** Scan-progress polling causes load with many concurrent admins on a library page → **Mitigation:** Poll only when a task is active; 2s interval; only re-fetch books when `processed` crosses a batch boundary.
- **Risk:** Migration data step is irreversible (drops `UserBookLibrary`, clears `Library`) → **Mitigation:** It runs once via Prisma migrate; users should back up their DB first per project convention.
- **Trade-off:** Removing the book-detail "change library" control is a visible UX loss, but it follows directly from filesystem-tied semantics. Moving a book between libraries now means moving the file on disk (admin action via the orphan reassignment endpoint, or external file move + rescan).
- **Trade-off:** Per-library metadata overrides add a configuration surface that admins must understand. Mitigated by the "inherit global" default per field.

## Migration Plan

1. **Schema + data migration** (`apps/api/prisma/migrations/<timestamp>_add_filesystem_libraries`):
   1. For every `Library`, insert a `Shelf` with the same `name` and the library's `userId`.
   2. Move every `UserBookLibrary(userId, bookId, libraryId)` into `BookShelf(shelfId, bookId)` using the shelf inserted in step 1.
   3. Drop `UserBookLibrary` and `WatchedFolder` tables.
   4. Drop `Library.userId` FK and column.
   5. Add `Library.path` (unique), `iconKey`, `metadataFieldOverrides`, `metadataProvidersDisabled`, `lastScanAt`.
   6. Truncate `Library` (existing rows already migrated to shelves).
   7. Add `Book.isOrphan` (default false), `PendingBook.targetLibraryId`.
2. **First boot after migration:**
   - The scanner finds zero libraries and skips startup scanning.
   - All existing books with non-null file paths get a one-shot orphan-evaluation pass: any book whose `BookFile.path` is not inside an existing library is set `isOrphan = true` and `libraryId = null`.
3. **Admin action (post-deploy):**
   - Setup wizard's new "First Library" step (for fresh installs) or existing admin manually creates libraries via `POST /libraries`.
   - Admins can call `POST /libraries/:id/scan` to populate library book counts; the scanner will also pick up existing books on disk by file-hash match (no duplicates created).
4. **Rollback:** Restore DB backup. The migration is intentionally irreversible because it consolidates `UserBookLibrary` into `BookShelf`.

## Open Questions

- None. All seven open design questions raised during planning were resolved before drafting:
  1. Library scope → global
  2. Mutation gating → admin only
  3. Scan progress transport → poll the Task record
  4. Path constraint → must be under `EBOOK_LIBRARY_PATH`
  5. Metadata config inheritance → override-with-fallback
  6. Existing library data → migrate to per-owner shelves
  7. Orphan books → flag + admin reassignment endpoint
