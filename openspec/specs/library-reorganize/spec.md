## ADDED Requirements

### Requirement: Admin can trigger library reorganization

The system SHALL provide a `POST /api/v1/admin/library/reorganize` endpoint, accessible only to authenticated admins, that enqueues a background Task of type `LIBRARY_REORGANIZE` and returns `{ taskId: string }`.

#### Scenario: Reorganize task is created

- **WHEN** an admin sends `POST /admin/library/reorganize` with disk writes enabled and the volume writable
- **THEN** the system creates a Task with `status: PENDING` and returns `{ taskId }` with HTTP 202

#### Scenario: Blocked when disk writes disabled

- **WHEN** an admin sends `POST /admin/library/reorganize` and `allowDiskWrites` is `false` in server settings
- **THEN** the system returns HTTP 403 without creating a task

#### Scenario: Blocked when volume is read-only

- **WHEN** an admin sends `POST /admin/library/reorganize` and the library volume is mounted read-only
- **THEN** the system returns HTTP 403 without creating a task

---

### Requirement: Reorganize task moves files to canonical paths

The background task SHALL iterate all `BookFile` records (excluding those with `missingAt` set) and for each file compute the canonical path using the same logic as `LibraryWriteService.computeTargetPath`. Files already at their canonical path SHALL be skipped.

#### Scenario: File at non-canonical path is moved

- **WHEN** a `BookFile` has `filePath` that differs from the canonical path computed from its book's authors/series/title
- **THEN** the system moves the file to the canonical path, updates `BookFile.filePath` in the database, and logs `[move] <old> → <new>`

#### Scenario: File already at canonical path is skipped

- **WHEN** a `BookFile.filePath` already equals the canonical path
- **THEN** the system skips the file and logs `[skip] <path>: already at canonical location`

#### Scenario: Collision with a different file

- **WHEN** the canonical target path already exists on disk and its content differs from the source file
- **THEN** the system skips the move and logs `[collision] <path>: target already exists`

#### Scenario: Collision with identical file (same hash)

- **WHEN** the canonical target path already exists on disk and its SHA-256 hash matches the source file
- **THEN** the system updates `BookFile.filePath` to the canonical path without moving and logs `[dedup] <path>: target is identical, updated DB path`

#### Scenario: Source file missing on disk

- **WHEN** a `BookFile` references a path that does not exist on disk
- **THEN** the system skips the file, logs `[skip] <path>: source file not found`, and does not update `missingAt`

#### Scenario: Move fails due to I/O error

- **WHEN** `fs.renameSync` and the copy fallback both fail for a file
- **THEN** the system logs `[error] <path>: <message>`, increments the failure counter, and continues processing remaining files

---

### Requirement: Reorganize task streams progress

The Task record SHALL be updated after every file with running counts for moved, skipped, collisions, and failed files, and a cumulative log string, so that the existing task log viewer can poll and display live progress.

#### Scenario: Task payload reflects progress mid-run

- **WHEN** the task is `PROCESSING` and 50 of 200 files have been processed
- **THEN** `Task.payload` contains `{ processed: 50, total: 200, moved, skipped, collisions, failed, log }`

#### Scenario: Task reaches COMPLETED

- **WHEN** all files have been processed without a fatal error
- **THEN** `Task.status` is set to `COMPLETED` and the final payload includes summary counts

#### Scenario: Task reaches FAILED on unexpected error

- **WHEN** an unexpected exception is thrown outside the per-file loop (e.g. DB connection lost)
- **THEN** `Task.status` is set to `FAILED` and `Task.errorMessage` contains the error message

---

### Requirement: Admin UI surfaces the reorganize action

The web admin page SHALL display a "Reorganize Library" button in the library management section. The button SHALL be disabled with an explanatory tooltip when disk writes are disabled or the volume is read-only. On success, the UI SHALL navigate to or display the running task log.

#### Scenario: Button enabled and functional

- **WHEN** `allowDiskWrites` is `true` and `isReadOnlyMount` is `false`
- **THEN** the "Reorganize Library" button is enabled and clicking it calls `POST /admin/library/reorganize`, then shows the task progress

#### Scenario: Button disabled — disk writes off

- **WHEN** `allowDiskWrites` is `false`
- **THEN** the "Reorganize Library" button is disabled with tooltip "Enable disk writes in settings to use this feature"

#### Scenario: Button disabled — read-only mount

- **WHEN** `isReadOnlyMount` is `true`
- **THEN** the "Reorganize Library" button is disabled with tooltip "Library volume is mounted read-only"

#### Scenario: Confirmation before running

- **WHEN** the admin clicks "Reorganize Library"
- **THEN** a confirmation dialog is shown explaining that files will be moved on disk before the task is started
