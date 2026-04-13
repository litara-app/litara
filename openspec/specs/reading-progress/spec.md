## ADDED Requirements

### Requirement: ReadingProgress stores KOReader-specific fields

The system SHALL extend the `ReadingProgress` model with nullable KOReader-specific fields so that progress synced from KOReader is fully represented and surfaced in the Litara UI.

#### Scenario: KOReader progress update populates extended fields

- **WHEN** a `PUT /1/syncs/progress` request is processed for a known book
- **THEN** the `ReadingProgress` record is upserted with `koReaderProgress` (the raw KOReader progress string), `koReaderDevice` (device name), `koReaderDeviceId`, and `koReaderTimestamp` (unix timestamp)
- **THEN** the existing `location` field is set to the KOReader `progress` value
- **THEN** the existing `percentage` field is set to the KOReader `percentage` value

#### Scenario: KOReader fields are null for non-KOReader progress

- **WHEN** reading progress is updated via the standard Litara API (not KOReader sync)
- **THEN** `koReaderProgress`, `koReaderDevice`, `koReaderDeviceId`, and `koReaderTimestamp` remain null

---

### Requirement: BookFile stores MD5 hash for KOReader document matching

The system SHALL store an MD5 hash of each book file on the `BookFile` model to enable matching KOReader document identifiers to Litara books.

#### Scenario: MD5 hash computed during library scan

- **WHEN** a new book file is added to a watched folder
- **THEN** the library scanner computes the MD5 hash of the file and stores it as `koReaderHash` on the `BookFile` record

#### Scenario: Existing files get MD5 hash on first startup after migration

- **WHEN** the API starts after the migration is applied and `BookFile` records exist with null `koReaderHash`
- **THEN** the system computes and backfills MD5 hashes for all existing files

#### Scenario: KOReader document hash matches book file

- **WHEN** a KOReader sync progress update arrives with document hash `<md5>`
- **THEN** the system finds the `BookFile` with matching `koReaderHash` and links the progress to the associated `Book`

---

### Requirement: Batch reading progress update endpoint

The system SHALL expose a `PATCH /api/v1/books/bulk-reading-progress` endpoint that accepts an array of book IDs and an action (`mark-read` or `mark-unread`), applying the change for the authenticated user.

#### Scenario: Batch mark-read upserts completed progress for all books

- **WHEN** `PATCH /api/v1/books/bulk-reading-progress` is called with `{ bookIds: ["id1","id2"], action: "mark-read" }`
- **THEN** a `ReadingProgress` record with `percentage: 1` (100%) is upserted for each book ID / user pair
- **THEN** the endpoint returns `{ success: true }`

#### Scenario: Batch mark-unread removes progress for all books

- **WHEN** `PATCH /api/v1/books/bulk-reading-progress` is called with `{ bookIds: ["id1","id2"], action: "mark-unread" }`
- **THEN** the `ReadingProgress` record for each book / user pair is deleted if it exists
- **THEN** the endpoint returns `{ success: true }`

#### Scenario: Unknown book IDs are silently ignored

- **WHEN** the request includes a book ID that does not exist
- **THEN** the endpoint processes valid IDs and skips the unknown ones without returning an error
