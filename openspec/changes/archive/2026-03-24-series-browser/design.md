## Context

The `Series` and `SeriesBook` Prisma models already exist and are populated during library scanning (series name and sequence are extracted from EPUB metadata). However there are no API endpoints to query series as a collection, and the frontend has no series-aware UI. The existing `BookDetailModal` already shows series membership on individual books but there is no way to navigate from there to other books in the same series.

The `Book` model has a `files` relation with cover data stored as BYTEA on `Book.coverData`. The existing `/books/:id/cover` endpoint can serve cover images — the series list will use a representative book's cover (the first book by sequence).

## Goals / Non-Goals

**Goals:**

- `GET /api/v1/series` — paginated list of all series with name, total owned books, expected total, and the ID of the first book (for cover art)
- `GET /api/v1/series/:id` — series detail with full book list (ordered by sequence), author names, and total/owned counts
- `SeriesPage` at `/series` — grid of series cards, each showing cover, name, author(s), and owned/total progress
- `SeriesDetailModal` — opens on card click; lists all books in sequence order with covers and sequence numbers; each book is clickable and opens `BookDetailModal`
- Navbar link for series (sidebar, between Books and Shelves)
- Copyright-free series e2e seed data (L. Frank Baum's Oz books — public domain in the US)

**Non-Goals:**

- Creating or editing series (series data comes from book metadata only)
- Series descriptions (not in the Prisma schema)
- Filtering/searching within the series page (can be added later)
- Infinite scroll / virtual list (series counts are expected to be manageable)

## Decisions

### 1. Two dedicated API endpoints rather than enriching the book list

**Decision:** Add `GET /series` and `GET /series/:id` rather than embedding series data in book queries.

**Rationale:** Series is a first-class browsing context. A dedicated endpoint returns pre-aggregated counts and the representative cover book ID cleanly, without client-side grouping. Avoids over-fetching book data just to build the series list.

**Alternative considered:** Client-side grouping from `/books` — rejected because it would require fetching all books and doesn't scale.

### 2. Cover art via splayed multi-book stack

**Decision:** Return up to 3 `coverBookIds` (lowest-sequence books that have cover data) from the series list endpoint. The frontend renders them as a fanned/splayed stack — each cover slightly rotated and offset behind the previous — to visually communicate that this is a collection.

**Rationale:** A single cover looks identical to a regular book card. The splay treatment immediately signals "series" to the reader and is a common convention in e-reader apps (e.g. Kindle, Apple Books). The cover endpoint `/books/:id/cover` already exists; the frontend just calls it up to 3 times per card. The API returns an ordered array `coverBookIds: string[]` (1–3 items) so the frontend has full control over the rendering.

**Alternative considered:** Single representative cover — rejected in favour of the splay for the reasons above. Dedicated series cover image — rejected as unnecessary complexity with no migration path.

### 3. No schema migration

**Decision:** `Series` and `SeriesBook` already exist; no changes needed.

**Rationale:** The models have all fields needed (`name`, `totalBooks`, `sequence`). Authors are reachable via `Series → SeriesBook → Book → BookAuthor → Author`.

### 4. Oz series for e2e seed data

**Decision:** Use L. Frank Baum's Oz books (14 novels, 1900–1920) as the copyright-free series fixture.

**Rationale:** Entirely public domain in the US, well-known, has a clear sequence order, multiple authors in later books (Ruth Plumly Thompson) can be ignored — stick to books 1–3 for simplicity (`The Wonderful Wizard of Oz`, `The Marvelous Land of Oz`, `Ozma of Oz`).

## Risks / Trade-offs

- **Series with no sequence numbers** → The API orders by `sequence ASC NULLS LAST` then `createdAt`. Books with null sequences render without a sequence badge.
- **Performance on large libraries** → The series list aggregates across `SeriesBook` joins. For very large libraries this could be slow. Mitigation: add a `LIMIT`/`OFFSET` pagination parameter from the start; add DB indexes on `SeriesBook.seriesId` (already a FK, should be indexed automatically by Prisma).
- **Duplicate author display** → Multiple books in a series can have different authors. The detail endpoint returns the union of all authors; the UI deduplicates by name.
