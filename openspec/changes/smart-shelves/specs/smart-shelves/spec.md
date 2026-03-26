## ADDED Requirements

### Requirement: List smart shelves

The system SHALL return all smart shelves belonging to the authenticated user, ordered by name, including the rule count for each shelf.

#### Scenario: User with no smart shelves

- **WHEN** an authenticated user calls `GET /api/v1/smart-shelves`
- **THEN** the system returns an empty array with HTTP 200

#### Scenario: User with smart shelves

- **WHEN** an authenticated user calls `GET /api/v1/smart-shelves`
- **THEN** the system returns an array of smart shelf summaries, each including `id`, `name`, `logic`, and `ruleCount`

---

### Requirement: Create smart shelf

The system SHALL allow an authenticated user to create a named smart shelf with a logic connector and at least one rule.

#### Scenario: Valid create request

- **WHEN** a user sends `POST /api/v1/smart-shelves` with `name`, `logic` (`AND` or `OR`), and a non-empty `rules` array
- **THEN** the system creates the shelf and its rules, and returns the full shelf object with HTTP 201

#### Scenario: Missing rules

- **WHEN** a user sends `POST /api/v1/smart-shelves` with `rules: []`
- **THEN** the system returns HTTP 400

#### Scenario: Invalid operator

- **WHEN** a rule contains an operator not in the allowed set (`eq`, `ne`, `contains`, `startsWith`, `gt`, `lt`)
- **THEN** the system returns HTTP 400

#### Scenario: Invalid field

- **WHEN** a rule contains a field not in the supported field set
- **THEN** the system returns HTTP 400

---

### Requirement: Get smart shelf detail

The system SHALL return the full definition of a smart shelf including all rules.

#### Scenario: Shelf found

- **WHEN** an authenticated user calls `GET /api/v1/smart-shelves/:id` for a shelf they own
- **THEN** the system returns the shelf with `id`, `name`, `logic`, and `rules` array (each rule has `id`, `field`, `operator`, `value`)

#### Scenario: Shelf not found or not owned

- **WHEN** the shelf ID does not exist or belongs to another user
- **THEN** the system returns HTTP 404

---

### Requirement: Update smart shelf

The system SHALL allow an authenticated user to update the name, logic, and rules of their smart shelf. Rule updates replace all existing rules atomically.

#### Scenario: Valid update

- **WHEN** a user sends `PATCH /api/v1/smart-shelves/:id` with updated fields
- **THEN** the system replaces all existing rules with the new rule set and returns the updated shelf

#### Scenario: Update another user's shelf

- **WHEN** the shelf belongs to a different user
- **THEN** the system returns HTTP 404

---

### Requirement: Delete smart shelf

The system SHALL allow an authenticated user to delete their smart shelf and all its rules.

#### Scenario: Successful delete

- **WHEN** a user sends `DELETE /api/v1/smart-shelves/:id` for a shelf they own
- **THEN** the shelf and all its rules are deleted, returning HTTP 204

#### Scenario: Delete another user's shelf

- **WHEN** the shelf belongs to a different user
- **THEN** the system returns HTTP 404

---

### Requirement: Evaluate smart shelf books

The system SHALL evaluate the shelf's rules against the user's library and return all matching books, capped at 500 results. The response SHALL include the total match count.

#### Scenario: AND logic — all rules must match

- **WHEN** a user calls `GET /api/v1/smart-shelves/:id/books` and the shelf has `logic: AND`
- **THEN** only books satisfying every rule are returned

#### Scenario: OR logic — any rule must match

- **WHEN** a user calls `GET /api/v1/smart-shelves/:id/books` and the shelf has `logic: OR`
- **THEN** books satisfying at least one rule are returned

#### Scenario: String field with `contains` operator

- **WHEN** a rule is `{ field: "genre", operator: "contains", value: "fant" }`
- **THEN** books whose genre names include "fant" (case-insensitive) are matched

#### Scenario: Numeric field with `gt` operator

- **WHEN** a rule is `{ field: "pageCount", operator: "gt", value: "500" }`
- **THEN** only books with more than 500 pages are returned

#### Scenario: `publishedYear` filter

- **WHEN** a rule is `{ field: "publishedYear", operator: "eq", value: "1991" }`
- **THEN** books whose `publishedDate` falls within 1991 are returned

#### Scenario: Invalid or empty rules produce no results

- **WHEN** all rules on a shelf are malformed (empty value, unknown field)
- **THEN** the system returns an empty book list rather than an error

---

### Requirement: Smart shelves navbar section

The system SHALL display a "Smart Shelves" section in the sidebar below manual shelves, listing each smart shelf by name with an "Add" button to create new ones.

#### Scenario: No smart shelves exist

- **WHEN** the user has no smart shelves
- **THEN** the sidebar shows the section header and an "Add smart shelf" button but no shelf entries

#### Scenario: Clicking a smart shelf name

- **WHEN** the user clicks a smart shelf in the sidebar
- **THEN** the app navigates to the smart shelf detail page showing matched books

---

### Requirement: Smart shelf create/edit modal

The system SHALL provide a modal for creating and editing smart shelves with a dynamic rule builder.

#### Scenario: Add rule row

- **WHEN** the user clicks "Add rule"
- **THEN** a new rule row appears with field, operator, and value inputs

#### Scenario: Remove rule row

- **WHEN** the user clicks the remove button on a rule row
- **THEN** that rule row is removed from the list

#### Scenario: Logic toggle

- **WHEN** the user toggles the AND/OR selector
- **THEN** the connector label between rules updates to reflect the selection

#### Scenario: Save creates shelf

- **WHEN** the user fills in the name, selects logic, defines at least one complete rule, and clicks Save
- **THEN** the shelf is created via the API and appears in the sidebar

#### Scenario: Edit existing shelf

- **WHEN** the modal is opened for an existing shelf
- **THEN** all current rules are pre-populated and can be modified before saving
