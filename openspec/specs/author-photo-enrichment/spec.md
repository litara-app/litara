# Author Photo Enrichment

## Requirements

### Requirement: Author photo enrichment fetches data from Open Library and stores it in the database

The system SHALL provide a mechanism to fetch and store author portrait photos, biographies, and Goodreads IDs by querying the Open Library API. The enrichment flow is:

1. `GET https://openlibrary.org/search/authors.json?q=<name>` — find an exact case-insensitive name match
2. `GET https://openlibrary.org/authors/<OLID>.json` — retrieve `photos[]`, `bio`, and `remote_ids.goodreads`
3. `GET https://covers.openlibrary.org/a/id/<photoId>-M.jpg` — download the photo bytes

Photo bytes SHALL be stored in the `photoData Bytes?` column on the `Author` model. The biography SHALL be stored in `biography String?`. The Goodreads ID SHALL be stored in `goodreadsId String?`. Enrichment SHALL be skipped (all three fields) if all are already populated and the `force` flag is not set. Enrichment SHALL NOT overwrite existing data for fields already populated unless `force` is set.

Photo bytes SHALL be validated before storage: the bytes must be at least 2000 bytes and begin with the JPEG magic bytes `FF D8 FF`. Images failing these checks are discarded and `photoData` remains null.

The `bio` field from Open Library may be a plain string or a `/type/text` object (`{ type: "/type/text", value: "..." }`); both forms SHALL be handled.

#### Scenario: Open Library match found — all fields populated

- **WHEN** enrichment runs for an author whose name exactly matches (case-insensitive) an Open Library result that has a photo, biography, and Goodreads ID
- **THEN** `photoData`, `biography`, and `goodreadsId` are all saved to the `Author` record

#### Scenario: No exact name match in Open Library

- **WHEN** enrichment runs for an author and Open Library returns no case-insensitive name match
- **THEN** all three fields remain unchanged and no error is raised

#### Scenario: Author has photo but no biography or Goodreads ID

- **WHEN** the Open Library author record has a photo but no `bio` or `remote_ids.goodreads`
- **THEN** only `photoData` is updated; `biography` and `goodreadsId` remain null

#### Scenario: Photo fails validation guardrails

- **WHEN** the downloaded image is smaller than 2000 bytes or does not start with `FF D8 FF`
- **THEN** `photoData` is not updated (remains null); biography and goodreadsId are still saved if available

#### Scenario: Existing data is not overwritten by default

- **WHEN** enrichment runs for an author who already has all three fields populated and `force` is not set
- **THEN** the author record is unchanged and Open Library is not queried

#### Scenario: Existing data is overwritten when force flag is set

- **WHEN** enrichment runs for an author with existing data and `force=true`
- **THEN** the system re-queries Open Library and updates all fields with the new results

---

### Requirement: Admin can trigger bulk author data enrichment

The system SHALL expose a `POST /api/v1/authors/enrich` endpoint that creates a background `Task` and asynchronously enriches all authors missing at least one of `photoData`, `biography`, or `goodreadsId` (or all authors if `force=true`). The endpoint SHALL be protected by `JwtAuthGuard`. It SHALL return 202 Accepted with `{ taskId, total }`. Enrichment SHALL apply a 200 ms delay between per-author requests. Task status SHALL be updated to `PROCESSING`, then `COMPLETED` or `FAILED`. The task payload SHALL include `processed`, `total`, and `currentAuthorName` progress fields.

#### Scenario: Bulk enrichment accepted and runs asynchronously

- **WHEN** an authenticated admin sends `POST /api/v1/authors/enrich`
- **THEN** the system returns 202 with `{ taskId, total }` and begins background enrichment for all authors missing any enrichable field

#### Scenario: Bulk enrichment with force

- **WHEN** an authenticated admin sends `POST /api/v1/authors/enrich?force=true`
- **THEN** the system re-enriches all authors regardless of existing data

#### Scenario: Task can be cancelled

- **WHEN** a running enrichment task's status is set to `CANCELLED`
- **THEN** the background loop stops after the current author completes

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `POST /api/v1/authors/enrich`
- **THEN** the system returns 401 Unauthorized

---

### Requirement: Admin can trigger per-author data enrichment

The system SHALL expose a `POST /api/v1/authors/:id/enrich` endpoint that synchronously runs enrichment for a single author and returns the updated `AuthorDetailDto` on success. The endpoint SHALL be protected by `JwtAuthGuard`. It SHALL return 404 if the author id does not exist. The `force=true` query parameter follows the same semantics as bulk enrichment.

#### Scenario: Per-author enrichment returns updated record

- **WHEN** an authenticated admin sends `POST /api/v1/authors/:id/enrich` for a valid author
- **THEN** the system returns 200 with the author's updated detail including resolved `hasCover`, `biography`, and `goodreadsId`

#### Scenario: Returns 404 for unknown author

- **WHEN** an authenticated admin sends `POST /api/v1/authors/:id/enrich` with a non-existent id
- **THEN** the system returns 404 Not Found

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `POST /api/v1/authors/:id/enrich`
- **THEN** the system returns 401 Unauthorized

---

### Requirement: Bulk author enrichment is configurable from Admin Settings

The system SHALL expose an "Author Data Enrichment" section in the Admin Settings General tab. This section SHALL contain an "Enrich All Author Data" button that calls `POST /api/v1/authors/enrich` and displays the resulting task ID and author count on success, or an error alert on failure. This section SHALL only be visible to admin users.
