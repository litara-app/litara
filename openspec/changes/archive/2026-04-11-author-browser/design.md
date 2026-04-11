## Context

The `Author` model already exists in the Prisma schema and is populated during library scanning. It has `id`, `name`, `biography`, and a `BookAuthor` join table to books. There is no photo storage, no author-facing API, and no frontend surface. The `SeriesModule` (added recently) is the closest architectural precedent and should be followed as a template.

Book covers are stored as raw bytes (`coverData Bytes?`) on the `Book` model and served via `GET /api/v1/books/:id/cover`. Author photos should follow the exact same pattern.

## Goals / Non-Goals

**Goals:**

- Alphabetical author grid page accessible from the navbar
- Author detail modal showing biography, photo, and all owned books
- Two new protected REST endpoints (`/authors`, `/authors/:id`)
- Author photo enrichment that downloads portraits from Open Library and stores bytes in the DB
- Admin-triggered enrichment (manual, not automatic on scan)
- Bulk enrichment runs as a background task with a Tasks tab entry

**Non-Goals:**

- Wikidata / Wikipedia as a photo source (Open Library only for now)
- Automatic enrichment on every library scan (rate-limit risk, user hasn't opted in)
- Author biography enrichment (field already exists, out of scope here)
- Author editing / merging (separate concern)

## Decisions

### D1: Photo source — Open Library only

**Decision:** Use Open Library's author search API exclusively.

**Rationale:** `GET https://openlibrary.org/search/authors.json?q=<name>` → pick the result whose name matches exactly (case-insensitive) → download the image bytes from `https://covers.openlibrary.org/a/olid/<key>-M.jpg`. No auth, no key, generous rate limits. If no exact match is found, leave the author without a photo. Wikidata is deferred until Open Library coverage proves insufficient.

### D2: Store photo as bytes in the database (same as book covers)

**Decision:** Add `photoData Bytes?` to the `Author` model. Download the image at enrichment time and store the raw bytes. Serve via `GET /api/v1/authors/:id/photo`.

**Rationale:** This exactly mirrors how book covers work (`coverData Bytes?` on `Book`, served via `GET /api/v1/books/:id/cover`). It keeps the app self-contained, works offline, and avoids external URL rot. The frontend uses `hasCover: boolean` (derived from `photoData != null`) to decide whether to render the photo or fall back to a placeholder — same pattern as book cards.

### D3: Enrichment is admin-only and manually triggered; bulk runs as a background Task

**Decision:** `POST /api/v1/authors/enrich` (bulk) and `POST /api/v1/authors/:id/enrich` (single) are protected by `JwtAuthGuard`. Bulk enrichment creates a `Task` record (using the existing `Task` model) so progress is visible in the Tasks tab. Returns 202 Accepted immediately. Single-author enrichment runs synchronously and returns 200.

**Rationale:** Matches existing pattern for long-running jobs (library scan, metadata enrichment). Giving the user a Tasks tab entry means they can see progress and know when it's done without polling or toasts.

### D4: Skip already-enriched authors by default; `force=true` overwrites

**Decision:** Default behaviour skips authors that already have `photoData`. Pass `?force=true` to re-download for all authors including those already enriched.

### D5: AuthorsModule follows SeriesModule pattern

New `AuthorsModule` with `AuthorsController` + `AuthorsService`. Same file structure as `SeriesModule`. No shared service needed.

## Risks / Trade-offs

- **Open Library name matching is fuzzy** → The top search result may not be the correct author. Mitigation: require an exact case-insensitive name match before accepting; if no exact match, leave `photoData` null.
- **Rate limits on bulk enrichment** → Open Library doesn't publish hard limits but recommends throttling. Mitigation: 200 ms delay between per-author requests in bulk mode.
- **Large photo bytes in DB** → Open Library `-M` size images are typically 10–30 KB each. For a library with hundreds of authors this is negligible.

## Migration Plan

1. Add `photoData Bytes?` to `Author` in `schema.prisma`
2. Run `prisma migrate dev --name add-author-photo-data`
3. No data migration needed (column is nullable)
4. Deploy API with new `AuthorsModule`
5. Deploy frontend with new page + navbar link
6. Admin triggers enrichment manually post-deploy

Rollback: revert migration (column removal is safe — nullable, only read by new code).

## Open Questions

- None outstanding.
