---
sidebar_position: 6
---

# Reading Queue API

This page documents the `ReadingQueueModule` endpoints added under `/api/v1/reading-queue`.

## Data model

The `ReadingQueueItem` model in `prisma/schema.prisma`:

| Column     | Type       | Notes                                |
| ---------- | ---------- | ------------------------------------ |
| `id`       | `String`   | UUID primary key                     |
| `userId`   | `String`   | FK → `User`, cascade delete          |
| `bookId`   | `String`   | FK → `Book`, cascade delete          |
| `position` | `Int`      | 0-based ordering index               |
| `addedAt`  | `DateTime` | Timestamp of when the book was added |

Constraints:

- `@@unique([userId, bookId])` — a book may only appear once per user's queue
- `@@index([userId, position])` — efficient ordered reads

## Base path

```
/api/v1/reading-queue
```

All endpoints require a JWT (`Authorization: Bearer <token>`).

## Endpoints

### GET `/`

Returns the authenticated user's queue ordered by `position` ascending.

**Auth:** JWT required.

**Response** — array of `ReadingQueueItemDto`:

```json
[
  {
    "id": "uuid",
    "bookId": "uuid",
    "position": 0,
    "addedAt": "2026-04-12T02:39:08.000Z",
    "title": "Dune",
    "authors": ["Frank Herbert"],
    "hasCover": true,
    "coverUpdatedAt": "2026-04-12T00:00:00.000Z",
    "formats": ["EPUB"],
    "hasFileMissing": false
  }
]
```

---

### POST `/`

Adds a book to the end of the queue (idempotent — if the book is already present, the request succeeds without creating a duplicate).

**Auth:** JWT required.

**Request body:**

```json
{ "bookId": "uuid" }
```

**Response** — the created (or existing) `ReadingQueueItemDto`.

Returns **404** if `bookId` does not exist in the library.

---

### DELETE `/:bookId`

Removes a book from the queue by `bookId` (not queue item `id`). Silently succeeds if the book is not in the queue.

**Auth:** JWT required.

**Response:** `204 No Content`

---

### PUT `/order`

Replaces the full queue order. Accepts the desired `bookId` sequence and assigns positions `0, 1, 2, …` in a single database transaction.

**Auth:** JWT required.

**Request body:**

```json
{ "bookIds": ["uuid-a", "uuid-b", "uuid-c"] }
```

**Response:** `200 OK` (empty body)

The full-array approach is used rather than per-item swaps because `@dnd-kit` produces a new full sorted array on drag end. This keeps the server simple and eliminates partial-update race conditions.

---

## `inReadingQueue` on book detail

`BooksService.findOne` includes a `readingQueue` relation filtered to the requesting user:

```ts
readingQueue: { where: { userId }, select: { id: true } }
```

The `BookDetailDto` exposes this as `inReadingQueue: boolean` (`readingQueue.length > 0`). The web frontend uses this to initialise the "In Reading Queue" button state when opening the book detail panel, avoiding a separate queue fetch.

---

## Service implementation notes

### Idempotent `addToQueue`

`ReadingQueueService.addToQueue` uses `upsert` with a no-op `update: {}` to handle the duplicate case safely under concurrent requests:

```ts
await this.prisma.readingQueueItem.upsert({
  where: { userId_bookId: { userId, bookId } },
  update: {},
  create: { userId, bookId, position: nextPosition },
});
```

`nextPosition` is derived from `MAX(position) + 1` within the user's queue, defaulting to `0` for an empty queue.

### Full-array reorder transaction

`reorderQueue` issues one `updateMany` per item inside a `$transaction`:

```ts
await this.prisma.$transaction(
  bookIds.map((bookId, position) =>
    this.prisma.readingQueueItem.updateMany({
      where: { userId, bookId },
      data: { position },
    }),
  ),
);
```

This keeps positions consistent even if the client sends a subset of book IDs (items not mentioned retain their old positions, which is a valid edge-case behaviour).
