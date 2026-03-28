## Context

Litara currently supports single-book metadata enrichment via the Admin → Metadata Providers panel. Each provider (Google Books, OpenLibrary, Goodreads, Hardcover) is enabled/disabled globally, and books are enriched one at a time through the book detail modal. There is no way to bulk-enrich a library, no field-level source configuration, and no provider chaining (e.g., resolve ISBN from OpenLibrary then pass it to Goodreads).

The existing `MetadataService` already wraps all four providers and has an `enrichBook(bookId, provider)` method. The `Task` model provides a background job primitive with status tracking. `ServerSettings` stores key/value config as JSON strings.

## Goals / Non-Goals

**Goals:**

- Admin UI section "Metadata Matching" with field-source mapping table (which field comes from which provider, in what priority order)
- Provider chaining: allow one provider's output (e.g. ISBN-13 from OpenLibrary) to be passed as input to subsequent providers
- Bulk run: trigger enrichment for all books, a specific library, or a specific shelf
- Guided disambiguation: when OpenLibrary returns >1 candidate, surface up to 3 options with cover/title/author/year for user selection before chaining continues
- Background execution via existing `Task` model with live progress reporting
- "Fill blanks only" mode by default; optional overwrite mode

**Non-Goals:**

- Per-book field override UI (that already exists in the book detail modal)
- Real-time streaming of provider responses to the frontend
- Scheduling/cron for automatic enrichment
- Adding new metadata providers

## Decisions

### 1. Store field-source config in `ServerSettings` as a JSON blob

**Decision:** Single `ServerSettings` row with key `metadata_field_config` containing a JSON array of `{ field, provider, enabled }` entries with implicit priority by array order.

**Rationale:** No schema migration needed. Config rarely changes. Consistent with how provider enable/disable is already stored. A separate table would add complexity for what is essentially a small ordered list.

**Alternative considered:** New `MetadataFieldConfig` table — rejected, overkill for ~15 fields.

### 2. Bulk job runs as a background `Task` with polling

**Decision:** `POST /admin/metadata-match/run` creates a `Task` record (type `BULK_METADATA_MATCH`), returns the task ID immediately, then processes books in-process asynchronously. Frontend polls `GET /tasks/:id` (existing endpoint) for progress.

**Rationale:** Consistent with existing scanner tasks. No new infrastructure (no queues, no workers). Progress is visible without websockets.

**Alternative considered:** Synchronous response — rejected, libraries can have thousands of books.

**Alternative considered:** Bull/BullMQ queue — rejected, adds a Redis dependency. Future work if scale demands it.

### 3. Provider chaining via `isbnHint` passthrough

**Decision:** Extend `MetadataService.enrichBookFromProvider(bookId, provider, opts?: { isbnHint?: string })` to accept a pre-resolved ISBN-13. When ISBN chaining is configured (e.g., OpenLibrary → Goodreads), the service resolves ISBN from the first provider, then passes it as `isbnHint` to subsequent providers that support ISBN lookups.

**Rationale:** Minimal interface change. ISBN is the most reliable cross-provider identifier. Providers that already support ISBN search (Goodreads, Hardcover, Google Books) can use it directly.

### 4. Guided disambiguation as a separate two-step API

**Decision:**

- `POST /admin/metadata-match/candidates` — given `{ bookId, limit: 3 }`, queries OpenLibrary by title+author and returns up to 3 candidates (id, title, authors, year, coverUrl, isbn13)
- `POST /admin/metadata-match/run` with `{ scope, guidedSelections: [{ bookId, openLibraryId }] }` — uses pre-selected IDs to skip disambiguation for those books

**Rationale:** Clean separation between the interactive disambiguation step and the background bulk job. The frontend shows the disambiguation modal before submitting the run, not during it.

### 5. Scope selector: all / library / shelf

**Decision:** `POST /admin/metadata-match/run` body: `{ scope: 'all' | 'library' | 'shelf', scopeId?: string, overwrite?: boolean, guidedSelections?: [...] }`. Backend resolves the book list from scope before creating the task.

**Rationale:** Consistent with how other admin operations scope to libraries/shelves. Simple enum avoids ambiguity.

## Risks / Trade-offs

- **Rate limits**: Bulk enrichment against OpenLibrary/Goodreads for large libraries can hit undocumented rate limits. Mitigation: add a configurable delay between books (default 500ms); expose this in the UI as "throttle" setting.
- **Long-running tasks with no kill switch**: Currently `Task` has no cancel mechanism. Mitigation: check for a `CANCELLED` status flag at the start of each book iteration loop; add a cancel button in the UI that sets status to `CANCELLED`.
- **Guided disambiguation scope**: For a library of 1000 books, pre-disambiguation of all ambiguous books before starting the job is impractical. Mitigation: guided mode is only offered when scope is ≤50 books, or when explicitly triggered for a single book. For larger scopes, disambiguation is skipped and OpenLibrary picks the top result automatically.
- **Overwrite safety**: Overwrite mode will replace user-edited metadata. Mitigation: default is fill-blanks-only; overwrite requires an explicit checkbox.

## Migration Plan

1. No database schema changes required — `ServerSettings` and `Task` tables already exist
2. Deploy: new backend module registers alongside existing admin module; no breaking API changes
3. Rollback: remove the new module; existing metadata functionality is unaffected
