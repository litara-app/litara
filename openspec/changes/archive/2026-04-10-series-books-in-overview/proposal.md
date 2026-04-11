## Why

The book detail Overview tab shows a "Series" field but gives no way to explore the rest of the series from that context. Users who want to see related books must leave the modal entirely and navigate to the Series page, breaking their browsing flow.

## What Changes

- A "View Series" button appears in the Overview tab when the book belongs to a series. Clicking it closes the book modal and navigates to `/series`, auto-opening the `SeriesDetailModal` for that series via a `seriesId` query param.
- A new "In This Series" section is appended to the bottom of the Overview tab when the book belongs to a series. It displays all books in the series (ordered by sequence) as a horizontally-scrollable row of book cards. The current book is visually highlighted with a badge or border so users know where they are in the sequence.
- The book detail API response (`GET /api/v1/books/:id`) must include the series `id` so the frontend can call `GET /api/v1/series/:id` to load the sibling books.
- The `BookCard` component will be reused for each series book with a fixed/forced small size to fit within the row layout.

## Capabilities

### New Capabilities

- `series-in-overview`: Display all books in a series at the bottom of the book modal Overview tab, with current-book highlight and a clickable link to the series detail modal.

### Modified Capabilities

- `series-browser`: The Series page must read a `seriesId` query param on mount and auto-open `SeriesDetailModal` for that series, so the "View Series" navigation from the book modal lands with the correct series already open.

## Impact

- **`apps/api`**: `GET /api/v1/books/:id` response DTO — add `series.id` field.
- **`apps/web`**: `BookDetail` type — add `series.id`. `OverviewTab` component — add "In This Series" section and clickable series link. `BookDetailModal` (or its parent) — may need to render `SeriesDetailModal` alongside for the click-through.
- **No new API endpoints required** — the existing `GET /api/v1/series/:id` provides the full book list.
- **No database migrations** required.
