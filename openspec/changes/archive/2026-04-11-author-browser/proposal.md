## Why

The library already organises books by series, but there is no author-centric view. Users cannot browse by author, see an author's full catalogue in the library, or get a sense of who the authors are. Adding an Authors page brings Litara in line with other library managers and makes discovery more natural.

## What Changes

- Add a **navbar link** for Authors, navigating to `/authors`
- New `/authors` page: alphabetically-sorted grid of all authors with optional portrait photos
- Clicking an author opens an **Author Detail** modal showing biography and all owned books
- New API endpoints: `GET /api/v1/authors` (list) and `GET /api/v1/authors/:id` (detail + books)
- Add `photoUrl` and `biography` storage to the `Author` DB model (biography already exists; `photoUrl` is new)
- New **author photo enrichment** background task that fetches author portraits from free public sources and caches them locally
- Photo sources to try in order: **Open Library** (free cover API, no key required), **Wikipedia/Wikidata** (free image API, no key required); Goodreads has no accessible public API and will be excluded
- Enrichment is triggered manually via an "Enrich Authors" button (admin) and runs per-author or in bulk

## Capabilities

### New Capabilities

- `author-browser`: Author list page and author detail modal — alphabetical grid, portrait display, per-author book list
- `author-photo-enrichment`: Background task that resolves author portraits from Open Library and Wikipedia/Wikidata and stores the URL on the `Author` record

### Modified Capabilities

<!-- None — no existing spec-level requirements change -->

## Impact

- **Database**: Add `photoUrl String?` column to the `Author` model → new Prisma migration
- **API**: New `AuthorsModule` with controller + service; two new protected endpoints
- **Frontend**: New `AuthorsPage` component, `AuthorDetailModal` component, navbar entry
- **Dependencies**: No new packages required (Open Library and Wikipedia are plain HTTP; existing `axios` suffices)
