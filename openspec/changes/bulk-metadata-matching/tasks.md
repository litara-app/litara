## 1. Backend — Config API

- [x] 1.1 Add `GET /admin/metadata-match/config` endpoint returning the field-source config array from `ServerSettings` (key: `metadata_field_config`), falling back to a hardcoded default ordering if not set
- [x] 1.2 Add `PUT /admin/metadata-match/config` endpoint that accepts and persists the field-source config array to `ServerSettings`
- [x] 1.3 Add `GET /admin/metadata-match/throttle` and `PUT /admin/metadata-match/throttle` endpoints for the per-call delay setting (key: `metadata_match_throttle_ms`, default 500)
- [x] 1.4 Create `BulkMetadataModule` with controller and service, register it in `AppModule`
- [x] 1.5 Add Swagger decorators (`@ApiProperty`, `@ApiBearerAuth`) and DTOs for all new endpoints

## 2. Backend — ISBN Hint Passthrough

- [x] 2.1 Extend `OpenLibraryService.searchManyByTitleAuthor()` to accept optional `limit` param; add `fetchByKey()` for guided selection
- [x] 2.2 ISBN hint already passed via `EnrichInput.isbn13` to `GoogleBooksService.searchByIsbn()` — no additional changes needed
- [x] 2.3 ISBN hint already passed via `EnrichInput.isbn13` to `HardcoverService.searchByIsbn()` — no additional changes needed
- [x] 2.4 `MetadataService.fetchFromProvider()` already accepts `EnrichInput` with `isbn13`; bulk service chains ISBN from OpenLibrary output into subsequent provider calls

## 3. Backend — Candidates Endpoint

- [x] 3.1 Add `POST /admin/metadata-match/candidates` endpoint: accepts `{ bookId, limit?: number }`, queries OpenLibrary by book's title+author, returns up to `limit` (max 3) candidates with `{ openLibraryKey, title, authors, year, coverUrl, isbn13 }`

## 4. Backend — Bulk Run Engine

- [x] 4.1 Add `POST /admin/metadata-match/run` endpoint: accepts `{ scope, scopeId?, overwrite?, guidedSelections?, throttleMs? }`, resolves book list, creates `BULK_METADATA_MATCH` Task, starts background enrichment, returns `{ taskId }`
- [x] 4.2 Implement `BulkMetadataService.runBulkEnrichment()`: iterates books, applies field-source config, chains ISBN from OpenLibrary to subsequent providers, respects fill-blanks-only vs overwrite, updates Task payload with progress after each book
- [x] 4.3 Add cancellation check: at start of each book iteration, re-fetch Task status and exit loop if status is `CANCELLED`
- [x] 4.4 Add throttle: `await sleep(throttleMs)` between provider API calls
- [x] 4.5 Add `POST /admin/metadata-match/cancel/:taskId` endpoint to set Task status to `CANCELLED`

## 5. Frontend — Metadata Matching Admin Page

- [x] 5.1 Create `MetadataMatchingPage.tsx` under `apps/web/src/pages/admin/`
- [x] 5.2 Add "Metadata Matching" entry to the Admin nav/sidebar (with `IconDatabaseSearch`)
- [x] 5.3 Build field-source config table: columns for Field Name, Provider (select), Enabled (toggle); up/down arrow buttons for reordering rows
- [x] 5.4 Add throttle setting input (number, 50–5000ms range) with save button
- [x] 5.5 Add "Run Bulk Enrichment" section: scope selector (All Books / Library / Shelf) with conditional library/shelf picker, Overwrite toggle, Run button

## 6. Frontend — Guided Disambiguation Modal

- [x] 6.1 On Run click (scope ≤50 books), call `POST /admin/metadata-match/candidates` for each book and collect results
- [x] 6.2 Build `DisambiguationModal`: for each book with multiple candidates, show cards with cover thumbnail, title, authors, year, ISBN; user picks one or clicks Skip
- [x] 6.3 On modal confirm, submit `POST /admin/metadata-match/run` with `guidedSelections` array

## 7. Frontend — Progress Display

- [x] 7.1 After run starts, show an inline progress section with a Mantine `Progress` bar, current book title, and `X / Y books` counter
- [x] 7.2 Poll `GET /admin/metadata-match/task/:taskId` every 2 seconds while status is `PROCESSING` or `PENDING`; update progress from `Task.payload`
- [x] 7.3 On `COMPLETED`: show success alert with total books enriched and stop polling
- [x] 7.4 On `FAILED`: show error message from `Task.errorMessage` and stop polling
- [x] 7.5 Add Cancel button (visible while running) that calls `POST /admin/metadata-match/cancel/:taskId`
