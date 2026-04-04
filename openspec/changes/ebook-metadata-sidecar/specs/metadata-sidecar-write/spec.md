## ADDED Requirements

### Requirement: API can write a book's metadata to a sidecar file on disk

The system SHALL expose `POST /api/v1/books/:id/sidecar/write` which serialises the book's current database metadata into a `.metadata.json` file placed in the same directory as the book's primary ebook file. The endpoint SHALL check disk-write guard before proceeding. On success it SHALL update `Book.sidecarFile` to the written path and return `{ "sidecarFile": "<absolute-path>" }`.

#### Scenario: Successful sidecar write

- **WHEN** disk writes are enabled and a user calls `POST /api/v1/books/:id/sidecar/write` for a book with at least one on-disk file
- **THEN** a `.metadata.json` file is written beside the ebook file, `Book.sidecarFile` is updated in the database, and the response is `{ "sidecarFile": "<path>" }` with status 200

#### Scenario: Book not found

- **WHEN** the book ID does not exist
- **THEN** the API returns 404 Not Found

#### Scenario: Book has no on-disk files

- **WHEN** the book exists in the database but all its `BookFile` records have `missingAt` set
- **THEN** the API returns 422 Unprocessable Entity with a message indicating no on-disk file is available to determine the write location

#### Scenario: Filesystem error during write

- **WHEN** the write fails due to a filesystem error (e.g. permissions)
- **THEN** the API returns 500 with the OS error message surfaced in the response body

### Requirement: Sidecar file is written atomically

The write operation SHALL use a write-to-temp-then-rename strategy: the JSON is written to `<name>.metadata.json.tmp` and then renamed to `<name>.metadata.json`. This protects concurrent readers (including other ebook managers on an NFS share) from seeing a partial file.

#### Scenario: Temp file is not left behind on success

- **WHEN** the sidecar write completes successfully
- **THEN** no `.metadata.json.tmp` file remains in the directory

#### Scenario: Temp file is cleaned up on failure

- **WHEN** the rename step fails after the temp file is written
- **THEN** the temp file is deleted before the error is returned

### Requirement: Sidecar filename matches the ebook basename

The sidecar file SHALL be named `<ebook-basename>.metadata.json` where `<ebook-basename>` is the filename of the primary ebook file without its extension. When a book has multiple formats, the primary file SHALL be chosen by preferring EPUB over other formats, then falling back to the first non-missing file.

#### Scenario: EPUB preferred for file location

- **WHEN** a book has both an EPUB and a MOBI file and both are present on disk
- **THEN** the sidecar is written beside the EPUB file using the EPUB filename as the base

#### Scenario: Non-EPUB fallback

- **WHEN** a book has only a MOBI file on disk
- **THEN** the sidecar is written beside the MOBI file

### Requirement: SidecarTab provides a "Write to Disk" button

The `SidecarTab` component SHALL display a "Write to Disk" button. When no sidecar file exists the button SHALL appear as a primary call-to-action alongside "Scan for Sidecar". When a sidecar already exists the button SHALL appear in the action bar (alongside Rescan and Export). After a successful write the tab SHALL reload the sidecar content to show the newly written data. If disk writes are disabled the button SHALL be disabled with a tooltip explaining the reason.

#### Scenario: Write to Disk button triggers write and refreshes

- **WHEN** the user clicks "Write to Disk" and the API returns success
- **THEN** the tab fetches the sidecar content and displays the comparison view

#### Scenario: Write to Disk button disabled when guard is off

- **WHEN** `allowDiskWrites` is false (sourced from the server settings)
- **THEN** the "Write to Disk" button is rendered as disabled with a tooltip: "Disk writes are disabled. See Admin → Disk Settings."

#### Scenario: Write failure shows error toast

- **WHEN** the `POST /sidecar/write` call returns an error
- **THEN** a red error toast is shown with the server's error message
