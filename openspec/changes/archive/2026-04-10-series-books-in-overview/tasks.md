## 1. API — Add series id to book detail response

- [x] 1.1 Add `id: string` field to `BookSeriesDto` in `apps/api/src/books/book-detail.dto.ts` with `@ApiProperty()`
- [x] 1.2 Update `books.service.ts` to include `series.id` when mapping the series relation onto the book detail response

## 2. Frontend types

- [x] 2.1 Add `id: string` to the `series` object in the `BookDetail` interface in `apps/web/src/components/BookDetailModal.types.ts`

## 3. Series page — seriesId query param auto-open

- [x] 3.1 In `SeriesPage.tsx`, read the `seriesId` query param from the URL on mount (via `useSearchParams`) and set it as the `activeSeriesId` so `SeriesDetailModal` opens automatically

## 4. OverviewTab — "View Series" button

- [x] 4.1 In `OverviewTab.tsx`, add a `onViewSeries` callback prop (fired with the series id) to the `OverviewTabProps` interface
- [x] 4.2 Render a "View Series" `Button` (or `Anchor`) near the series detail row, visible only when `detail.series?.id` is set, that calls `onViewSeries`
- [x] 4.3 In `BookDetailModal.tsx`, wire the `onViewSeries` callback: close the modal, then `navigate('/series?seriesId=<id>')`

## 5. OverviewTab — "In This Series" section

- [x] 5.1 In `OverviewTab.tsx`, fetch `GET /api/v1/series/:id` when `detail.series?.id` is present; store result in local state
- [x] 5.2 Do not render the section if the series has only one book (the current book itself)
- [x] 5.3 Render an "In This Series" heading and a horizontally-scrollable `ScrollArea` containing a `Group` of `BookCard` components, one per series book, ordered by sequence
- [x] 5.4 Pass the minimum required props to each `BookCard` (`id`, `title`, `authors`, `hasCover`, `coverUpdatedAt`, `formats`); default `hasFileMissing` to `false`, `rating` and `readingProgress` to `null`, `readStatus` to `null`
- [x] 5.5 Wrap the current book's `BookCard` in a `Box` with a colored border/ring highlight and a small "You are here" or sequence-number `Badge` overlaid at the top
- [x] 5.6 Wire each sibling book card's `onClick` to open the `BookDetailModal` for that book (pass an `onOpenBook` callback prop from the parent, or reuse the existing modal open mechanism)
