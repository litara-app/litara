## ADDED Requirements

### Requirement: API exposes an author list endpoint

The system SHALL provide a `GET /api/v1/authors` endpoint that returns all authors who have at least one associated book in the library. Each item SHALL include the author `id`, `name`, `photoUrl` (nullable), and `bookCount` (number of books in the library by that author). Results SHALL be ordered by author name ascending (case-insensitive). The endpoint SHALL be protected by `JwtAuthGuard`.

#### Scenario: Returns all authors with book counts

- **WHEN** an authenticated user sends `GET /api/v1/authors`
- **THEN** the response is 200 with an array where each item has `id`, `name`, `photoUrl` (nullable string), and `bookCount` (positive integer), ordered alphabetically by name

#### Scenario: Returns empty array when no authors exist

- **WHEN** an authenticated user sends `GET /api/v1/authors` and the library contains no books
- **THEN** the response is 200 with an empty array

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `GET /api/v1/authors`
- **THEN** the system returns 401 Unauthorized

---

### Requirement: API exposes an author detail endpoint

The system SHALL provide a `GET /api/v1/authors/:id` endpoint that returns full details for a single author. The response SHALL include `id`, `name`, `photoUrl` (nullable), `biography` (nullable), and a `books` array. Each book entry SHALL include `id`, `title`, `hasCover` (boolean), `coverUpdatedAt` (string), and `formats` (array of format strings from the author's `BookFile` records). The books SHALL be ordered by title ascending. The endpoint SHALL return 404 if the author id does not exist. The endpoint SHALL be protected by `JwtAuthGuard`.

#### Scenario: Returns author detail with books

- **WHEN** an authenticated user sends `GET /api/v1/authors/:id` for an existing author
- **THEN** the response is 200 with `id`, `name`, `photoUrl`, `biography`, and `books` array ordered by title

#### Scenario: Returns 404 for unknown author

- **WHEN** an authenticated user sends `GET /api/v1/authors/:id` with an id that does not exist
- **THEN** the system returns 404 Not Found

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `GET /api/v1/authors/:id`
- **THEN** the system returns 401 Unauthorized

---

### Requirement: Authors page lists all authors alphabetically

The system SHALL provide an `/authors` route in the web frontend displaying all authors returned by `GET /api/v1/authors` as a grid of cards. Each card SHALL show the author photo (or a placeholder avatar if `photoUrl` is null), the author name, and the book count (e.g. "4 books"). The page SHALL be accessible via an **Authors** link in the sidebar navbar. The page SHALL support a text search field to filter the visible cards by author name.

#### Scenario: Authors page displays all authors

- **WHEN** an authenticated user navigates to `/authors`
- **THEN** the page shows a card for each author with their photo/avatar, name, and book count, ordered alphabetically

#### Scenario: Empty state when no authors exist

- **WHEN** an authenticated user navigates to `/authors` and the library contains no books
- **THEN** the page shows an empty-state message

#### Scenario: Authors link is present in the navbar

- **WHEN** an authenticated user views any page
- **THEN** the sidebar navbar contains an "Authors" link that navigates to `/authors`

#### Scenario: Text filter narrows the visible authors

- **WHEN** an authenticated user types in the search field on the `/authors` page
- **THEN** only author cards whose names contain the typed string (case-insensitive) are shown

---

### Requirement: Author detail modal shows biography and owned books

The system SHALL open a modal when an author card is clicked. The modal SHALL display the author photo (or placeholder), name, biography (or a "No biography available" message if null), and an ordered list of all owned books by that author. Each book entry SHALL show the cover thumbnail, title, and be clickable to open the `BookDetailModal` for that book.

#### Scenario: Author detail modal opens on card click

- **WHEN** an authenticated user clicks an author card on the `/authors` page
- **THEN** a modal opens showing the author photo, name, biography, and list of their books

#### Scenario: Book entry opens BookDetailModal

- **WHEN** an authenticated user clicks a book entry inside the author detail modal
- **THEN** the `BookDetailModal` opens for that book

#### Scenario: Placeholder shown when author has no photo

- **WHEN** the author detail modal opens for an author with no `photoUrl`
- **THEN** a placeholder avatar or icon is shown in place of the photo

#### Scenario: Empty biography message

- **WHEN** the author detail modal opens for an author whose `biography` is null
- **THEN** the modal displays a "No biography available" message in the biography area
