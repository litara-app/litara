## 1. Schema and migration

- [x] 1.1 Edit `apps/api/prisma/schema.prisma`: drop `Library.userId` and the `User.libraries` relation; add `path String @unique`, `iconKey String?`, `metadataFieldOverrides Json?`, `metadataProvidersDisabled String[] @default([])`, `lastScanAt DateTime?`
- [x] 1.2 Edit `apps/api/prisma/schema.prisma`: add `Book.isOrphan Boolean @default(false)`
- [x] 1.3 Edit `apps/api/prisma/schema.prisma`: add `PendingBook.targetLibraryId String?` with FK to `Library`
- [x] 1.4 Edit `apps/api/prisma/schema.prisma`: remove the `UserBookLibrary` model and the `WatchedFolder` model
- [x] 1.5 Create migration `apps/api/prisma/migrations/<timestamp>_add_filesystem_libraries/migration.sql` with raw SQL in this order: (a) insert one `Shelf` per existing `(userId, library)`, (b) insert `BookShelf` rows for every `UserBookLibrary` row using the new shelf ids, (c) drop `UserBookLibrary` and `WatchedFolder` tables, (d) drop `Library.userId` column and FK, (e) add the new `Library` columns, (f) `TRUNCATE TABLE "Library"`, (g) add `Book.isOrphan` and `PendingBook.targetLibraryId` with FK
- [x] 1.6 Run `npx prisma generate` and `npx prisma migrate dev --name add_filesystem_libraries` against a seeded local DB; verify shelves were created and `UserBookLibrary` is gone
- [x] 1.7 Update `apps/api/src/library/library-scanner.service.ts` `onModuleInit` to run a one-shot orphan-evaluation pass: for every existing Book, set `isOrphan = true` and `libraryId = null` if its first BookFile path is not inside any library's `path`

## 2. Backend: Libraries module

- [x] 2.1 Update `apps/api/src/libraries/library.dto.ts` to expose `path`, `iconKey`, `metadataFieldOverrides`, `metadataProvidersDisabled`, `lastScanAt` and Swagger decorators (no `'object'` types)
- [x] 2.2 Add create/update DTOs accepting the same fields with `class-validator` rules (path required absolute string on create)
- [x] 2.3 Update `apps/api/src/libraries/libraries.service.ts`: remove the `userId` filter from `findAll` / `findOne`; remove `userId` from `create` / `update` / `remove`; add path validation helper (absolute, exists, inside `EBOOK_LIBRARY_PATH`, no duplicate, no ancestor/descendant overlap)
- [x] 2.4 Add `LibrariesService.triggerScan(libraryId)` that calls `LibraryScannerService.triggerLibraryScan(libraryId)` and returns `{taskId}`
- [x] 2.5 Update `apps/api/src/libraries/libraries.controller.ts`: add `@UseGuards(JwtAuthGuard, AdminGuard)` on POST/PATCH/DELETE; add `POST /libraries/:id/scan` admin-only; keep `@UseGuards(JwtAuthGuard)` on GET endpoints
- [x] 2.6 Add `@ApiBearerAuth()` on all guarded endpoints and verify Swagger types after `npm run build`

## 3. Backend: Scanner refactor

- [x] 3.1 Refactor `apps/api/src/library/library-scanner.service.ts`: remove the implicit `WatchedFolder` bootstrap; load all `Library` rows on init and register one chokidar watcher per `library.path` (excluding `BOOK_DROP_PATH`)
- [x] 3.2 Add `LibraryScannerService.triggerLibraryScan(libraryId, opts)` that creates a Task of type `LIBRARY_SCAN`, scans `library.path` via `fast-glob`, ingests each file, updates `processed` / `total` / `currentFile` every N files, and sets `library.lastScanAt` on completion
- [x] 3.3 Refactor `triggerFullScanTask` to iterate every library and call `triggerLibraryScan` per library, aggregating progress into one Task
- [x] 3.4 Update `LibraryScannerService.handleFileAdded` to derive `libraryId` by longest-prefix match against all known library paths; set `isOrphan = true` when no match
- [x] 3.5 Expose `LibraryScannerService.registerWatcher(library)` and `closeWatcher(libraryId)`; call these from `LibrariesService` on create/delete so watcher set stays in sync
- [x] 3.6 Update `apps/api/src/library/library.controller.ts`: `POST /library/scan` accepts `libraryId` (defaults `all`) and `rescanMetadata`; add `AdminGuard`

