## ADDED Requirements

### Requirement: Pending books carry a target library

`PendingBook` SHALL have a nullable `targetLibraryId` field. `PATCH /book-drop/:id` SHALL accept `targetLibraryId` and persist it on the pending record.

#### Scenario: Admin sets target library on a pending book

- **WHEN** an admin sends `PATCH /book-drop/:id` with `{targetLibraryId: <library.id>}`
- **THEN** the pending book's `targetLibraryId` reflects that value

### Requirement: Approval requires a target library and writes into its folder

The approval endpoints (`POST /book-drop/:id/approve`, `POST /book-drop/:id/approve-overwrite`, `POST /book-drop/approve-all`) SHALL reject any pending book that lacks a `targetLibraryId` (HTTP 400). On approval, the system SHALL write the file to `{library.path}/{author}/{series}/{title}.{ext}` using the existing `LibraryWriteService` path-building helpers and SHALL create the resulting `Book` with `libraryId = targetLibraryId` and `isOrphan = false`.

#### Scenario: Approving a pending book without target library fails

- **GIVEN** a pending book with `targetLibraryId = null`
- **WHEN** an admin sends `POST /book-drop/:id/approve`
- **THEN** the system returns HTTP 400 and does not write any file

#### Scenario: Approving routes the file into the chosen library

- **GIVEN** a pending book "Foundation" by "Asimov" with `targetLibraryId` referencing a library at `/books/ebooks`
- **WHEN** an admin approves the pending book
- **THEN** the file is written to `/books/ebooks/Asimov/Foundation.epub` and the created Book has `libraryId` equal to that library's id

#### Scenario: Approve-all uses each pending book's target library

- **GIVEN** two pending books with different `targetLibraryId` values
- **WHEN** an admin sends `POST /book-drop/approve-all`
- **THEN** each file is written under its corresponding library's path

### Requirement: Pending review UI exposes a target library selector

The pending review page SHALL render a Target Library `Select` on each `PendingBookCard` populated from `GET /libraries`. The card's "Write to Disk" action SHALL be disabled until a target library is chosen. A page-level Target Library Select SHALL act as the default for all pending books without an explicit per-card choice.

#### Scenario: Disabled write button without target library

- **WHEN** a pending book card is rendered with `targetLibraryId = null` and no page-level default
- **THEN** the "Write to Disk" button is disabled

#### Scenario: Page-level default applies to unset cards

- **GIVEN** the page-level Target Library Select is set to library X and three pending cards have no per-card choice
- **WHEN** the admin clicks "Write All to Disk"
- **THEN** all three approvals are issued with `targetLibraryId = X.id`
