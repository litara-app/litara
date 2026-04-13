## Why

Managing large book libraries requires performing the same action on many books at once—today, users must open each book individually to mark it as read, add it to a shelf, or change its status. Bulk operations will dramatically reduce friction for common library management tasks.

## What Changes

- Add multi-select mode to all book grid/list views: All Books, Libraries, Shelves, and Smart Shelves
- Show a contextual action toolbar when one or more books are selected
- Support bulk actions: Mark as Read, Mark as Unread, Add to Shelf, Remove from Shelf, Change Status, Delete Books
- Add "Select All" and "Clear Selection" controls
- API endpoints to accept arrays of book IDs for batch operations

## Capabilities

### New Capabilities

- `book-multi-select`: UI mechanism for entering multi-select mode and selecting/deselecting books across all book list views (All Books, Library view, Shelf view, Smart Shelf view)
- `bulk-book-actions`: Contextual toolbar and action execution for bulk operations on a selected set of books (mark read/unread, add to shelf, remove from shelf, change status, delete)

### Modified Capabilities

- `reading-progress`: Bulk mark-as-read/unread requires a batch update path for reading progress records

## Impact

- **Frontend**: All book grid/list components need selection state; new `BulkActionBar` component; Jotai atom for selected book IDs
- **API**: New `PATCH /books/bulk` endpoint (or equivalent) for batch status/progress updates; `POST /shelves/:id/books/bulk` and `DELETE /shelves/:id/books/bulk` for shelf membership
- **State**: Global `selectedBookIds` atom in `atoms.ts`; selection cleared on view navigation
- **No new dependencies required**