## 4. Backend: Metadata config

- [x] 4.1 Add `MetadataService.resolveFieldConfig(libraryId?)` that merges global field config with `Library.metadataFieldOverrides` (overrides win per-field) and filters out providers in `Library.metadataProvidersDisabled`
- [x] 4.2 Update every caller of the global field config (`bulk-metadata.service.ts`, `book-drop.service.ts` enrich path, scanner metadata extraction) to accept a `libraryId?` and route through the resolver
- [x] 4.3 In `bulk-metadata.service.ts`, add `scope: 'library'` handling: when set, filter the candidate book set to `where: { libraryId: scopeId }` and pass `scopeId` into the resolver

## 5. Backend: Book drop routing

- [x] 5.1 Update `apps/api/src/book-drop/book-drop.controller.ts` `PATCH /book-drop/:id` to accept `targetLibraryId`; persist via the service
- [x] 5.2 Update `apps/api/src/library/library-write.service.ts` `approvePendingBook` and `approveOverwrite` to require `targetLibraryId`, look up the library, and compute the disk path as `{library.path}/{author}/{series}/{title}.{ext}`; set `Book.libraryId = targetLibraryId` and `isOrphan = false`
- [x] 5.3 Update `POST /book-drop/approve-all` to reject (HTTP 400) if any pending book lacks `targetLibraryId`

## 6. Backend: Folder browser

- [x] 6.1 Create `apps/api/src/admin/folders/folders.controller.ts` exposing `GET /admin/folders?path=<relative>` (admin-only)
- [x] 6.2 Create `apps/api/src/admin/folders/folders.service.ts` that resolves `{EBOOK_LIBRARY_PATH}/{path}`, follows symlinks, rejects any resolved path outside the root (HTTP 400), returns 404 on missing/non-directory, otherwise returns `[{name, relPath, hasChildren}]`
- [x] 6.3 Register the new controller/service in `AdminModule`

## 7. Backend: Orphan books

- [x] 7.1 Add `GET /admin/books/orphans` (admin-only, paginated) returning orphan books with their first file path
- [x] 7.2 Add `PATCH /admin/books/:id/reassign-library` (admin-only) accepting `{libraryId}`; move the file via existing `LibraryWriteService` helpers, update `Book.libraryId`, set `isOrphan = false`; return HTTP 404 if library not found

## 8. Backend: Setup wizard

- [x] 8.1 Add a `POST /setup/first-library` endpoint (or extend `POST /setup`) that creates a library + triggers an initial scan; runs only while setup is required
- [x] 8.2 Update `setup.service.ts` so `GET /setup/status` continues to gate on user count; first-library step is optional (skippable)

## 9. Frontend: Atoms and types

- [x] 9.1 Update `apps/web/src/store/atoms.ts`: extend `Library` interface with `path`, `iconKey`, `metadataFieldOverrides`, `metadataProvidersDisabled`, `lastScanAt`
- [x] 9.2 Add `activeScanTasksAtom: atom<Record<libraryId, taskId>>` for navbar + library page scan indicators

## 10. Frontend: Library creation flow

- [x] 10.1 Create `apps/web/src/components/FolderBrowserModal.tsx`: calls `GET /admin/folders?path=...`, click-to-drill, breadcrumb back; returns selected relative path
- [x] 10.2 Create `apps/web/src/components/LibraryForm.tsx`: name input, Tabler icon picker, FolderBrowserModal trigger, MetadataSourcesSection in per-library mode (each provider toggle has an "inherit global" state), per-field provider picker reused from `MetadataMatchingPage.tsx` with "Inherit global" option
- [x] 10.3 Create `apps/web/src/pages/LibraryCreatePage.tsx` at route `/libraries/new`: renders `LibraryForm`, on submit calls `POST /libraries`, then `POST /libraries/:id/scan`, then routes to `/libraries/:id` with the task id in navigation state
- [x] 10.4 Register the new route in the app router
- [x] 10.5 Update `apps/web/src/components/AppLayout/NavbarContent.tsx`: replace the inline "Add Library" input (line 59-87) with a button that routes to `/libraries/new`; render each library's `iconKey`; hide the button for non-admins

