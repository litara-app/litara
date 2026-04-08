## ADDED Requirements

### Requirement: Admin can list all pending books awaiting review

The system SHALL provide `GET /api/v1/book-drop/pending` returning all `PendingBook` records with `status: PENDING` or `status: COLLISION`. Only admin users may call this endpoint.

#### Scenario: Admin retrieves pending books

- **WHEN** an admin sends `GET /api/v1/book-drop/pending`
- **THEN** the system returns 200 with an array of `PendingBook` objects including extracted metadata, staged file path, status, and collision info where applicable

#### Scenario: Non-admin is rejected

- **WHEN** a non-admin authenticated user sends `GET /api/v1/book-drop/pending`
- **THEN** the system returns 403 Forbidden

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `GET /api/v1/book-drop/pending`
- **THEN** the system returns 401 Unauthorized

---

### Requirement: Admin can edit metadata of a pending book before approval

The system SHALL provide `PATCH /api/v1/book-drop/:id` allowing an admin to update any metadata field (title, authors, series name, series position, publisher, language, description, ISBN-10, ISBN-13, etc.) on a `PendingBook` record. The staged file on disk is never modified.

#### Scenario: Admin updates title and author

- **WHEN** an admin sends `PATCH /api/v1/book-drop/:id` with updated `title` and `authors` fields
- **THEN** the system updates the `PendingBook` record and returns 200 with the updated object

#### Scenario: Admin cannot edit a non-existent record

- **WHEN** an admin sends `PATCH /api/v1/book-drop/:id` with an id that does not exist
- **THEN** the system returns 404 Not Found

---

### Requirement: Admin can approve a pending book to be written to disk

The system SHALL provide `POST /api/v1/book-drop/:id/approve`. On approval the system SHALL compute the target path, check for collisions, and if none exist, write the staged file to disk and create a `Book` record in the library. The `PendingBook` status SHALL be updated to `APPROVED`.

#### Scenario: Successful approval — no collision

- **WHEN** an admin approves a `PendingBook` with no collision at the computed target path
- **THEN** the system writes the file to the computed path, creates a `Book` record, sets `PendingBook.status` to `APPROVED`, and returns 200

#### Scenario: Approval blocked — library volume is read-only

- **WHEN** an admin approves a `PendingBook` but the library volume is mounted `:ro`
- **THEN** the system returns 409 with a message indicating the library is read-only and does not write any file

#### Scenario: Approval blocked — library writes disabled by admin toggle

- **WHEN** an admin approves a `PendingBook` but `libraryWriteEnabled` is `false` in server settings
- **THEN** the system returns 409 with a message indicating writes are disabled and does not write any file

#### Scenario: Approval triggers collision

- **WHEN** an admin approves a `PendingBook` and a file already exists at the computed target path
- **THEN** the system sets `PendingBook.status` to `COLLISION`, populates `collidingPath`, and returns 409 with collision details — the file is NOT written

---

### Requirement: Admin can approve overwrite after a collision

The system SHALL provide `POST /api/v1/book-drop/:id/approve-overwrite` for records with `status: COLLISION`. This sets `overwriteApproved = true` and re-attempts the write, overwriting the existing file.

#### Scenario: Successful overwrite approval

- **WHEN** an admin sends `POST /api/v1/book-drop/:id/approve-overwrite` for a `PendingBook` with `status: COLLISION`
- **THEN** the system overwrites the existing file at `collidingPath`, updates the `Book` record, sets status to `APPROVED`, and returns 200

#### Scenario: Overwrite approval — target file removed since collision was detected

- **WHEN** an admin approves overwrite but the colliding file no longer exists on disk
- **THEN** the system proceeds to write the file normally (no collision) and returns 200

#### Scenario: Overwrite endpoint rejected for non-collision record

- **WHEN** an admin sends `POST /api/v1/book-drop/:id/approve-overwrite` for a record with `status: PENDING`
- **THEN** the system returns 422 Unprocessable Entity

---

### Requirement: Admin can reject a pending book

The system SHALL provide `POST /api/v1/book-drop/:id/reject`. This sets `PendingBook.status` to `REJECTED`. The staged file is left on disk; no file is deleted.

#### Scenario: Successful rejection

- **WHEN** an admin sends `POST /api/v1/book-drop/:id/reject`
- **THEN** the system sets `PendingBook.status` to `REJECTED`, leaves the staged file on disk, and returns 200

#### Scenario: Rejecting an already-approved book is not allowed

- **WHEN** an admin sends `POST /api/v1/book-drop/:id/reject` for a record with `status: APPROVED`
- **THEN** the system returns 422 Unprocessable Entity

---

### Requirement: Web admin review page

The web frontend SHALL provide an admin-only "Book Review" page listing all pending and collision books. Each entry SHALL show cover thumbnail (if available), extracted metadata, computed target path, and status. Admins SHALL be able to edit metadata inline, approve, reject, and — for collision entries — approve overwrite with a clearly distinct destructive-style confirmation.

#### Scenario: Admin views pending list

- **WHEN** an admin navigates to the Book Review page
- **THEN** the page displays all pending and collision books with their metadata, target path, and available actions

#### Scenario: Collision entry shows overwrite warning

- **WHEN** a pending book has `status: COLLISION`
- **THEN** the entry displays the existing file path and a warning before offering the "Approve Overwrite" action

#### Scenario: Non-admin cannot access the Book Review page

- **WHEN** a non-admin user navigates to the Book Review route
- **THEN** they are redirected or shown a 403 view

---

### Requirement: Mobile admin review screen

The mobile app SHALL provide an admin-only "Book Review" screen listing pending and collision books. Admins SHALL be able to approve, reject, and approve-overwrite directly from mobile. The screen SHALL only be visible in the navigation to admin users.

#### Scenario: Admin views pending list on mobile

- **WHEN** an admin opens the Book Review screen on mobile
- **THEN** the app fetches `GET /api/v1/book-drop/pending` and displays each book with title, author, status, and action buttons

#### Scenario: Admin approves a book on mobile

- **WHEN** an admin taps "Approve" on a pending book in the mobile review screen
- **THEN** the app calls `POST /api/v1/book-drop/:id/approve` and updates the item status in the list

#### Scenario: Admin sees collision warning on mobile

- **WHEN** a book has `status: COLLISION` in the mobile review screen
- **THEN** the app shows a warning banner with the colliding path and presents "Approve Overwrite" and "Reject" as the available actions

#### Scenario: Mobile review screen hidden from non-admins

- **WHEN** a non-admin user is signed in on mobile
- **THEN** the Book Review screen does not appear in navigation and the route is inaccessible
