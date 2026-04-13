## ADDED Requirements

### Requirement: User can enter multi-select mode

The system SHALL allow users to enter a multi-select mode in any book list view (All Books, Library, Shelf, Smart Shelf) by long-pressing or clicking a dedicated select toggle button, causing a checkbox overlay to appear on all visible book cards.

#### Scenario: Enter select mode via select toggle button

- **WHEN** the user clicks the "Select" button in the page toolbar
- **THEN** a checkbox appears on the top-left corner of every visible book card
- **THEN** clicking a book card toggles its selection instead of opening the detail modal

#### Scenario: Exit select mode via clear or escape

- **WHEN** the user clicks "Clear Selection" in the BulkActionBar or presses Escape
- **THEN** all selections are cleared
- **THEN** book cards return to their normal click-to-open behavior

---

### Requirement: User can select and deselect individual books

The system SHALL allow toggling the selected state of individual books while in multi-select mode.

#### Scenario: Select a single book

- **WHEN** the user is in multi-select mode and clicks a book card (or its checkbox)
- **THEN** that book's ID is added to the selected set
- **THEN** the checkbox on that card appears checked

#### Scenario: Deselect a single book

- **WHEN** the user clicks a book card that is already selected
- **THEN** that book's ID is removed from the selected set
- **THEN** the checkbox on that card appears unchecked

---

### Requirement: User can select all visible books at once

The system SHALL provide a "Select All" control that selects every book currently rendered on screen (current page/filter result).

#### Scenario: Select all on current page

- **WHEN** the user clicks "Select All"
- **THEN** all book IDs in the current view are added to the selected set
- **THEN** all visible checkboxes appear checked

#### Scenario: Deselect all via Select All toggle

- **WHEN** all visible books are already selected and the user clicks "Select All" again
- **THEN** all book IDs are removed from the selected set

---

### Requirement: Selection state is cleared on view navigation

The system SHALL clear the selection set when the user navigates to a different route or changes the active library/shelf.

#### Scenario: Navigate away clears selection

- **WHEN** the user navigates from any book list view to a different page
- **THEN** the selected book IDs set is reset to empty

#### Scenario: Filter or library change clears selection

- **WHEN** the user changes the active filter, sort order, or library/shelf while in multi-select mode
- **THEN** the selected book IDs set is reset to empty
