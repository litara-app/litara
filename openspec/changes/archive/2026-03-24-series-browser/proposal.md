## Why

Litara already stores series metadata on books (series name, sequence number, total books) but there is no dedicated UI to browse or explore series as a collection. Users have no way to see all series in their library at a glance, find which books in a series they own, or navigate by series — a core reading workflow for fiction readers.

## What Changes

- Add a **Series** page (`/series`) listing all series in the library as cards with cover art, author, and progress count (e.g. "3 of 5").
- Add a **Series nav link** in the sidebar alongside Books, Libraries, and Shelves.
- Add a **Series Detail Modal** that opens when a series card is clicked, showing all books in the series with their sequence numbers, a combined author list, and the full series description if available.
- Books in the series detail modal are clickable and open the existing `BookDetailModal`.
- Add a **copyright-free series fixture** to the e2e test suite (Project Gutenberg public domain works organised as a series in test data).

## Capabilities

### New Capabilities

- `series-browser`: Series list page, series detail modal, series navigation — browsing series as a first-class entity in the library.

### Modified Capabilities

- `e2e-test-suite`: Add copyright-free series seed data and series-browser test scenarios.

## Impact

- **Frontend**: New `SeriesPage` component, `SeriesDetailModal` component, navbar entry in `NavbarContent`.
- **Backend**: New `GET /series` endpoint (list all series with book count and cover art hint), new `GET /series/:id` endpoint (series with full book list). The `Series` and `SeriesBook` Prisma models already exist — no schema migration needed.
- **Tests**: New e2e spec and copyright-free series seed data using Project Gutenberg public domain titles (e.g. the "Oz" books by L. Frank Baum — all public domain).
