## ADDED Requirements

### Requirement: Any authenticated user can upload ebook files to the drop zone

The system SHALL provide a `POST /api/v1/book-drop/upload` endpoint that accepts one or more ebook files (`.epub`, `.mobi`, `.azw`, `.azw3`, `.cbz`, `.pdf`) via `multipart/form-data`. Files SHALL be streamed directly to `BOOK_DROP_PATH` on disk — never buffered entirely in memory. Each accepted file SHALL result in a new `PendingBook` record with `status: PENDING`.

#### Scenario: Successful single-file upload

- **WHEN** an authenticated user sends a valid ebook file to `POST /api/v1/book-drop/upload`
- **THEN** the system saves the file to `BOOK_DROP_PATH`, extracts available metadata, creates a `PendingBook` record with `status: PENDING`, and returns 201 with the new `PendingBook` object

#### Scenario: Successful multi-file upload

- **WHEN** an authenticated user sends multiple valid ebook files in a single `multipart/form-data` request
- **THEN** the system saves each file, creates a separate `PendingBook` record for each, and returns 201 with an array of `PendingBook` objects

#### Scenario: Unsupported file format is rejected

- **WHEN** an authenticated user uploads a file with an unsupported extension (e.g., `.txt`, `.docx`)
- **THEN** the system returns 422 Unprocessable Entity and does not save the file

#### Scenario: Duplicate file (same SHA-256 hash already pending) is skipped

- **WHEN** an authenticated user uploads a file whose SHA-256 hash matches an existing `PendingBook` with `status: PENDING`
- **THEN** the system returns 409 Conflict with the existing `PendingBook` id and does not create a duplicate record

#### Scenario: Unauthenticated upload is rejected

- **WHEN** an unauthenticated request is made to `POST /api/v1/book-drop/upload`
- **THEN** the system returns 401 Unauthorized

---

### Requirement: Upload UI provides a drag-and-drop book drop zone

The frontend SHALL provide a dedicated book drop page or panel accessible to all authenticated users. It SHALL accept drag-and-drop and click-to-browse file selection, display upload progress per file, and show extraction results (title, author, cover thumbnail if available) immediately after upload.

#### Scenario: User drops a valid file

- **WHEN** a user drags a supported ebook file onto the drop zone
- **THEN** the UI uploads the file, shows a progress indicator, and on success displays the extracted metadata fields and a status of "Pending Review"

#### Scenario: User drops an unsupported file

- **WHEN** a user drags a `.txt` file onto the drop zone
- **THEN** the UI shows an inline error "Unsupported file type" without attempting an upload

#### Scenario: Upload fails due to network error

- **WHEN** a file upload request fails with a network or server error
- **THEN** the UI shows an error message and allows the user to retry

---

### Requirement: Mobile users can upload ebook files via the file picker

The mobile app (Expo) SHALL provide a Book Drop screen that uses `expo-document-picker` to let authenticated users select a local ebook file and upload it to `POST /api/v1/book-drop/upload`. The screen SHALL display upload progress and show extracted metadata on success.

#### Scenario: Mobile user picks and uploads a valid file

- **WHEN** a mobile user opens the Book Drop screen, taps "Select File", picks a supported ebook file, and confirms
- **THEN** the app uploads the file to the API, shows a progress indicator, and on success displays the extracted title, author, and a "Pending Review" status

#### Scenario: Mobile user picks an unsupported file

- **WHEN** a mobile user selects a file with an unsupported extension
- **THEN** the app shows an inline error "Unsupported file type" and does not attempt an upload

#### Scenario: Mobile upload fails due to network error

- **WHEN** the upload request fails due to a network or server error on mobile
- **THEN** the app shows an error notification and offers a retry action
