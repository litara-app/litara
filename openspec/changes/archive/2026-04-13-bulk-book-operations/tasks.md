## 1. State Management

- [x] 1.1 Add `selectedBookIdsAtom` (`atom<Set<string>>(new Set())`) and `isSelectModeAtom` (derived: `atom(get => get(selectedBookIdsAtom).size > 0)`) to `apps/web/src/store/atoms.ts`
- [x] 1.2 In `AppLayout`, add a `useEffect` that clears `selectedBookIdsAtom` on route change using `useLocation`

## 2. BookCard Multi-Select UI

- [x] 2.1 Add `isSelected` and `onToggleSelect` optional props to `BookCard`; render an absolute-positioned Mantine `Checkbox` overlay on the top-left when `isSelectMode` is true
- [x] 2.2 When `isSelectMode` is true, change card click handler to call `onToggleSelect` instead of `onBookClick`
- [x] 2.3 Add `isSelectMode`, `selectedIds`, and `onToggleSelect` props to `BookGrid`; wire them down to each `BookCard`

## 3. Select Mode Toolbar Controls

- [x] 3.1 Add a "Select" toggle button to the toolbar/header area of `AllBooksPage`, `LibraryPage`, `ShelfPage`, and `SmartShelfPage` that enters select mode (sets a local `isSelectingAtom` or sets one dummy book to trigger `isSelectModeAtom`)
- [x] 3.2 Add "Select All" and count display controls to each page toolbar when `isSelectMode` is true; implement Select All / deselect all logic against the current book list
- [x] 3.3 Clear selection when the user changes filters, sort order, or library/shelf ID (add `useEffect` with relevant deps in each page)

## 4. BulkActionBar Component

- [x] 4.1 Create `apps/web/src/components/BulkActionBar.tsx` — a fixed-bottom bar that reads `selectedBookIdsAtom`; renders selected count, action buttons, and a "Clear" button
- [x] 4.2 Implement "Mark as Read" and "Mark as Unread" action buttons in `BulkActionBar` calling the bulk reading-progress endpoint
- [x] 4.3 Implement "Add to Shelf" button with a popover listing available shelves (sourced from existing shelves atom); calls bulk add endpoint
- [x] 4.4 Implement "Remove from Shelf" button (visible only on Shelf/SmartShelf pages); calls bulk remove endpoint
- [x] 4.5 Implement "Change Status" button with a popover for want-to-read / reading / read; calls bulk status endpoint
- [x] 4.6 Implement "Delete" button: show Mantine confirmation modal with book count, then call bulk delete endpoint; clear selection and refetch on success
- [x] 4.7 Render `BulkActionBar` in `AppLayout` (or a shared layout component) so it appears on all book list pages

## 5. API — Batch Books Endpoints

- [x] 5.1 Create `BulkBooksDto` in `apps/api/src/books/dto/` with `bookIds: string[]`
- [x] 5.2 Create `BulkStatusDto` extending `BulkBooksDto` with `status: string` field
- [x] 5.3 Create `BulkReadingProgressDto` extending `BulkBooksDto` with `action: 'mark-read' | 'mark-unread'` field
- [x] 5.4 Add `patchBulkReadingProgress(userId, dto)` to `BooksService` (or `ReadingProgressService`): upsert/delete `ReadingProgress` records in a Prisma transaction
- [x] 5.5 Add `patchBulkStatus(userId, dto)` to `BooksService`: `updateMany` where `id in bookIds AND ownerId == userId`
- [x] 5.6 Add `deleteBulk(userId, dto)` to `BooksService`: delete books and their files where `id in bookIds AND ownerId == userId`
- [x] 5.7 Register `PATCH /books/bulk-reading-progress`, `PATCH /books/bulk-status`, and `DELETE /books/bulk` routes on `BooksController` with JWT guard, `@ApiBearerAuth()`, and Swagger decorators

## 6. API — Batch Shelf Endpoints

- [x] 6.1 Add `postBulkBooks(shelfId, dto, userId)` to `ShelvesService`: `createMany` shelf memberships skipping duplicates
- [x] 6.2 Add `deleteBulkBooks(shelfId, dto, userId)` to `ShelvesService`: `deleteMany` shelf memberships
- [x] 6.3 Register `POST /shelves/:id/books/bulk` and `DELETE /shelves/:id/books/bulk` on `ShelvesController` with JWT guard, `@ApiBearerAuth()`, and Swagger decorators

## 7. Frontend API Integration

- [x] 7.1 Add `bulkMarkRead`, `bulkMarkUnread`, `bulkChangeStatus`, `bulkDelete` functions to a `books` API utility (or inline in the component hooks)
- [x] 7.2 Add `bulkAddToShelf` and `bulkRemoveFromShelf` functions to a `shelves` API utility
- [x] 7.3 After each successful bulk action, invalidate/refetch the book list in the current view and clear selection

## 8. Verification

- [x] 8.1 Run `npm run build` from repo root and confirm no TypeScript errors
- [ ] 8.2 Manually verify multi-select, bulk mark-read, add-to-shelf, and bulk-delete flows in the browser across All Books, Library, and Shelf pages
