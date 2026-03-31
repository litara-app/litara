## ADDED Requirements

### Requirement: Global annotations page route

The application SHALL include a protected route at `/annotations` accessible from the main navigation. The page SHALL display all annotations across all books for the authenticated user.

#### Scenario: Navigate to annotations page

- **WHEN** an authenticated user clicks the "Annotations" link in the navbar
- **THEN** the user is navigated to `/annotations` and sees their annotations listed

#### Scenario: Unauthenticated access

- **WHEN** an unauthenticated user navigates to `/annotations`
- **THEN** the user is redirected to `/login`

### Requirement: Navbar annotations link

The `NavbarContent` component SHALL include an "Annotations" navigation item with a bookmark/annotation icon, linking to `/annotations`, positioned in the main nav section alongside Dashboard, All Books, and Series.

#### Scenario: Navbar link visible

- **WHEN** the user is authenticated and views the sidebar
- **THEN** an "Annotations" nav item is visible with an appropriate icon

#### Scenario: Active state

- **WHEN** the user is on the `/annotations` route
- **THEN** the "Annotations" nav item appears highlighted/active

### Requirement: Annotations list display

The annotations page SHALL display each annotation as a card showing: the book cover thumbnail, book title, annotation type badge, highlighted/noted text (truncated), the note (if any), and the creation date.

#### Scenario: Annotation card rendered

- **WHEN** the annotations page loads and the user has annotations
- **THEN** each annotation is shown as a card with book cover, title, type badge, text snippet, note preview, and date

#### Scenario: No annotations

- **WHEN** the user has no annotations
- **THEN** an empty state message is shown encouraging them to start reading and highlighting

### Requirement: Search annotations

The annotations page SHALL include a search input that filters the displayed annotations by matching against the annotation text and note fields.

#### Scenario: Search by text

- **WHEN** the user types in the search input
- **THEN** only annotations whose `text` or `note` contain the search term are shown (case-insensitive, client-side)

#### Scenario: Clear search

- **WHEN** the user clears the search input
- **THEN** all annotations are shown again

### Requirement: Filter annotations by type

The annotations page SHALL include filter controls to show only annotations of a specific type (All, Highlights, Underlines, Strikethroughs, Bookmarks).

#### Scenario: Filter by bookmarks

- **WHEN** the user selects the "Bookmarks" filter
- **THEN** only `BOOKMARK` type annotations are displayed

#### Scenario: Filter combined with search

- **WHEN** the user applies both a type filter and a search term
- **THEN** only annotations matching both criteria are displayed

### Requirement: Jump to annotation from annotations page

Each annotation card on the annotations page SHALL include a button to open the reader at the annotation's CFI location.

#### Scenario: Jump to annotation

- **WHEN** the user clicks "Open in Reader" on an annotation card
- **THEN** the reader opens for that book and navigates directly to the annotation's CFI location

### Requirement: Delete annotation from annotations page

Each annotation card SHALL include a delete action. Confirming deletion SHALL remove the annotation.

#### Scenario: Delete annotation

- **WHEN** the user clicks the delete icon on an annotation card and confirms
- **THEN** the annotation is deleted via the API and removed from the list

#### Scenario: Cancel deletion

- **WHEN** the user clicks the delete icon but cancels the confirmation
- **THEN** no change is made
