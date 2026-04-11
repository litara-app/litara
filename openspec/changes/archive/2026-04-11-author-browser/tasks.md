## 1. Database

- [x] 1.1 Add `photoData Bytes?` to the `Author` model in `apps/api/prisma/schema.prisma`
- [x] 1.2 Run `npx prisma migrate dev --name add-author-photo-data` and commit the generated migration

## 2. API — Author list and detail endpoints

- [x] 2.1 Create `apps/api/src/authors/` module directory; scaffold `authors.module.ts`, `authors.controller.ts`, `authors.service.ts`, `author-list.dto.ts`, `author-detail.dto.ts`
- [x] 2.2 In `authors.service.ts`, implement `findAll()`: query all `Author` records that have at least one `BookAuthor` entry, returning `id`, `name`, `hasCover` (derived from `photoData != null`), and `bookCount`, ordered by `name ASC`
- [x] 2.3 In `authors.service.ts`, implement `findOne(id)`: query a single `Author` with its books (via `BookAuthor → Book → BookFile`), returning `id`, `name`, `hasCover`, `biography`, and `books[]` ordered by title; throw `NotFoundException` if not found
- [x] 2.4 In `authors.controller.ts`, add `GET /authors` (list) and `GET /authors/:id` (detail) routes protected by `JwtAuthGuard`; decorate with `@ApiBearerAuth()` and Swagger decorators
- [x] 2.5 In `authors.controller.ts`, add `GET /authors/:id/photo` that reads `photoData` from the DB and streams it as `image/jpeg` (same pattern as `GET /books/:id/cover`)
- [x] 2.6 Register `AuthorsModule` in `AppModule`

## 3. API — Author photo enrichment endpoints

- [x] 3.1 In `authors.service.ts`, implement `enrichOne(id, force)`: search Open Library for an exact name match (`GET https://openlibrary.org/search/authors.json?q=<name>`), download image bytes from `https://covers.openlibrary.org/a/olid/<key>-M.jpg`, store in `photoData`; skip if `photoData` already set and `!force`; return updated author
- [x] 3.2 In `authors.service.ts`, implement `enrichAll(force)`: create a `Task` record, then iterate authors (skip already-enriched unless `force`), calling `enrichOne` per author with a 200 ms inter-request delay; update the `Task` on completion
- [x] 3.3 In `authors.controller.ts`, add `POST /authors/enrich` (bulk — creates Task, returns 202) and `POST /authors/:id/enrich` (single — synchronous, returns 200 with updated author data); both protected by `JwtAuthGuard`; support `?force=true` query param

## 4. Frontend types

- [x] 4.1 Create `apps/web/src/components/AuthorDetailModal.types.ts` with `AuthorListItem` interface (`id`, `name`, `hasCover: boolean`, `bookCount: number`) and `AuthorDetail` interface (`id`, `name`, `hasCover`, `biography: string | null`, `books[]`)

## 5. Frontend — Authors page

- [x] 5.1 Create `apps/web/src/pages/AuthorsPage.tsx`: fetch `GET /api/v1/authors`, render an alphabetical grid of author cards
- [x] 5.2 Each author card shows the portrait (from `/api/v1/authors/:id/photo` when `hasCover` is true) or a placeholder `<IconUser>` avatar, the author name, and the book count (e.g. "4 books")
- [x] 5.3 Add a text input above the grid that filters visible cards by name (case-insensitive, client-side)
- [x] 5.4 Add an empty-state message when no authors are returned

## 6. Frontend — Author detail modal

- [x] 6.1 Create `apps/web/src/components/AuthorDetailModal.tsx`: fetch `GET /api/v1/authors/:id` on open, display photo (`/api/v1/authors/:id/photo`) or placeholder, name, biography (or "No biography available"), and scrollable book list
- [x] 6.2 Each book row shows the cover thumbnail, title, and is clickable to open `BookDetailModal`
- [x] 6.3 Wire `AuthorDetailModal` into `AuthorsPage`: clicking an author card sets `activeAuthorId` state and opens the modal

## 7. Frontend — Navbar and routing

- [x] 7.1 Add `/authors` route to the React Router config (alongside existing `/series`, `/library`, etc.)
- [x] 7.2 Add an "Authors" `NavLink` entry to the sidebar navbar (with an appropriate tabler icon, e.g. `IconUsers`)

## 8. Frontend — Admin enrichment trigger

- [x] 8.1 In `AuthorDetailModal`, add an "Enrich Photo" button (admin-visible) that calls `POST /api/v1/authors/:id/enrich` and refreshes the modal on success
- [x] 8.2 On `AuthorsPage`, add an "Enrich All Authors" button (admin-visible) that calls `POST /api/v1/authors/enrich` and shows a toast confirming the background task was queued
