## ADDED Requirements

### Requirement: Annotation type enum

The `Annotation` model SHALL include a `type` field using a `AnnotationType` enum with values `HIGHLIGHT`, `UNDERLINE`, `STRIKETHROUGH`, and `BOOKMARK`. The default value SHALL be `HIGHLIGHT`. Existing rows without a type SHALL be migrated to `HIGHLIGHT`.

#### Scenario: Default type on existing rows

- **WHEN** the migration runs on a database with existing Annotation rows that have no `type` value
- **THEN** all existing rows SHALL have `type` set to `HIGHLIGHT`

#### Scenario: Bookmark has no required text

- **WHEN** a `BOOKMARK` annotation is created with no `text` field
- **THEN** the annotation SHALL be saved successfully with `text` as null

### Requirement: Create annotation

The API SHALL expose `POST /api/v1/books/:bookId/annotations` (authenticated) to create an annotation. The request body SHALL include `location` (required string), `type` (required enum), `text` (optional string), `note` (optional string), and `color` (optional string). The annotation SHALL be associated with the authenticated user and the specified book.

#### Scenario: Create highlight annotation

- **WHEN** an authenticated user POSTs `{ location, type: "HIGHLIGHT", text, color }` to `/api/v1/books/:bookId/annotations`
- **THEN** a 201 response is returned with the created annotation including `id`, `location`, `type`, `text`, `color`, `note`, `createdAt`, `updatedAt`

#### Scenario: Create bookmark annotation

- **WHEN** an authenticated user POSTs `{ location, type: "BOOKMARK" }` to `/api/v1/books/:bookId/annotations`
- **THEN** a 201 response is returned with the created annotation where `text` is null

#### Scenario: Book does not belong to user's accessible library

- **WHEN** an authenticated user POSTs to `/api/v1/books/:bookId/annotations` for a `bookId` that does not exist
- **THEN** a 404 response is returned

#### Scenario: Unauthenticated request

- **WHEN** a request is made without a valid JWT token
- **THEN** a 401 response is returned

### Requirement: List annotations for book

The API SHALL expose `GET /api/v1/books/:bookId/annotations` (authenticated) returning all annotations for the book created by the authenticated user, ordered by `createdAt` ascending.

#### Scenario: List annotations

- **WHEN** an authenticated user GETs `/api/v1/books/:bookId/annotations`
- **THEN** a 200 response is returned with an array of annotation objects belonging to that user and book

#### Scenario: No annotations exist

- **WHEN** an authenticated user GETs `/api/v1/books/:bookId/annotations` and no annotations exist for that book
- **THEN** a 200 response is returned with an empty array

### Requirement: Update annotation

The API SHALL expose `PATCH /api/v1/books/:bookId/annotations/:id` (authenticated) allowing the owner to update `note`, `color`, and `type` fields. The `location` and `text` fields SHALL NOT be updatable.

#### Scenario: Update note

- **WHEN** an authenticated user PATCHes `{ note: "new note" }` to their annotation
- **THEN** a 200 response is returned with the updated annotation

#### Scenario: Update annotation owned by another user

- **WHEN** an authenticated user attempts to PATCH an annotation they do not own
- **THEN** a 404 response is returned

### Requirement: Delete annotation

The API SHALL expose `DELETE /api/v1/books/:bookId/annotations/:id` (authenticated) allowing the owner to delete their annotation.

#### Scenario: Delete own annotation

- **WHEN** an authenticated user DELETEs their annotation
- **THEN** a 204 response is returned and the annotation is removed from the database

#### Scenario: Delete annotation owned by another user

- **WHEN** an authenticated user attempts to DELETE an annotation they do not own
- **THEN** a 404 response is returned

### Requirement: List all annotations for user

The API SHALL expose `GET /api/v1/annotations` (authenticated) returning all annotations across all books for the authenticated user, ordered by `createdAt` descending. Each annotation object SHALL include the book's `title`, `coverUrl`, and `id` for display purposes.

#### Scenario: List all annotations

- **WHEN** an authenticated user GETs `/api/v1/annotations`
- **THEN** a 200 response is returned with annotations from all books, each including `book.id`, `book.title`, and `book.coverUrl`

#### Scenario: Filter by type

- **WHEN** an authenticated user GETs `/api/v1/annotations?type=BOOKMARK`
- **THEN** only annotations with `type = BOOKMARK` are returned
