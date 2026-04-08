## ADDED Requirements

### Requirement: Library write service detects read-only volume at startup

The system SHALL reuse the existing write-probe mechanism (create and immediately delete `.litara-write-probe` in the library root) on `LibraryWriteService` initialisation to determine whether the library volume is writable. The result SHALL be stored in memory as `isReadOnly`. The probe SHALL also be re-run immediately before any write attempt.

#### Scenario: Library volume is writable

- **WHEN** `LibraryWriteService` initialises and the write probe succeeds
- **THEN** `isReadOnly` is set to `false` and write operations are permitted (subject to the admin toggle)

#### Scenario: Library volume is read-only

- **WHEN** `LibraryWriteService` initialises and the write probe fails with `EROFS` or `EACCES`
- **THEN** `isReadOnly` is set to `true` and all write attempts return an error indicating the library is mounted read-only

#### Scenario: Write blocked because volume became read-only after startup

- **WHEN** a write is attempted and the probe run immediately before it fails
- **THEN** the system returns an error indicating the library is read-only and does not write the file

---

### Requirement: Admin toggle gates library writes

The system SHALL respect a `libraryWriteEnabled` boolean in `ServerSettings`. Even when the volume is writable, all disk writes SHALL be blocked when `libraryWriteEnabled` is `false`.

#### Scenario: Writes blocked by admin toggle

- **WHEN** `libraryWriteEnabled` is `false` and an approve action is triggered
- **THEN** the system returns 409 with a message indicating writes are disabled by configuration and does not write any file

#### Scenario: Writes allowed when toggle is enabled and volume is writable

- **WHEN** `libraryWriteEnabled` is `true` and the volume write probe passes
- **THEN** the write proceeds normally

---

### Requirement: Target path is computed deterministically from metadata

The system SHALL compute the destination path for an approved book using the following priority order, applied to the configured library root:

1. `<library-root>/<first-author>/<series-name>/<title>.<ext>` — when series name is known
2. `<library-root>/<first-author>/<title>.<ext>` — when author is known, no series
3. `<library-root>/unknown/<title>.<ext>` — when title is known but no author
4. `<library-root>/unknown/<original-filename>` — when no usable metadata

Path segments SHALL be sanitized: illegal filesystem characters stripped, Unicode normalized to NFC, whitespace collapsed, each segment truncated to 200 characters. When multiple authors exist, only the first is used.

#### Scenario: Book with author, series, and title

- **WHEN** a `PendingBook` has `authors: ["Brandon Sanderson"]`, `seriesName: "The Stormlight Archive"`, `title: "The Way of Kings"`, and extension `.epub`
- **THEN** the computed path is `<library-root>/Brandon Sanderson/The Stormlight Archive/The Way of Kings.epub`

#### Scenario: Book with author and title, no series

- **WHEN** a `PendingBook` has `authors: ["N.K. Jemisin"]`, no `seriesName`, `title: "The Fifth Season"`, extension `.epub`
- **THEN** the computed path is `<library-root>/N.K. Jemisin/The Fifth Season.epub`

#### Scenario: Book with title only

- **WHEN** a `PendingBook` has no authors, no series, `title: "Untitled Anthology"`, extension `.mobi`
- **THEN** the computed path is `<library-root>/unknown/Untitled Anthology.mobi`

#### Scenario: Book with no usable metadata

- **WHEN** a `PendingBook` has no authors, no series, no title, and original filename `mystery-book.epub`
- **THEN** the computed path is `<library-root>/unknown/mystery-book.epub`

#### Scenario: Multi-author book uses first author only

- **WHEN** a `PendingBook` has `authors: ["Terry Pratchett", "Neil Gaiman"]` and `title: "Good Omens"`, extension `.epub`
- **THEN** the computed path is `<library-root>/Terry Pratchett/Good Omens.epub`

---

### Requirement: Collision detection blocks write and requires explicit approval

Before writing any file, the system SHALL check whether a file already exists at the computed target path. If a collision is detected, the write SHALL be aborted, `PendingBook.status` set to `COLLISION`, and `collidingPath` populated. The file SHALL NOT be written until the admin explicitly calls the approve-overwrite endpoint.

#### Scenario: No collision — file written normally

- **WHEN** the computed target path does not exist on disk
- **THEN** the system writes the file, creates necessary directories, and proceeds

#### Scenario: Collision detected — write aborted

- **WHEN** the computed target path already exists on disk
- **THEN** the system sets `PendingBook.status` to `COLLISION`, stores the path in `collidingPath`, and does not write the file

#### Scenario: Overwrite approved — file replaced

- **WHEN** `overwriteApproved` is `true` and the approve-overwrite endpoint is called
- **THEN** the system overwrites the existing file at `targetPath` and proceeds with library record update

#### Scenario: Collision file removed before overwrite is approved

- **WHEN** `overwriteApproved` is `true` but the file at `collidingPath` no longer exists
- **THEN** the system writes the file normally without error

---

### Requirement: Successful write creates a Book record in the library

After writing the file to disk, the system SHALL create (or update) a `Book` and associated `BookFile` record in the database, as if the file had been discovered by the library scanner.

#### Scenario: Book record created after write

- **WHEN** a file is successfully written to the library
- **THEN** the system creates a `Book` record with the approved metadata and a `BookFile` record pointing to the new path, making it immediately visible in the library

#### Scenario: Book record not created if write fails

- **WHEN** the file write fails (e.g., disk full, permissions error)
- **THEN** the system does not create a `Book` or `BookFile` record, returns an error, and leaves `PendingBook.status` unchanged
