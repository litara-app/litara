## ADDED Requirements

### Requirement: Libraries are global and admin-managed

The system SHALL treat libraries as globally-shared entities (no `userId` ownership) and SHALL restrict mutation (create, update, delete, scan) to users whose role is `ADMIN`.

#### Scenario: Non-admin attempts to create a library

- **WHEN** an authenticated non-admin user sends `POST /libraries` with a valid body
- **THEN** the system returns HTTP 403 and does not create the library

#### Scenario: Admin creates a library visible to all users

- **WHEN** an admin creates a library
- **THEN** every authenticated user sees the new library in `GET /libraries`

#### Scenario: Non-admin can read libraries

- **WHEN** an authenticated non-admin user sends `GET /libraries` or `GET /libraries/:id`
- **THEN** the system returns the library list or detail with HTTP 200

### Requirement: Library is filesystem-tied with a unique path under EBOOK_LIBRARY_PATH

Each library SHALL have a unique, absolute filesystem `path` that resolves to an existing directory inside `EBOOK_LIBRARY_PATH`. The system SHALL reject paths that are outside the root, equal to an existing library path, or that are an ancestor or descendant of an existing library path.

#### Scenario: Path outside EBOOK_LIBRARY_PATH is rejected

- **WHEN** an admin creates a library with a `path` that does not resolve inside `EBOOK_LIBRARY_PATH`
- **THEN** the system returns HTTP 400 and does not create the library

#### Scenario: Duplicate path is rejected

- **WHEN** an admin creates a library whose `path` matches an existing library's `path`
- **THEN** the system returns HTTP 409 and does not create the library

#### Scenario: Overlapping path is rejected

- **WHEN** an admin creates a library whose `path` is an ancestor or descendant of an existing library's `path`
- **THEN** the system returns HTTP 409 and does not create the library

#### Scenario: Non-existent path is rejected

- **WHEN** an admin creates a library with a `path` that does not exist on disk
- **THEN** the system returns HTTP 400 and does not create the library

### Requirement: Libraries carry an icon, per-library metadata config, and a last scan timestamp

Each library SHALL expose `iconKey` (string, optional), `metadataFieldOverrides` (sparse `{field: providerId}` map, optional), `metadataProvidersDisabled` (string array of provider IDs, defaults to empty), and `lastScanAt` (timestamp, set by the scanner on completion).

#### Scenario: Admin saves metadata overrides

- **WHEN** an admin sends `PATCH /libraries/:id` with `metadataFieldOverrides: {"description": "audnexus"}` and `metadataProvidersDisabled: ["goodreads"]`
- **THEN** the library record reflects both fields and subsequent metadata resolution uses Audnexus for description and excludes Goodreads

#### Scenario: lastScanAt is set on scan completion

- **WHEN** a library scan task completes successfully
- **THEN** the library's `lastScanAt` equals the task's completion time

### Requirement: Per-library metadata config inherits from global with overrides

For any field, the resolved provider SHALL be the value in `Library.metadataFieldOverrides[field]` when present, otherwise the value from the global metadata field config. After resolution, any provider listed in `Library.metadataProvidersDisabled` SHALL be excluded; affected fields SHALL fall back to the next configured provider for that field, or be skipped if no provider remains.

#### Scenario: Field with no override inherits global

- **GIVEN** the global config maps `genres` to `hardcover` and a library has no override for `genres`
- **WHEN** metadata is resolved for a book in that library
- **THEN** `hardcover` is used for the `genres` field

#### Scenario: Library override wins over global

- **GIVEN** the global config maps `description` to `google-books` and a library overrides `description` to `audnexus`
- **WHEN** metadata is resolved for a book in that library
- **THEN** `audnexus` is used for the `description` field

#### Scenario: Disabled provider is excluded

- **GIVEN** a library has `metadataProvidersDisabled = ["audnexus"]` and the global config maps `description` to `audnexus`
- **WHEN** metadata is resolved for a book in that library
- **THEN** `audnexus` is not called for `description` in that library

### Requirement: A book's library is derived from its file path

The scanner SHALL set `Book.libraryId` to the library whose `path` is the longest prefix of the file's path. If no library covers the file, `Book.libraryId` SHALL be null and `Book.isOrphan` SHALL be true. The book detail UI SHALL NOT expose a control to change a book's library.

#### Scenario: File path matches one library

- **GIVEN** a library exists with `path = /books/ebooks`
- **WHEN** the scanner ingests `/books/ebooks/Asimov/Foundation.epub`
- **THEN** the resulting Book has `libraryId` equal to that library's id and `isOrphan = false`

#### Scenario: File path matches no library

- **GIVEN** libraries cover `/books/ebooks` and `/books/audiobooks`
- **WHEN** the scanner ingests `/books/loose.epub`
- **THEN** the resulting Book has `libraryId = null` and `isOrphan = true`

#### Scenario: File path matches the most specific library

- **GIVEN** libraries cover `/books/ebooks` and `/books/ebooks/fiction`
- **WHEN** the scanner ingests `/books/ebooks/fiction/Asimov/Foundation.epub`
- **THEN** the resulting Book's `libraryId` references the `/books/ebooks/fiction` library

### Requirement: Existing per-user libraries migrate to per-owner shelves

On migration, the system SHALL create one `Shelf` per `(userId, library)` pair preserving the library's `name`, then move all `UserBookLibrary` rows into corresponding `BookShelf` rows. The system SHALL then drop the `UserBookLibrary` table and clear the `Library` table.

#### Scenario: User's existing library becomes a same-name shelf with the same books

- **GIVEN** before migration user A had a library "Sci-Fi" containing 12 books via `UserBookLibrary`
- **WHEN** the migration runs
- **THEN** user A has a shelf "Sci-Fi" containing the same 12 books

#### Scenario: Different users with same-named libraries get separate shelves

- **GIVEN** before migration users A and B both had libraries named "Favorites" with different book sets
- **WHEN** the migration runs
- **THEN** user A and user B each have their own "Favorites" shelf with their respective book sets
