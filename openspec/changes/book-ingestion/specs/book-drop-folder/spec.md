## ADDED Requirements

### Requirement: Litara watches the book drop folder for new files

The system SHALL maintain a chokidar watcher on `BOOK_DROP_PATH` (a Docker volume mount fully independent from `EBOOK_LIBRARY_PATH`). On any `add` event the system SHALL compute the file's SHA-256 hash and, if no `PendingBook` record already exists with that hash and `status: PENDING`, create a new `PendingBook` record with `status: PENDING` and extract available metadata from the file.

#### Scenario: New file appears in drop folder

- **WHEN** a supported ebook file is placed in `BOOK_DROP_PATH` by any means (manual copy, Shelfmark delivery, etc.)
- **THEN** the watcher detects the addition, hashes the file, creates a `PendingBook` record with `status: PENDING`, and extracts metadata from it

#### Scenario: Duplicate file placed in drop folder

- **WHEN** a file is placed in `BOOK_DROP_PATH` whose SHA-256 hash matches an existing `PendingBook` with `status: PENDING`
- **THEN** the system skips creation and does not produce a duplicate `PendingBook` record

#### Scenario: Unsupported file format placed in drop folder

- **WHEN** a file with an unsupported extension (e.g., `.txt`, `.zip`) is placed in `BOOK_DROP_PATH`
- **THEN** the system ignores the file and does not create a `PendingBook` record

#### Scenario: Watcher is scoped to drop folder only

- **WHEN** the drop folder watcher is initialised
- **THEN** it watches `BOOK_DROP_PATH` exclusively and does not watch any path inside `EBOOK_LIBRARY_PATH`

---

### Requirement: Book drop folder path is independently configurable

The system SHALL read `BOOK_DROP_PATH` from the environment. It SHALL NOT default to any path inside or relative to `EBOOK_LIBRARY_PATH`. If `BOOK_DROP_PATH` is not set or the directory does not exist, the system SHALL log a warning and disable the drop folder watcher without crashing.

#### Scenario: BOOK_DROP_PATH is configured and exists

- **WHEN** `BOOK_DROP_PATH` is set to a valid, existing directory
- **THEN** the watcher starts successfully on that path

#### Scenario: BOOK_DROP_PATH is not set

- **WHEN** `BOOK_DROP_PATH` is absent from the environment
- **THEN** the system logs a warning ("Book drop folder not configured — drop folder ingestion disabled") and the API and library scanner continue operating normally

#### Scenario: BOOK_DROP_PATH directory does not exist

- **WHEN** `BOOK_DROP_PATH` points to a path that does not exist on disk
- **THEN** the system logs a warning and disables the watcher without crashing
