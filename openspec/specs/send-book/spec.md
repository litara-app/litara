## ADDED Requirements

### Requirement: User can send a book to a recipient email address

The system SHALL allow an authenticated user to send a book's file as an email attachment to one of their recipient email addresses. The SMTP config is resolved in order: user's personal SMTP config → server-level SMTP config → 503. If no `recipientEmailId` is provided, the user's default recipient email SHALL be used. If no `fileId` is provided, the system prefers the EPUB file; if no EPUB exists, the first available file is used.

#### Scenario: Quick send — EPUB preferred when multiple formats available

- **WHEN** an authenticated user submits a POST request to `/api/v1/books/:id/send` without a `fileId` field and the book has multiple `BookFile` records including an EPUB
- **THEN** the system sends the EPUB file to the user's default recipient and returns 200 with a success message

#### Scenario: Quick send — first file used when no EPUB available

- **WHEN** an authenticated user submits a POST request to `/api/v1/books/:id/send` without a `fileId` field and the book has no EPUB file
- **THEN** the system sends the first available `BookFile` (by creation order) to the user's default recipient and returns 200 with a success message

#### Scenario: Send a specific file format

- **WHEN** an authenticated user submits a POST request to `/api/v1/books/:id/send` with a `fileId` field pointing to a `BookFile` that belongs to the book
- **THEN** the system sends that specific file to the user's default recipient and returns 200 with a success message

#### Scenario: Send to a specified recipient

- **WHEN** an authenticated user submits a POST request to `/api/v1/books/:id/send` with a `recipientEmailId` field pointing to one of their recipient emails
- **THEN** the system sends the resolved file to that recipient email and returns 200 with a success message

#### Scenario: Send fails when no default recipient is set

- **WHEN** an authenticated user submits a POST request to `/api/v1/books/:id/send` without a `recipientEmailId` and they have no default recipient email
- **THEN** the system returns 422 Unprocessable Entity with a message indicating no default recipient is configured

#### Scenario: Send uses user's personal SMTP config when available

- **WHEN** an authenticated user attempts to send a book and they have a personal SMTP config saved
- **THEN** the system uses the user's personal SMTP config (not the server config)

#### Scenario: Send falls back to server SMTP config

- **WHEN** an authenticated user attempts to send a book and they have no personal SMTP config but a server SMTP config exists
- **THEN** the system uses the server SMTP config

#### Scenario: Send fails when no SMTP config is available

- **WHEN** an authenticated user attempts to send a book and neither a personal nor a server SMTP configuration exists
- **THEN** the system returns 503 Service Unavailable with a message indicating SMTP is not configured

#### Scenario: Send fails when book has no associated file

- **WHEN** an authenticated user attempts to send a book that has no `BookFile` records
- **THEN** the system returns 422 Unprocessable Entity

#### Scenario: Send fails when specified fileId does not belong to the book

- **WHEN** an authenticated user submits a POST request to `/api/v1/books/:id/send` with a `fileId` that does not belong to the specified book
- **THEN** the system returns 404 Not Found

#### Scenario: SMTP delivery error is surfaced

- **WHEN** the SMTP server rejects the message (e.g., authentication failure, size limit exceeded)
- **THEN** the system returns 502 Bad Gateway with the SMTP error message

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `POST /api/v1/books/:id/send`
- **THEN** the system returns 401 Unauthorized

#### Scenario: Book not found

- **WHEN** an authenticated user submits a POST request to `/api/v1/books/:id/send` for a book ID that does not exist
- **THEN** the system returns 404 Not Found

### Requirement: Recipient email must belong to the requesting user

The system SHALL reject send requests that specify a `recipientEmailId` belonging to a different user.

#### Scenario: Send with another user's recipient email ID

- **WHEN** an authenticated user submits a POST request to `/api/v1/books/:id/send` with a `recipientEmailId` that belongs to a different user
- **THEN** the system returns 404 Not Found (without revealing that the address exists)

### Requirement: Frontend performs client-side file size check before sending

The frontend SHALL check the `size` field of the selected `BookFile` record before initiating a send request. If the file exceeds the configured warning threshold (default: 25 MB), the UI SHALL display a warning to the user and require explicit confirmation before proceeding.

#### Scenario: File size under threshold — send proceeds without warning

- **WHEN** the user clicks Send and the selected file's `size` is below the threshold
- **THEN** the frontend sends the request without showing a size warning

#### Scenario: File size over threshold — user is warned

- **WHEN** the user clicks Send and the selected file's `size` exceeds the threshold
- **THEN** the frontend shows an inline warning (e.g., "This file is X MB. Some SMTP servers may reject attachments larger than 25 MB.") and requires the user to confirm before the request is sent

#### Scenario: File size unavailable — no warning shown

- **WHEN** the selected `BookFile` record has no `size` value
- **THEN** the frontend sends the request without a size warning
