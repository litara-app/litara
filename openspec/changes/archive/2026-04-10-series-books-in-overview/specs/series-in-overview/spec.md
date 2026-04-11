## ADDED Requirements

### Requirement: Book detail API includes series id

The `GET /api/v1/books/:id` response SHALL include an `id` field inside the `series` object when the book belongs to a series. The `id` SHALL be the primary key of the `Series` record. When the book has no series, `series` SHALL remain `null`.

#### Scenario: Series id is present in book detail response

- **WHEN** an authenticated user requests `GET /api/v1/books/:id` for a book that belongs to a series
- **THEN** the response `series` object includes `id`, `name`, `sequence` (nullable), and `totalBooks` (nullable)

#### Scenario: No series id when book has no series

- **WHEN** an authenticated user requests `GET /api/v1/books/:id` for a book with no series metadata
- **THEN** the response `series` field is `null`

---

### Requirement: Overview tab shows "In This Series" section

When the book detail Overview tab is displayed for a book that belongs to a series, the system SHALL fetch all books in that series via `GET /api/v1/series/:id` and render them as a horizontally-scrollable row of book cards at the bottom of the Overview tab. Books SHALL be displayed in sequence order (nulls last). The current book SHALL be visually distinguished from the other books in the row.

#### Scenario: Series books are displayed in sequence order

- **WHEN** a user opens the Overview tab for a book that belongs to a series
- **THEN** a section titled "In This Series" appears at the bottom showing all series books as cards, ordered by sequence

#### Scenario: Current book is highlighted in the series row

- **WHEN** the "In This Series" section is displayed
- **THEN** the card representing the currently-open book has a visible highlight (e.g. colored border or ring) distinguishing it from sibling books

#### Scenario: Section is absent for books without a series

- **WHEN** a user opens the Overview tab for a book that does not belong to a series
- **THEN** no "In This Series" section is shown

#### Scenario: Single-book series does not show the section

- **WHEN** a user opens the Overview tab for a book whose series contains only that one book
- **THEN** no "In This Series" section is shown

---

### Requirement: Overview tab provides "View Series" navigation

The Overview tab SHALL display a "View Series" button or link when the book belongs to a series. Clicking it SHALL close the book detail modal and navigate to `/series?seriesId=<id>`, where the Series page auto-opens the `SeriesDetailModal` for that series.

#### Scenario: "View Series" button is visible for books in a series

- **WHEN** a user opens the Overview tab for a book that belongs to a series
- **THEN** a "View Series" button or link is visible

#### Scenario: Clicking "View Series" navigates to the series page

- **WHEN** a user clicks "View Series" on the Overview tab
- **THEN** the book detail modal closes and the user is navigated to `/series` with the correct series pre-selected

#### Scenario: "View Series" is absent for books without a series

- **WHEN** a user opens the Overview tab for a book that does not belong to a series
- **THEN** no "View Series" button or link is shown
