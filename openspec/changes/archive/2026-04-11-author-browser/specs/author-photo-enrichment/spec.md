## ADDED Requirements

### Requirement: Author photo enrichment resolves portraits from public sources

The system SHALL provide a mechanism to resolve and store author portrait URLs by querying free public APIs. The resolution strategy SHALL try sources in the following order: (1) Open Library author search, (2) Wikidata SPARQL. The resolved URL SHALL be stored in the `photoUrl` field of the `Author` record. If no portrait is found from any source, `photoUrl` SHALL remain null. Enrichment SHALL NOT overwrite an existing `photoUrl` unless the `force` flag is set.

#### Scenario: Open Library match found

- **WHEN** enrichment runs for an author whose name exactly matches (case-insensitive) a result returned by `GET https://openlibrary.org/search/authors.json?q=<name>`
- **THEN** the author's `photoUrl` is set to the corresponding Open Library cover URL (`https://covers.openlibrary.org/a/olid/<key>-M.jpg`) and saved to the database

#### Scenario: Open Library has no exact match, Wikidata used as fallback

- **WHEN** enrichment runs for an author and Open Library returns no case-insensitive name match
- **THEN** the system queries Wikidata SPARQL for a human entity with the matching name and an image property, and sets `photoUrl` to the resolved Wikimedia Commons image URL if found

#### Scenario: No portrait found from any source

- **WHEN** enrichment runs for an author and neither Open Library nor Wikidata returns a usable image
- **THEN** `photoUrl` remains null and no error is raised

#### Scenario: Existing photo is not overwritten by default

- **WHEN** enrichment runs for an author who already has a non-null `photoUrl` and the `force` flag is not set
- **THEN** the author's `photoUrl` is unchanged and the source APIs are not queried

#### Scenario: Existing photo is overwritten when force flag is set

- **WHEN** enrichment runs for an author who already has a non-null `photoUrl` and the `force` flag is set
- **THEN** the system re-queries the source APIs and updates `photoUrl` with the new result (or clears it if none found)

---

### Requirement: Admin can trigger bulk author photo enrichment

The system SHALL expose a `POST /api/v1/authors/enrich` endpoint that enqueues background enrichment for all authors without a `photoUrl` (or all authors if `force=true` is provided as a query parameter). The endpoint SHALL be protected by `JwtAuthGuard`. It SHALL return 202 Accepted immediately and run enrichment asynchronously. Enrichment SHALL apply a minimum 200 ms delay between per-author requests to respect source API rate limits.

#### Scenario: Bulk enrichment is accepted and runs asynchronously

- **WHEN** an authenticated admin sends `POST /api/v1/authors/enrich`
- **THEN** the system returns 202 Accepted and begins enrichment in the background for all authors missing a photo

#### Scenario: Bulk enrichment with force overwrites existing photos

- **WHEN** an authenticated admin sends `POST /api/v1/authors/enrich?force=true`
- **THEN** the system re-enriches all authors, including those that already have a `photoUrl`

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `POST /api/v1/authors/enrich`
- **THEN** the system returns 401 Unauthorized

---

### Requirement: Admin can trigger per-author photo enrichment

The system SHALL expose a `POST /api/v1/authors/:id/enrich` endpoint that runs enrichment for a single author. The endpoint SHALL be protected by `JwtAuthGuard`. It SHALL run synchronously and return 200 with the updated author record (including the new `photoUrl`) on success, or 404 if the author id is not found. The `force=true` query parameter SHALL follow the same semantics as bulk enrichment.

#### Scenario: Per-author enrichment returns updated record

- **WHEN** an authenticated admin sends `POST /api/v1/authors/:id/enrich` for a valid author id
- **THEN** the system returns 200 with the author's updated data including the resolved `photoUrl` (or null if not found)

#### Scenario: Returns 404 for unknown author

- **WHEN** an authenticated admin sends `POST /api/v1/authors/:id/enrich` with a non-existent id
- **THEN** the system returns 404 Not Found

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `POST /api/v1/authors/:id/enrich`
- **THEN** the system returns 401 Unauthorized
