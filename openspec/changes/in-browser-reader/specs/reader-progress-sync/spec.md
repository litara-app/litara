## ADDED Requirements

### Requirement: Reading position is auto-saved

The system SHALL automatically save the user's reading position (CFI string for EPUB, percentage for other formats) to the `ReadingProgress` record on every page turn, debounced to at most one API call per second. The position SHALL also be saved when the reader is closed or the browser tab is unloaded.

#### Scenario: Position saved on page turn

- **WHEN** the user turns a page in the reader
- **THEN** within one second a PATCH request is made to update `ReadingProgress.location` (CFI) and `ReadingProgress.percentage` for the current user and book

#### Scenario: Position saved on reader close

- **WHEN** the user exits the reader or closes the browser tab
- **THEN** the current reading position is saved before the page unloads

#### Scenario: First-time reader open (no saved progress)

- **WHEN** the user opens a book for the first time (no ReadingProgress record exists)
- **THEN** the reader opens at the beginning of the book and a new ReadingProgress record is created on the first page turn

### Requirement: Reading position is restored on open

The system SHALL restore the user's last saved position when the reader is opened. If a `ReadingProgress.location` value exists for the current user and book, the reader SHALL navigate to that CFI/position immediately after the ebook is loaded.

#### Scenario: Returning to a previously read book

- **WHEN** the user opens the reader for a book they have previously read
- **THEN** the reader navigates to the saved CFI/position and the user continues from where they left off

#### Scenario: Progress percentage shown on book cards

- **WHEN** a book has a ReadingProgress record with a non-null percentage for the current user
- **THEN** a progress indicator (e.g., thin bar or percentage label) is shown on the book card in the library and dashboard

### Requirement: Reading progress API endpoints

The system SHALL expose the following endpoints for reading progress management:

- `GET /api/v1/books/:id/progress` — returns the current user's ReadingProgress for the book (404 if none)
- `PATCH /api/v1/books/:id/progress` — upserts the ReadingProgress record with `{ location, percentage }`

Both endpoints SHALL require JWT authentication and SHALL be scoped to the authenticated user (users cannot read or write other users' progress).

#### Scenario: Fetching existing progress

- **WHEN** `GET /api/v1/books/:id/progress` is called for a book with saved progress
- **THEN** the API returns `{ location, percentage, lastSyncedAt }`

#### Scenario: Upserting progress

- **WHEN** `PATCH /api/v1/books/:id/progress` is called with `{ location: "<cfi>", percentage: 0.42 }`
- **THEN** the ReadingProgress record is created or updated and the API returns the updated record

#### Scenario: Progress is user-scoped

- **WHEN** user A calls `GET /api/v1/books/:id/progress` for a book that user B has read
- **THEN** the API returns 404 (user A has no progress) — user B's progress is not returned
