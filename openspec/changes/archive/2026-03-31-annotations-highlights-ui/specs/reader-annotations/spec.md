## ADDED Requirements

### Requirement: Text selection popover

When the user selects text in the reader iframe, the reader SHALL display a popover or toolbar offering annotation actions: highlight (color chips), underline, strikethrough, and add note.

#### Scenario: Text selected in reader

- **WHEN** the user selects a passage of text in the EPUB reader
- **THEN** a popover appears offering annotation type options (highlight colors, underline, strikethrough) and an "Add Note" button

#### Scenario: Popover dismissed without saving

- **WHEN** the user clicks outside the popover or presses Escape after selecting text
- **THEN** the popover closes and no annotation is created

### Requirement: Highlight color selection

The annotation popover SHALL offer at least four highlight colors: yellow, green, blue, and pink. Selecting a color and confirming SHALL create a HIGHLIGHT annotation.

#### Scenario: Select yellow highlight

- **WHEN** the user selects text, opens the popover, and clicks the yellow color chip
- **THEN** a `HIGHLIGHT` annotation is created with `color: "yellow"`, the text is visually highlighted yellow in the reader, and the popover closes

#### Scenario: Underline style

- **WHEN** the user selects text and clicks the underline option
- **THEN** an `UNDERLINE` annotation is created, the text is visually underlined in the reader

#### Scenario: Strikethrough style

- **WHEN** the user selects text and clicks the strikethrough option
- **THEN** a `STRIKETHROUGH` annotation is created, the text is visually struck-through in the reader

### Requirement: Add note to annotation

The annotation popover SHALL allow the user to type a note alongside any annotation type. Saving an annotation with a note SHALL store the note text.

#### Scenario: Add note with highlight

- **WHEN** the user selects text, clicks "Add Note", types a note, and saves
- **THEN** an annotation is created with `text` set to the selected passage, `note` set to the typed text, and the passage is visually marked in the reader

#### Scenario: View note on hover

- **WHEN** the user hovers over an annotated passage that has a note
- **THEN** a tooltip or popover shows the note text

### Requirement: Bookmark current page

The reader toolbar SHALL include a bookmark button. Clicking it SHALL create a BOOKMARK annotation at the current CFI with no text.

#### Scenario: Bookmark page

- **WHEN** the user clicks the bookmark button in the reader toolbar
- **THEN** a `BOOKMARK` annotation is created for the current CFI, and the bookmark button shows an active/filled state

#### Scenario: Remove existing bookmark

- **WHEN** the user clicks the bookmark button while the current page already has a bookmark annotation
- **THEN** the existing bookmark annotation is deleted, and the bookmark button returns to its inactive state

### Requirement: Render existing annotations on load

When a book is opened in the reader, all existing annotations for that book SHALL be fetched from the API and rendered at their stored CFI locations.

#### Scenario: Annotations load on book open

- **WHEN** the reader receives the `ready` message from Foliate.js after opening a book
- **THEN** all annotations for the book are fetched and sent to the iframe via `loadAnnotations`, rendering each at its CFI position with its stored color and style

#### Scenario: No annotations

- **WHEN** a book with no annotations is opened
- **THEN** no annotation UI is rendered beyond the default empty state

### Requirement: Reader annotations sidebar

The reader SHALL include a collapsible sidebar panel listing all annotations for the current book. The sidebar SHALL show highlights, notes, and bookmarks grouped or ordered by location. Clicking an entry SHALL navigate the reader to that CFI.

#### Scenario: Open annotations sidebar

- **WHEN** the user clicks the annotations sidebar toggle button in the reader toolbar
- **THEN** a side panel slides in listing all annotations for the current book

#### Scenario: Jump to annotation

- **WHEN** the user clicks an annotation entry in the sidebar
- **THEN** the reader navigates to the CFI location of that annotation

#### Scenario: Delete annotation from sidebar

- **WHEN** the user clicks a delete icon on an annotation entry in the sidebar
- **THEN** the annotation is deleted via the API, removed from the sidebar list, and its visual rendering is removed from the reader content

### Requirement: Edit annotation note from reader

The user SHALL be able to edit the note of an existing annotation by clicking on the annotated text in the reader.

#### Scenario: Click existing annotation

- **WHEN** the user clicks on text that has an existing annotation
- **THEN** a popover shows the current note (if any) with an edit option

#### Scenario: Save edited note

- **WHEN** the user edits the note in the popover and saves
- **THEN** the annotation is updated via the API PATCH endpoint
