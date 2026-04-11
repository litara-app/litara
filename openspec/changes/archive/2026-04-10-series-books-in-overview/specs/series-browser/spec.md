## MODIFIED Requirements

### Requirement: Series page lists all series in the library

The system SHALL provide a `/series` route in the web frontend that displays all series returned by `GET /api/v1/series` as a grid of cards. Each card SHALL show a splayed cover stack using up to 3 cover images from `coverBookIds` (each fetched via `/api/v1/books/:id/cover`), rendered as slightly rotated and offset layers to visually communicate a collection. The card SHALL also show the series name, the primary author(s), and an owned/total progress indicator (e.g. "3 of 5" or "3 books" if total is unknown). The page SHALL be accessible via a **Series** link in the sidebar navbar. On mount, the page SHALL read a `seriesId` query parameter from the URL; if present, it SHALL automatically open the `SeriesDetailModal` for that series.

#### Scenario: Series page displays all series

- **WHEN** an authenticated user navigates to `/series`
- **THEN** the page shows a card for each series in the library with name, cover, author(s), and progress

#### Scenario: Empty state when no series exist

- **WHEN** an authenticated user navigates to `/series` and no books have series metadata
- **THEN** the page shows an empty-state message

#### Scenario: Series link is present in the navbar

- **WHEN** an authenticated user views any page
- **THEN** the sidebar navbar contains a "Series" link that navigates to `/series`

#### Scenario: seriesId query param auto-opens the series detail modal

- **WHEN** an authenticated user navigates to `/series?seriesId=<id>`
- **THEN** the `SeriesDetailModal` for that series opens automatically without requiring a card click
