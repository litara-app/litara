## 1. Backend — DTOs and Service

- [x] 1.1 Create `apps/api/src/series/dto/series-list-item.dto.ts` with `SeriesListItemDto` (id, name, ownedCount, totalBooks nullable, coverBookIds string array of up to 3, authors string array)
- [x] 1.2 Create `apps/api/src/series/dto/series-detail.dto.ts` with `SeriesDetailDto` (id, name, totalBooks nullable, authors, books array with id/title/sequence/hasCover/format)
- [x] 1.3 Create `apps/api/src/series/series.service.ts` with `findAll()` — query all Series with at least one SeriesBook, aggregate ownedCount, collect up to 3 coverBookIds from lowest-sequence books that have coverData, union authors; order by name ASC
- [x] 1.4 Add `findOne(id)` to `SeriesService` — return full series detail with books ordered by sequence ASC NULLS LAST then createdAt ASC; throw 404 if not found

## 2. Backend — Controller and Module

- [x] 2.1 Create `apps/api/src/series/series.controller.ts` with `GET /series` and `GET /series/:id`, both guarded by `JwtAuthGuard`; add `@ApiBearerAuth()` and Swagger decorators
- [x] 2.2 Create `apps/api/src/series/series.module.ts` importing `DatabaseModule`, providing `SeriesService`, declaring `SeriesController`
- [x] 2.3 Register `SeriesModule` in `AppModule`

## 3. Backend — Tests

- [x] 3.1 Create `apps/api/test/helpers/series.helper.ts` with `seedOzSeries(db)` — creates Series "Oz" (totalBooks: 14), Author "L. Frank Baum", Library, and 2 Books (`The Wonderful Wizard of Oz` seq 1, `The Tin Woodman of Oz` seq 12) with BookAuthor and SeriesBook records
- [x] 3.2 Create `apps/api/test/series.e2e-spec.ts` covering: list returns Oz series with correct aggregated data, detail returns books in sequence order, detail returns 404 for unknown id, list returns 401 without token

## 4. Frontend — Series Page

- [x] 4.1 Create `apps/web/src/pages/SeriesPage.tsx` — fetches `GET /api/v1/series`, renders a responsive grid of series cards; each card shows a splayed cover stack (up to 3 covers from `coverBookIds`, slightly rotated/offset via CSS transforms), series name, author(s), and owned/total count; empty state if no series
- [x] 4.2 Create `apps/web/src/components/SeriesDetailModal.tsx` — accepts `seriesId` prop; fetches `GET /api/v1/series/:id`; renders series name, authors, book count, and a scrollable list of books ordered by sequence; each book row shows thumbnail, sequence badge (if present), and title; clicking a book opens `BookDetailModal`
- [x] 4.3 Wire `SeriesDetailModal` into `SeriesPage` — clicking a card sets active series id and opens the modal

## 5. Frontend — Navigation

- [x] 5.1 Add `SeriesPage` route at `/series` in `apps/web/src/App.tsx`
- [x] 5.2 Add "Series" `NavLink` to `apps/web/src/components/AppLayout/NavbarContent.tsx` between Books and Shelves, using `IconTimeline` or `IconBooks` icon

## 6. Documentation

- [x] 6.1 Add "Series" screenshot capture test to `apps/web/e2e/screenshots/capture.spec.ts` — navigate to `/series`, wait for cards, screenshot
