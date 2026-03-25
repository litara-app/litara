## ADDED Requirements

### Requirement: API exposes a series list endpoint

The system SHALL provide a `GET /api/v1/series` endpoint that returns all series that have at least one associated book in the library. Each item SHALL include the series id, name, total books owned (count of `SeriesBook` entries), the `totalBooks` field from the `Series` model (expected total, may be null), a `coverBookIds` array containing the ids of up to 3 lowest-sequence books that have cover data (for use with the existing cover endpoint), and a deduplicated list of author names across all books in the series. The endpoint SHALL be protected by `JwtAuthGuard`. Results SHALL be ordered by series name ascending.

#### Scenario: Returns series with aggregated data including cover book ids

- **WHEN** an authenticated user sends `GET /api/v1/series` and the library contains books belonging to at least one series
- **THEN** the response is 200 with an array where each item has `id`, `name`, `ownedCount`, `totalBooks` (nullable), `coverBookIds` (array of 1–3 book ids), and `authors` (string array)

#### Scenario: Returns empty array when no series exist

- **WHEN** an authenticated user sends `GET /api/v1/series` and no books have series metadata
- **THEN** the response is 200 with an empty array

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `GET /api/v1/series`
- **THEN** the system returns 401 Unauthorized

---

### Requirement: API exposes a series detail endpoint

The system SHALL provide a `GET /api/v1/series/:id` endpoint that returns the full detail for a single series. The response SHALL include the series `id`, `name`, `totalBooks` (nullable), all author names (deduplicated union across all books), and an ordered list of books in the series. Each book entry SHALL include `id`, `title`, `sequence` (nullable), `hasCover` (boolean), and `format` of the first available `BookFile`. The books SHALL be ordered by `sequence ASC NULLS LAST`, then by `createdAt ASC`. The endpoint SHALL be protected by `JwtAuthGuard`.

#### Scenario: Returns series detail with books in sequence order

- **WHEN** an authenticated user sends `GET /api/v1/series/:id` for a series with multiple books
- **THEN** the response is 200 with `id`, `name`, `totalBooks`, `authors`, and `books` array ordered by sequence

#### Scenario: Returns 404 for unknown series

- **WHEN** an authenticated user sends `GET /api/v1/series/:id` with an id that does not exist
- **THEN** the system returns 404 Not Found

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `GET /api/v1/series/:id`
- **THEN** the system returns 401 Unauthorized

---

### Requirement: Series page lists all series in the library

The system SHALL provide a `/series` route in the web frontend that displays all series returned by `GET /api/v1/series` as a grid of cards. Each card SHALL show a splayed cover stack using up to 3 cover images from `coverBookIds` (each fetched via `/api/v1/books/:id/cover`), rendered as slightly rotated and offset layers to visually communicate a collection. The card SHALL also show the series name, the primary author(s), and an owned/total progress indicator (e.g. "3 of 5" or "3 books" if total is unknown). The page SHALL be accessible via a **Series** link in the sidebar navbar.

#### Scenario: Series page displays all series

- **WHEN** an authenticated user navigates to `/series`
- **THEN** the page shows a card for each series in the library with name, cover, author(s), and progress

#### Scenario: Empty state when no series exist

- **WHEN** an authenticated user navigates to `/series` and no books have series metadata
- **THEN** the page shows an empty-state message

#### Scenario: Series link is present in the navbar

- **WHEN** an authenticated user views any page
- **THEN** the sidebar navbar contains a "Series" link that navigates to `/series`

---

### Requirement: Series detail modal shows all books in the series

The system SHALL show a modal when a series card is clicked. The modal SHALL display the series name, all authors, the owned/total count, and a list of all books in the series ordered by sequence. Each book entry in the list SHALL show its cover thumbnail, sequence number (if available), title, and be clickable to open the existing `BookDetailModal` for that book.

#### Scenario: Series detail modal opens on card click

- **WHEN** an authenticated user clicks a series card on the `/series` page
- **THEN** a modal opens showing the series name, authors, book count, and ordered book list

#### Scenario: Book entry in modal opens BookDetailModal

- **WHEN** an authenticated user clicks a book entry inside the series detail modal
- **THEN** the `BookDetailModal` opens for that book (the series detail modal may remain open behind it or close — implementation choice)

#### Scenario: Books without sequence numbers are shown last

- **WHEN** the series contains books with null sequence values
- **THEN** those books appear at the end of the list, after all sequenced books
