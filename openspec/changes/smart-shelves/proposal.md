## Why

Users need a way to create dynamic, rule-based book collections without manually curating them. Smart shelves solve this by automatically filtering the library based on user-defined criteria (e.g., "all unread fantasy books over 500 pages"), keeping the shelf up to date as metadata changes.

## What Changes

- Add a "Smart Shelves" section to the sidebar navbar below regular shelves
- New UI flow: "Add Smart Shelf" button opens a modal to name the shelf and define rules
- Rules are composed of: Field → Operator (eq, ne, contains, gt, lt) → Value
- Multiple rules can be combined with AND / OR logic
- Smart shelf detail page shows all books that currently match the shelf's rules
- Rules are evaluated server-side at query time — no pre-materialisation needed
- Existing manual shelves are unchanged

## Capabilities

### New Capabilities

- `smart-shelves`: CRUD for smart shelves, rule definition (field/operator/value), server-side rule evaluation, smart shelf book listing, navbar integration

### Modified Capabilities

## Impact

- **API**: New `/api/v1/smart-shelves` resource (GET list, POST create, GET detail, PATCH update, DELETE); new GET `/api/v1/smart-shelves/:id/books` endpoint that evaluates rules and returns matching books
- **Database**: `SmartShelf` and `SmartShelfRule` models already exist in the Prisma schema — need to verify rule fields align with the desired field set
- **Frontend**: New `SmartShelvesSection` in sidebar, `SmartShelfModal` for create/edit, `SmartShelfPage` for the book listing
- **No breaking changes** to existing shelf or book APIs
