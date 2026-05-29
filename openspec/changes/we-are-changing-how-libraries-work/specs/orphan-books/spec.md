## ADDED Requirements

### Requirement: Books carry an isOrphan flag

`Book` SHALL have an `isOrphan` boolean column (default `false`). Orphan books SHALL be visible in `All Books` listings but SHALL NOT appear in any library's per-library page (since they have `libraryId = null`).

#### Scenario: Orphan book is in All Books

- **GIVEN** a book with `isOrphan = true` and `libraryId = null`
- **WHEN** an authenticated user loads `GET /books`
- **THEN** the orphan book is included in the response

#### Scenario: Orphan book is excluded from per-library listing

- **WHEN** a user loads `GET /books?libraryId=<id>`
- **THEN** no orphan books are returned

### Requirement: Admin can list orphan books

The system SHALL expose `GET /admin/books/orphans` (admin-only, paginated) returning orphan books with their file paths so an admin can decide how to reassign each.

#### Scenario: Admin lists orphan books

- **WHEN** an admin sends `GET /admin/books/orphans`
- **THEN** the response includes every book with `isOrphan = true` and includes each book's first file path

#### Scenario: Non-admin cannot list orphan books

- **WHEN** a non-admin user sends `GET /admin/books/orphans`
- **THEN** the system returns HTTP 403

### Requirement: Admin can reassign an orphan book to a library

The system SHALL expose `PATCH /admin/books/:id/reassign-library` (admin-only) that accepts `{libraryId}`, moves the book's primary file into `{library.path}/{author}/{series}/{title}.{ext}` using the existing `LibraryWriteService` helpers, updates `Book.libraryId`, and clears `Book.isOrphan`.

#### Scenario: Reassigning moves the file and clears the orphan flag

- **GIVEN** an orphan book with file at `/books/loose/Foundation.epub`
- **WHEN** an admin sends `PATCH /admin/books/:id/reassign-library` with a library whose `path = /books/ebooks`
- **THEN** the file is moved to `/books/ebooks/Asimov/Foundation.epub`, `Book.libraryId` references the chosen library, and `Book.isOrphan = false`

#### Scenario: Reassigning to a non-existent library is rejected

- **WHEN** an admin sends `PATCH /admin/books/:id/reassign-library` with a `libraryId` that does not exist
- **THEN** the system returns HTTP 404 and does not move the file
