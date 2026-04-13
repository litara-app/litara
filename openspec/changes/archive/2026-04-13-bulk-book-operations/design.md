## Context

The app has four book list views — All Books (`AllBooksPage`), Library (`LibraryPage`), Shelf (`ShelfPage`), and Smart Shelf (`SmartShelfPage`) — all of which render books through the shared `BookGrid` / `BookCard` component tree. State is managed with Jotai atoms defined in `apps/web/src/store/atoms.ts`. The API follows NestJS REST conventions with JWT-guarded controllers; existing single-book mutations live on `PATCH /api/v1/books/:id`.

There is no existing selection mechanism anywhere in the UI. The backend has no batch endpoints today.

## Goals / Non-Goals

**Goals:**

- Allow selecting any subset of books across all four list views via click or keyboard
- Show a persistent `BulkActionBar` with available actions when ≥1 book is selected
- Implement actions: Mark as Read, Mark as Unread, Add to Shelf, Remove from Shelf, Change Status (want-to-read / reading / read), Delete Books
- New batch API endpoints to execute these actions atomically server-side
- Selection state lives in a global Jotai atom and is cleared on view change

**Non-Goals:**

- Cross-page / cross-pagination selection ("select all 500 books")
- Drag-and-drop reordering
- Undo/redo for bulk actions
- Bulk metadata editing (title, author, etc.)

## Decisions

### 1. Global Jotai atom for selection state

**Decision:** Store `Set<string>` of selected book IDs in `selectedBookIdsAtom` in `atoms.ts`. Add a derived `isSelectModeAtom` (true when set is non-empty).

**Rationale:** Selection must be accessible from both `BookGrid` (toggle) and `BulkActionBar` (read + act). A module-level atom avoids prop drilling through all four page → BookGrid → BookCard chains. Clearing on route change is handled with a `useEffect` in `AppLayout`.

**Alternative considered:** React Context — ruled out because it requires wrapping every page and adds boilerplate; Jotai is already in use.

### 2. Overlay checkbox on BookCard

**Decision:** When `isSelectMode` is true (or on hover), render a Mantine `Checkbox` overlay on the top-left corner of each `BookCard`. Clicking the card body in select mode toggles selection instead of opening the detail modal.

**Rationale:** Familiar pattern (Google Photos, Calibre Web). No new layout is needed — absolute-positioned overlay works within the existing card grid.

### 3. BulkActionBar as a fixed bottom bar

**Decision:** Render `BulkActionBar` as a fixed-bottom strip (above any pagination) that slides in when `isSelectMode` is true. It shows selected count, action buttons, and a "Clear" button.

**Rationale:** Fixed position ensures the bar is visible regardless of scroll position. Slide-in animation prevents layout shift.

### 4. Batch API endpoints

**Decision:** Add the following endpoints to existing controllers:

| Endpoint                                    | Body                                                          | Effect                              |
| ------------------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| `PATCH /api/v1/books/bulk-status`           | `{ bookIds: string[], status: string }`                       | Update `readingStatus` on all books |
| `PATCH /api/v1/books/bulk-reading-progress` | `{ bookIds: string[], action: 'mark-read' \| 'mark-unread' }` | Upsert reading progress records     |
| `POST /api/v1/shelves/:id/books/bulk`       | `{ bookIds: string[] }`                                       | Add books to shelf                  |
| `DELETE /api/v1/shelves/:id/books/bulk`     | `{ bookIds: string[] }`                                       | Remove books from shelf             |
| `DELETE /api/v1/books/bulk`                 | `{ bookIds: string[] }`                                       | Delete books                        |

**Rationale:** Keeping operations on their natural resource controllers avoids a generic "bulk action" endpoint that would conflate unrelated concerns. NestJS body-on-DELETE is acceptable for bulk deletes (avoids URL length limits).

**Alternative considered:** A single `POST /api/v1/bulk-actions` dispatch endpoint — rejected because it obscures semantics and complicates Swagger documentation.

### 5. Select All scoped to current page

**Decision:** "Select All" selects only the currently-rendered books (i.e., the current page/filter result), not all books in the DB.

**Rationale:** Selecting across pages would require tracking books the user has never seen, which creates confusing UX and requires fetching all IDs server-side. Page-scoped selection is predictable and sufficient for the primary use cases.

## Risks / Trade-offs

- **Stale selection after filter change** → Mitigation: Clear selection whenever the active filter/sort/library changes (watch relevant state in the page component and call `setSelectedBookIds(new Set())`).
- **Large batch deletes are irreversible** → Mitigation: Show a confirmation modal listing the count of books to be deleted before executing.
- **Shelf "Add to Shelf" requires knowing which shelves exist** → Mitigation: Reuse the existing shelf list already fetched by `AppLayout`; expose it via the existing `shelvesAtom` (or fetch on demand in the action popover).
- **BookCard click-area conflict in select mode** → Mitigation: When `isSelectMode` is active, wrap the entire card click in selection toggle logic; detail modal only opens when NOT in select mode.
