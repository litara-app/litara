## ADDED Requirements

### Requirement: Field-source configuration

The system SHALL provide an admin UI section "Metadata Matching" that displays all metadata fields (Title, Subtitle, Authors, Description, Publisher, Published Date, Language, ISBN-10, ISBN-13, Pages, Series Name, Series Number, Google Books ID, Goodreads ID, Goodreads Rating, Hardcover ID, Open Library ID, ASIN, Genres, Tags) with a per-field provider assignment and priority order. Configuration SHALL be persisted to `ServerSettings` under key `metadata_field_config` as a JSON array ordered by drag-to-reorder priority.

#### Scenario: View field-source config table

- **WHEN** admin navigates to Admin → Metadata Matching
- **THEN** system displays a table with one row per metadata field, each showing the field name and a provider selector

#### Scenario: Assign provider to field

- **WHEN** admin selects a provider from the dropdown for a field and saves
- **THEN** system persists the assignment to ServerSettings and subsequent bulk runs use that provider for that field

#### Scenario: Reorder field priority

- **WHEN** admin drags a field row to a new position
- **THEN** system reorders the config array so fields at the top are populated first during enrichment

#### Scenario: Disable a field

- **WHEN** admin toggles a field's enabled switch to off
- **THEN** system excludes that field from bulk enrichment runs entirely

### Requirement: Bulk metadata run with scope

The system SHALL allow an admin to trigger a bulk metadata enrichment job scoped to: all books, a specific library, or a specific shelf. The job SHALL run as a background `Task` (type `BULK_METADATA_MATCH`) and return a task ID immediately so the frontend can poll for progress.

#### Scenario: Trigger bulk run for all books

- **WHEN** admin selects scope "All Books" and clicks Run
- **THEN** system creates a BULK_METADATA_MATCH task and begins enriching all books in order, updating `Task.payload` with `{ processed, total, currentBookId }` as it progresses

#### Scenario: Trigger bulk run for a library

- **WHEN** admin selects scope "Library" and picks a library
- **THEN** system resolves books belonging to that library and enriches only those books

#### Scenario: Trigger bulk run for a shelf

- **WHEN** admin selects scope "Shelf" and picks a shelf (regular or smart)
- **THEN** system resolves books on that shelf and enriches only those books

#### Scenario: Fill blanks only (default)

- **WHEN** bulk run is triggered without overwrite mode
- **THEN** system skips any field that already has a non-null, non-empty value on the book

#### Scenario: Overwrite mode

- **WHEN** bulk run is triggered with overwrite=true
- **THEN** system replaces existing field values with provider results even if the field was already populated

#### Scenario: Cancel in-progress job

- **WHEN** admin clicks Cancel on an in-progress bulk run
- **THEN** system sets Task.status to CANCELLED and the background worker stops after finishing the current book

### Requirement: Live progress display

The system SHALL display live progress of a running bulk job by polling the task endpoint, showing a progress bar, current book title, and counts (processed / total).

#### Scenario: Progress updates during run

- **WHEN** a bulk metadata job is running
- **THEN** the UI polls GET /tasks/:id every 2 seconds and updates the progress bar and current book indicator

#### Scenario: Job completion

- **WHEN** Task.status becomes COMPLETED
- **THEN** UI shows a success message with total books enriched and stops polling

#### Scenario: Job failure

- **WHEN** Task.status becomes FAILED
- **THEN** UI shows the error message from Task.errorMessage and stops polling

### Requirement: Provider chaining via ISBN

The system SHALL support configuring OpenLibrary as an "ISBN resolver" step — when OpenLibrary is assigned to the ISBN-13 field, the resolved ISBN SHALL be automatically passed as a lookup hint to subsequent provider calls for the same book, enabling more accurate matches on Goodreads and Hardcover.

#### Scenario: ISBN resolved and passed to next provider

- **WHEN** bulk run processes a book and OpenLibrary resolves ISBN-13
- **THEN** system uses that ISBN-13 as the primary lookup key for all subsequent provider calls in the same book's enrichment pipeline

#### Scenario: No ISBN resolved

- **WHEN** OpenLibrary cannot resolve an ISBN-13 for a book
- **THEN** subsequent providers fall back to title+author search without an ISBN hint

### Requirement: Guided disambiguation for small scopes

The system SHALL offer a guided disambiguation flow when the run scope contains 50 books or fewer. Before starting the background job, the frontend SHALL query for OpenLibrary candidates for each book with multiple matches and present up to 3 options (cover thumbnail, title, authors, year, ISBN) for user selection. The selected OpenLibrary IDs are submitted with the run request.

#### Scenario: Disambiguation modal presented

- **WHEN** admin triggers a bulk run with scope ≤50 books and at least one book has multiple OpenLibrary candidates
- **THEN** system shows a disambiguation modal with cards for each ambiguous book, each card showing up to 3 candidate options

#### Scenario: User selects a candidate

- **WHEN** user clicks a candidate card for a book
- **THEN** that OpenLibrary ID is stored as the guided selection for that book

#### Scenario: User skips disambiguation for a book

- **WHEN** user clicks "Skip" for an ambiguous book
- **THEN** the system uses the top OpenLibrary result automatically for that book during the run

#### Scenario: Guided selections submitted with run

- **WHEN** user clicks "Start Run" after reviewing all disambiguation choices
- **THEN** guided selections are included in the POST /admin/metadata-match/run body and the background job uses them instead of re-querying OpenLibrary

#### Scenario: Large scope skips guided mode

- **WHEN** admin triggers a bulk run with scope >50 books
- **THEN** system skips guided disambiguation entirely and automatically uses the top OpenLibrary result for each book

### Requirement: Throttle between requests

The system SHALL enforce a configurable delay between consecutive provider API calls during bulk enrichment (default 500ms) to avoid triggering rate limits.

#### Scenario: Default throttle applied

- **WHEN** bulk run processes consecutive books
- **THEN** system waits at least 500ms between provider API calls

#### Scenario: Throttle is configurable

- **WHEN** admin changes the throttle setting (50ms–5000ms) and saves
- **THEN** subsequent bulk runs use the new delay value
