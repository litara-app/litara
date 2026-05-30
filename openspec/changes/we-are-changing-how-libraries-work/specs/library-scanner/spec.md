## ADDED Requirements

### Requirement: Per-library file watchers

The scanner SHALL register one chokidar watcher per existing library, rooted at `library.path`, on application startup and when libraries are created or deleted. Each watcher SHALL exclude `BOOK_DROP_PATH` if configured.

#### Scenario: Watcher created on library create

- **WHEN** an admin creates a new library
- **THEN** the scanner registers a chokidar watcher rooted at the library's path

#### Scenario: Watcher removed on library delete

- **WHEN** an admin deletes a library
- **THEN** the scanner closes the chokidar watcher rooted at that library's path

#### Scenario: New file under a library is ingested

- **GIVEN** a library exists with `path = /books/ebooks`
- **WHEN** a new `.epub` file is added at `/books/ebooks/Asimov/Foundation.epub`
- **THEN** the scanner creates a Book with `libraryId` referencing that library within 5 seconds

### Requirement: Per-library scan endpoint and task

The system SHALL expose `POST /libraries/:id/scan` (admin-only) that creates a `Task` of type `LIBRARY_SCAN`, scans only the given library's path, and returns `{taskId}`. The task's payload SHALL include `processed`, `total`, and `currentFile` and SHALL be updated as files are processed.

#### Scenario: Admin triggers a library scan

- **WHEN** an admin sends `POST /libraries/:id/scan` for a library containing 50 files
- **THEN** the response is HTTP 200 with `{taskId: <uuid>}` and a Task record with `status = PENDING` exists for that library

#### Scenario: Task payload reflects progress

- **GIVEN** a `LIBRARY_SCAN` task is running
- **WHEN** the scanner has processed 10 of 50 files
- **THEN** `GET /admin/tasks/:taskId` returns payload with `processed = 10`, `total = 50`, and the current filename

#### Scenario: Task completes and updates lastScanAt

- **WHEN** a `LIBRARY_SCAN` task finishes successfully
- **THEN** the task status becomes `COMPLETED` and the library's `lastScanAt` is updated

### Requirement: Force Scan supports per-library and all-libraries modes

`POST /library/scan` SHALL accept `libraryId` (a library id or the string `all`, defaulting to `all`) and `rescanMetadata` (boolean). When `libraryId = all`, the scanner SHALL iterate every library sequentially and emit a single Task tracking the aggregate. The endpoint SHALL be admin-only.

#### Scenario: Default Force Scan covers all libraries

- **WHEN** an admin sends `POST /library/scan`
- **THEN** the scanner scans every library's path

#### Scenario: Force Scan can target one library

- **WHEN** an admin sends `POST /library/scan?libraryId=<id>`
- **THEN** the scanner scans only that library

#### Scenario: Non-admin cannot force a scan

- **WHEN** a non-admin user sends `POST /library/scan`
- **THEN** the system returns HTTP 403

### Requirement: Bulk enrichment supports library scope

`POST /admin/metadata-match/run` SHALL accept `scope: 'library'` with `scopeId` set to a library id, and SHALL only enrich books whose `libraryId` matches `scopeId`. Resolution of per-field provider SHALL use the per-library metadata config.

#### Scenario: Library-scoped bulk enrichment ignores other libraries

- **GIVEN** library A has 30 books and library B has 20 books
- **WHEN** an admin starts a bulk run with `scope = 'library', scopeId = <A.id>`
- **THEN** only library A's books are enriched

### Requirement: Orphan flagging on ingest

When the scanner ingests a file whose path is not inside any library's `path`, it SHALL set `Book.libraryId = null` and `Book.isOrphan = true`. On every full scan, the scanner SHALL recompute orphan status for all books (so books become un-orphaned automatically when a new library covers their folder).

#### Scenario: New file outside any library is flagged orphan

- **GIVEN** libraries cover `/books/ebooks` only
- **WHEN** a new file appears at `/books/misc/loose.epub`
- **THEN** the resulting Book has `isOrphan = true` and `libraryId = null`

#### Scenario: Creating a library un-orphans matching books

- **GIVEN** a book is orphan with file path `/books/audiobooks/sample.m4b`
- **WHEN** an admin creates a library with `path = /books/audiobooks` and triggers a scan
- **THEN** the book's `isOrphan = false` and `libraryId` references the new library
