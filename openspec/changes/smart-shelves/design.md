## Context

The `Shelf` model already exists with an `isSmart: Boolean` flag and a `SmartShelfRule` child model (`field`, `operator`, `value` strings). Smart shelves are simply `Shelf` records with `isSmart = true` and one or more associated rules. No separate table is needed. The gap is: there is no AND/OR logic connector on the shelf, the rules are not evaluated anywhere, and there is no dedicated API surface or UI.

## Goals / Non-Goals

**Goals:**

- Add a `logic` field (`AND` | `OR`) to `Shelf` to control how multiple rules combine
- Implement a `SmartShelvesModule` with full CRUD and a `/books` sub-resource that evaluates rules at query time
- Add a Smart Shelves section to the sidebar with create/edit modal and detail page

**Non-Goals:**

- Nested logic groups (e.g., `(A AND B) OR C`) — top-level AND/OR only for now
- Materialising / caching results — rules are evaluated live on each request
- Sharing shelves between users

## Decisions

### 1 — Reuse `Shelf` model, add `logic` column via migration

`SmartShelfRule` is already linked to `Shelf`. Adding `logic String @default("AND")` to `Shelf` avoids a new table and keeps referential integrity simple.

**Alternative considered:** Separate `SmartShelf` table — rejected because it duplicates the shelf concept and orphans the existing `SmartShelfRule` relation.

### 2 — Dedicated `SmartShelvesModule` (not merged into `ShelvesModule`)

Smart shelves have a fundamentally different read path (rule evaluation vs. manual book list). Keeping them separate avoids bloating the shelves module and makes the rule-evaluation logic easy to test in isolation.

### 3 — Server-side rule evaluation via Prisma `where` clauses

Rules are translated to Prisma filter fragments at query time and composed with `AND` / `OR`. This keeps the DB doing the heavy lifting and avoids syncing a materialised list.

Supported fields and their Prisma mapping:

| Field           | Prisma path                       | Type              |
| --------------- | --------------------------------- | ----------------- |
| `title`         | `book.title`                      | string            |
| `author`        | `book.authors.some.author.name`   | string (relation) |
| `genre`         | `book.genres.some.name`           | string (relation) |
| `tag`           | `book.tags.some.name`             | string (relation) |
| `language`      | `book.language`                   | string            |
| `publisher`     | `book.publisher`                  | string            |
| `seriesName`    | `book.series.some.series.name`    | string (relation) |
| `format`        | `book.files.some.format`          | string (relation) |
| `pageCount`     | `book.pageCount`                  | number            |
| `publishedYear` | derived from `book.publishedDate` | number            |
| `isbn13`        | `book.isbn13`                     | string            |

Supported operators: `eq`, `ne`, `contains`, `startsWith`, `gt`, `lt`

### 4 — Rule operators map to Prisma filter modes

| Operator     | Prisma equivalent                            |
| ------------ | -------------------------------------------- |
| `eq`         | `equals` / `{ equals: value }`               |
| `ne`         | `not: { equals: value }`                     |
| `contains`   | `{ contains: value, mode: 'insensitive' }`   |
| `startsWith` | `{ startsWith: value, mode: 'insensitive' }` |
| `gt`         | `{ gt: Number(value) }`                      |
| `lt`         | `{ lt: Number(value) }`                      |

### 5 — Frontend: modal for create/edit, dedicated page for book list

The modal uses a dynamic rule builder (add/remove rows, each row = field select + operator select + value input). The detail page reuses existing book card components.

## Risks / Trade-offs

- **`publishedYear` filter** requires filtering in application code or a raw query since Prisma doesn't expose year extraction — apply a date range (`gte: Jan 1 YYYY`, `lt: Jan 1 YYYY+1`) as the Prisma filter instead.
- **Large libraries** — rule evaluation is an unbounded query; add a reasonable limit (e.g., 500 books) with a count response so the UI can show "showing X of Y".
- **Invalid rules** — empty or malformed rules are skipped server-side rather than returning an error, so a shelf with all-invalid rules returns an empty list gracefully.

## Migration Plan

1. Add `logic String @default("AND")` to `Shelf` in `schema.prisma`
2. Generate migration: `npx prisma migrate dev --name add_shelf_logic`
3. Deploy with `prisma migrate deploy` (runs automatically on API startup)
4. No rollback needed — the column has a default value and existing rows are unaffected
