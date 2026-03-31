## ADDED Requirements

### Requirement: Annotations tab in BookDetailModal

The `BookDetailModal` SHALL include a new "Annotations" tab alongside the existing Overview, Edit Metadata, Search Metadata, and Sidecar tabs. The tab SHALL display all annotations for the book created by the current user.

#### Scenario: Annotations tab visible

- **WHEN** a user opens the BookDetailModal for any book
- **THEN** an "Annotations" tab is visible in the tab bar

#### Scenario: Annotations tab selected

- **WHEN** the user clicks the "Annotations" tab
- **THEN** the tab content area shows the book's annotations

### Requirement: Per-book annotation list in modal

The Annotations tab SHALL display each annotation as a list item showing: type badge, highlighted text (if any), note text (if any), color swatch (for highlights), and creation date.

#### Scenario: Annotation list item rendered

- **WHEN** the Annotations tab is active and the book has annotations
- **THEN** each annotation appears as a list row with type, text snippet, note, and date

#### Scenario: Empty annotations tab

- **WHEN** the Annotations tab is active and the book has no annotations
- **THEN** an empty state is shown indicating no annotations yet, with a suggestion to open the reader to start annotating

### Requirement: Search within book annotations

The Annotations tab SHALL include a search input that filters the book's annotations by text and note content.

#### Scenario: Filter annotations by keyword

- **WHEN** the user types in the search field within the Annotations tab
- **THEN** only annotations matching the keyword in `text` or `note` are shown

### Requirement: Jump to annotation from modal

Each annotation in the Annotations tab SHALL have a button to open the reader at that annotation's CFI location. Clicking it SHALL close the modal and open the reader.

#### Scenario: Jump to annotation

- **WHEN** the user clicks the jump button on an annotation row in the modal
- **THEN** the modal closes and the reader opens at the annotation's CFI location

### Requirement: Delete annotation from modal

Each annotation row in the Annotations tab SHALL have a delete action. Confirming SHALL remove the annotation.

#### Scenario: Delete annotation from modal

- **WHEN** the user clicks delete on an annotation row and confirms
- **THEN** the annotation is deleted via the API and removed from the list in the modal
