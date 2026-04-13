## ADDED Requirements

### Requirement: BulkActionBar is visible when books are selected

The system SHALL display a persistent bottom action bar whenever one or more books are selected, showing the selected count and available bulk actions.

#### Scenario: Bar appears on first selection

- **WHEN** the user selects the first book
- **THEN** the BulkActionBar slides into view at the bottom of the screen
- **THEN** it displays the number of selected books (e.g., "3 books selected")

#### Scenario: Bar disappears when selection is cleared

- **WHEN** the selected book IDs set becomes empty
- **THEN** the BulkActionBar slides out of view

---

### Requirement: User can bulk mark books as read or unread

The system SHALL allow marking all selected books as read or unread in a single action, upserting a completed ReadingProgress record for each book.

#### Scenario: Mark selected books as read

- **WHEN** the user clicks "Mark as Read" in the BulkActionBar
- **THEN** a `PATCH /api/v1/books/bulk-reading-progress` request is sent with `{ bookIds, action: "mark-read" }`
- **THEN** a ReadingProgress record with `percentage: 100` and `completedAt` set to now is upserted for each selected book for the current user
- **THEN** the UI updates to reflect the new read state without a full page reload

#### Scenario: Mark selected books as unread

- **WHEN** the user clicks "Mark as Unread" in the BulkActionBar
- **THEN** a `PATCH /api/v1/books/bulk-reading-progress` request is sent with `{ bookIds, action: "mark-unread" }`
- **THEN** the ReadingProgress record for each selected book is deleted or reset (percentage 0, completedAt null) for the current user

---

### Requirement: User can bulk add books to a shelf

The system SHALL allow adding all selected books to a chosen shelf in a single action.

#### Scenario: Add selected books to shelf

- **WHEN** the user clicks "Add to Shelf" in the BulkActionBar and selects a shelf from the popover
- **THEN** a `POST /api/v1/shelves/:id/books/bulk` request is sent with `{ bookIds }`
- **THEN** all selected books that are not already on the shelf are added
- **THEN** books already on the shelf are silently skipped (no error)
- **THEN** the selected count badge updates to reflect success

---

### Requirement: User can bulk remove books from a shelf

The system SHALL allow removing all selected books from the current shelf when viewing a shelf page.

#### Scenario: Remove selected books from current shelf

- **WHEN** the user is on a Shelf or Smart Shelf page, has books selected, and clicks "Remove from Shelf"
- **THEN** a `DELETE /api/v1/shelves/:id/books/bulk` request is sent with `{ bookIds }`
- **THEN** all selected books are removed from the shelf
- **THEN** the book cards for removed books disappear from the current view

---

### Requirement: User can bulk change book reading status

The system SHALL allow setting the reading status (want-to-read / reading / read) of all selected books in a single action.

#### Scenario: Change status for selected books

- **WHEN** the user clicks "Change Status" in the BulkActionBar and selects a status from the popover
- **THEN** a `PATCH /api/v1/books/bulk-status` request is sent with `{ bookIds, status }`
- **THEN** the `readingStatus` field is updated for each selected book

---

### Requirement: User can bulk delete books

The system SHALL allow permanently deleting all selected books after explicit confirmation.

#### Scenario: Delete selected books with confirmation

- **WHEN** the user clicks "Delete" in the BulkActionBar
- **THEN** a confirmation modal is shown listing the number of books to be deleted
- **WHEN** the user confirms deletion
- **THEN** a `DELETE /api/v1/books/bulk` request is sent with `{ bookIds }`
- **THEN** all selected books and their associated files are deleted
- **THEN** the deleted book cards are removed from the current view and selection is cleared

#### Scenario: Cancel bulk delete

- **WHEN** the user clicks "Delete" in the BulkActionBar but dismisses the confirmation modal
- **THEN** no books are deleted and the selection remains unchanged
