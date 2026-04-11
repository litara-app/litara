# Author Browser

## Requirements

### Requirement: API exposes an author list endpoint

The system SHALL provide a `GET /api/v1/authors` endpoint that returns all authors who have at least one associated book in the library. Each item SHALL include the author `id`, `name`, `hasCover` (boolean, derived from whether `photoData` is non-null), and `bookCount` (number of books in the library by that author). Results SHALL be ordered by author name ascending. The endpoint SHALL be protected by `JwtAuthGuard`.

#### Scenario: Returns all authors with book counts

- **WHEN** an authenticated user sends `GET /api/v1/authors`
- **THEN** the response is 200 with an array where each item has `id`, `name`, `hasCover` (boolean), and `bookCount` (positive integer), ordered alphabetically by name

#### Scenario: Returns empty array when no authors exist

- **WHEN** an authenticated user sends `GET /api/v1/authors` and the library contains no books
- **THEN** the response is 200 with an empty array

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `GET /api/v1/authors`
- **THEN** the system returns 401 Unauthorized

---

### Requirement: API exposes an author detail endpoint

The system SHALL provide a `GET /api/v1/authors/:id` endpoint that returns full details for a single author. The response SHALL include `id`, `name`, `hasCover` (boolean), `biography` (nullable), `goodreadsId` (nullable), and a `books` array. Each book entry SHALL include `id`, `title`, `hasCover` (boolean), `coverUpdatedAt` (string), and `formats` (array of format strings). The books SHALL be ordered by title ascending. The endpoint SHALL return 404 if the author id does not exist. The endpoint SHALL be protected by `JwtAuthGuard`.

#### Scenario: Returns author detail with books

- **WHEN** an authenticated user sends `GET /api/v1/authors/:id` for an existing author
- **THEN** the response is 200 with `id`, `name`, `hasCover`, `biography`, `goodreadsId`, and `books` array ordered by title

#### Scenario: Returns 404 for unknown author

- **WHEN** an authenticated user sends `GET /api/v1/authors/:id` with an id that does not exist
- **THEN** the system returns 404 Not Found

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `GET /api/v1/authors/:id`
- **THEN** the system returns 401 Unauthorized

---

### Requirement: API exposes an author photo endpoint

The system SHALL provide a `GET /api/v1/authors/:id/photo` endpoint that streams the stored `photoData` bytes as `image/jpeg`. The endpoint SHALL NOT require authentication (browser `<img>` tag compatibility). The response SHALL include a `Cache-Control: public, max-age=31536000` header. The endpoint SHALL return 404 if the author has no photo.

#### Scenario: Returns photo bytes for author with photo

- **WHEN** any client sends `GET /api/v1/authors/:id/photo` for an author with stored photo data
- **THEN** the system returns 200 with `Content-Type: image/jpeg` and the photo bytes

#### Scenario: Returns 404 when no photo stored

- **WHEN** any client sends `GET /api/v1/authors/:id/photo` for an author without photo data
- **THEN** the system returns 404 Not Found

---

### Requirement: Authors page lists all authors alphabetically

The system SHALL provide an `/authors` route in the web frontend displaying all authors returned by `GET /api/v1/authors` as a grid of cards. Each card SHALL show the author photo (from `/api/v1/authors/:id/photo` when `hasCover` is true) or a placeholder avatar, the author name, and the book count. The page SHALL be accessible via an **Authors** link in the sidebar navbar. The page SHALL support a text field to filter visible cards by author name (case-insensitive, client-side).

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

- **WHEN** an authenticated user types in the filter field on the `/authors` page
- **THEN** only author cards whose names contain the typed string (case-insensitive) are shown

---

### Requirement: Author detail modal shows biography, Goodreads link, and owned books

The system SHALL open a modal when an author card is clicked. The modal SHALL display the author photo (or placeholder), name, biography (or "No biography available" if null), a "View on Goodreads" link when `goodreadsId` is non-null, and an ordered list of all owned books. Each book entry SHALL show the cover thumbnail, title, and be clickable to open the `BookDetailModal`. Admin users SHALL see an "Enrich Author Data" button that triggers `POST /api/v1/authors/:id/enrich`.

#### Scenario: Author detail modal opens on card click

- **WHEN** an authenticated user clicks an author card on the `/authors` page
- **THEN** a modal opens showing the author photo, name, biography, optional Goodreads link, and list of their books

#### Scenario: Book entry opens BookDetailModal

- **WHEN** an authenticated user clicks a book entry inside the author detail modal
- **THEN** the `BookDetailModal` opens for that book

#### Scenario: Placeholder shown when author has no photo

- **WHEN** the author detail modal opens for an author with `hasCover: false`
- **THEN** a placeholder avatar is shown in place of the photo

#### Scenario: Empty biography message

- **WHEN** the author detail modal opens for an author whose `biography` is null
- **THEN** the modal displays "No biography available"

#### Scenario: Goodreads link shown when ID is present

- **WHEN** the author detail modal opens for an author with a non-null `goodreadsId`
- **THEN** a "View on Goodreads" link is shown pointing to `https://www.goodreads.com/author/show/<goodreadsId>`

#### Scenario: Enrich button visible to admins only

- **WHEN** an admin user opens the author detail modal
- **THEN** an "Enrich Author Data" button is visible; non-admin users do not see it