## 11. Frontend: Library page updates

- [x] 11.1 In `apps/web/src/pages/LibraryPage.tsx`, add a "Rescan" button in the page header that calls `POST /libraries/:id/scan` and stores the returned task id in `activeScanTasksAtom`
- [x] 11.2 Add a polling effect: while a task id is set for this library, poll `GET /admin/tasks/:taskId` every 2s and re-fetch books when `processed` crosses a 1000-book batch boundary
- [x] 11.3 Replace the settings modal contents (line 310-362) with `<LibraryForm initialValues={library} mode="edit" />` so name, icon, path (read-only), and metadata config are all editable

## 12. Frontend: Book detail page

- [x] 12.1 Remove the library `Select` (line 832-887), the inline create-library modal (line 848-887), and the `PATCH /books/:id { libraryId }` call (line 370) from `apps/web/src/pages/BookDetailPage.tsx`
- [x] 12.2 Replace with a read-only label linking to `/libraries/:id`

## 13. Frontend: Pending review

- [x] 13.1 In `apps/web/src/pages/AdminBookReviewPage.tsx`, add a page-level Target Library `Select` (default for all cards) and a per-card Target Library `Select` on `PendingBookCard`
- [x] 13.2 Disable each card's "Write to Disk" button until a target library is chosen (per-card OR page default)
- [x] 13.3 On change, call `PATCH /book-drop/:id { targetLibraryId }`; pass through to approve / approve-all flows

## 14. Frontend: Admin general tab

- [x] 14.1 In `apps/web/src/pages/admin/GeneralTab.tsx`, rename "Force Full Scan" to "Force Scan" (line 688); add a Library `Select` next to it (default "All libraries"); submit calls `POST /library/scan?libraryId=<id|all>&rescanMetadata=...`
- [ ] 14.2 On the bulk enrichment trigger, add the same Library `Select`; submit posts `scope: 'library', scopeId: <id>` (or omit when "All libraries")

## 15. Frontend: Library filters on related pages

- [x] 15.1 Add a library multi-select to `apps/web/src/pages/SeriesPage.tsx`; backend: extend `GET /series` to accept `libraryId[]` or filter client-side
- [x] 15.2 Add a library multi-select to `apps/web/src/pages/AuthorsPage.tsx`; backend: extend `GET /authors` to accept `libraryId[]`
- [x] 15.3 Add a library multi-select to `apps/web/src/pages/AnnotationsPage.tsx`; backend: extend `GET /annotations` to accept `libraryId[]`

## 16. Frontend: Dashboard

- [x] 16.1 In `apps/web/src/components/DashboardSettingsModal.tsx`, add a per-section "Libraries" multi-select for the Recently Added section; persist into `userSettings.dashboardLayout`
- [x] 16.2 In `apps/web/src/pages/Dashboard.tsx`, change the Recently Added fetch to include `libraryId[]=...` based on the section's saved selection

## 17. Frontend: Setup wizard

- [x] 17.1 Add a "First Library" step to `apps/web/src/pages/SetupPage.tsx` between "Admin Account" and "Metadata"; reuse `LibraryForm` rooted at `EBOOK_LIBRARY_PATH`
- [x] 17.2 On submit, create the library and kick off `POST /libraries/:id/scan`; allow skipping the step

## 18. Mobile

- [x] 18.1 Update `apps/mobile/src/api/libraries.ts` types to include the new `Library` fields (`path`, `iconKey`)
- [x] 18.2 Remove the library-change UI from `apps/mobile/src/components/LibraryShelfPickerContent.tsx` and `apps/mobile/src/components/BookOptionsSheet.tsx`; keep the Shelves tab

## 19. Build, tests, verification

- [x] 19.1 Run `npm run build` at the repo root; fix TypeScript and Swagger errors
- [x] 19.2 Run `npm --workspace apps/api run test` and `npm --workspace apps/api run test:e2e`
- [ ] 19.3 Manual verification per the plan's verification checklist (`C:\Users\deran\.claude\plans\we-are-changing-how-enchanted-lampson.md`): fresh DB, setup wizard, file-drop appears in matching library within 5s, orphan handling, library CRUD permissions, force scan scope, bulk enrichment scope, filter pages, dashboard, migration produces correct shelves, mobile loads new library shape
