## ADDED Requirements

### Requirement: Batch reading progress update endpoint

The system SHALL expose a `PATCH /api/v1/books/bulk-reading-progress` endpoint that accepts an array of book IDs and an action (`mark-read` or `mark-unread`), applying the change for the authenticated user.

#### Scenario: Batch mark-read upserts completed progress for all books

- **WHEN** `PATCH /api/v1/books/bulk-reading-progress` is called with `{ bookIds: ["id1","id2"], action: "mark-read" }`
- **THEN** a `ReadingProgress` record with `percentage: 100` and `completedAt` set to the current timestamp is upserted for each book ID / user pair
- **THEN** the endpoint returns `{ success: true }`

#### Scenario: Batch mark-unread removes or resets progress for all books

- **WHEN** `PATCH /api/v1/books/bulk-reading-progress` is called with `{ bookIds: ["id1","id2"], action: "mark-unread" }`
- **THEN** the `ReadingProgress` record for each book / user pair is deleted if it exists
- **THEN** the endpoint returns `{ success: true }`

#### Scenario: Unknown book IDs are silently ignored

- **WHEN** the request includes a book ID that does not exist
- **THEN** the endpoint processes valid IDs and skips the unknown ones without returning an error
