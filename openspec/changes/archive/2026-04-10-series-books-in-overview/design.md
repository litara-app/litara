## Context

The `BookDetailModal` `OverviewTab` displays a "Series" field in the Details card, but it is read-only text and provides no navigation. The `BookDetail.series` type currently holds only `{ name, sequence, totalBooks }` — no `id`. The Series page at `/series` renders `SeriesDetailModal` by series ID, and the `GET /api/v1/series/:id` endpoint already returns all sibling books in sequence order with cover data. No backend endpoint or database changes are needed beyond adding the series `id` to the book detail response.

## Goals / Non-Goals

**Goals:**

- Add `series.id` to `BookSeriesDto` (API) and `BookDetail.series` (frontend type).
- Make the Series detail row in the Overview tab a clickable anchor that opens `SeriesDetailModal`.
- Append an "In This Series" section to `OverviewTab` that fetches and displays sibling books when a series `id` is available.
- Visually highlight the current book within that series row.
- Reuse `BookCard` for sibling book rendering.

**Non-Goals:**

- Changes to the series page layout or series list behavior.
- Pagination of series books (all books in a series will be shown — series are typically ≤ 20 books).
- Any new API endpoint.

## Decisions

### D1: Add `series.id` in `BookSeriesDto`

The frontend needs the series `id` to call `GET /api/v1/series/:id`. Adding it directly to the existing `BookSeriesDto` is the lowest-friction approach. The books service already has access to the `SeriesBook` join which includes the `series.id`. Alternative considered: derive the series ID via a new `GET /api/v1/books/:id/series` endpoint — rejected as unnecessary round-trip.

### D2: Fetch series books from `OverviewTab` itself

The `OverviewTab` will call `GET /api/v1/series/:id` on mount when `detail.series?.id` is present. This keeps the fetch co-located with its display and avoids threading extra props or state through `BookDetailModal`. The data is cheap (small JSON array) so no caching layer is needed.

### D3: Reuse `BookCard` with a forced small size

`BookCard` already renders cover, title, format badges, reading progress, and hover actions. It will be used inside a `SimpleGrid` with a forced narrow column width (`140px`) rather than the full-page adaptive grid. Props like `hasFileMissing`, `readingProgress`, and `rating` are not available from the series detail response; they will be set to safe defaults (`false`, `null`, `null`). The series detail DTO already returns `hasCover`, `coverUpdatedAt`, `formats`, `id`, and `title` — enough to populate `BookCard`.

### D4: Current-book highlight via a wrapper

Rather than modifying `BookCard`, the current book will be wrapped in a `Box` with a colored outline/ring and a small `Badge` (e.g. "This book") overlaid on top of the card. This keeps `BookCard` unchanged.

### D5: "View Series" button navigates to the Series page

The Overview tab will render a "View Series" button/link beneath (or alongside) the series detail row. Clicking it closes the book modal and navigates to `/series?seriesId=<id>`, where the Series page reads the query param on mount and auto-opens `SeriesDetailModal` for that series. This makes the context switch explicit — the user sees a clear affordance that they are leaving the book modal.

The series detail row text itself remains plain (non-clickable) so there is no ambiguity between "see info about this book's series position" (the detail row) and "go to the series page" (the button).

**Alternative considered**: Open `SeriesDetailModal` inline inside the book modal. Rejected — the user explicitly wants to leave the book modal context, and a "View Series" button communicates that transition clearly.

## Risks / Trade-offs

- **Missing fields on BookCard**: `readingProgress`, `rating`, `hasFileMissing`, `readStatus`, `goodreadsRating` are not available from the series detail endpoint. These will be defaulted to `null`/`false`. Quick actions (read, rate) will still work. → Acceptable; the series strip is a discovery surface, not a full management view.
- **Series with many books**: A series with 30+ books will render a wide horizontal scroll area. This is fine — Mantine's `ScrollArea` with `type="scroll"` handles it cleanly.
- **Series ID null edge-case**: If a book was serialized before the `id` field is added, `series.id` may be absent in cached responses. The "In This Series" section simply won't render in that case (guarded by `series?.id`).

## Migration Plan

1. Add `id` field to `BookSeriesDto` (API).
2. Update `books.service.ts` to include `series.id` in the response.
3. Update `BookDetail.series` type on the frontend.
4. Update `OverviewTab` — clickable series row + "In This Series" section.
5. No database migration, no deployment ordering requirement.
