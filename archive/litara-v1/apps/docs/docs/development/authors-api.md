---
sidebar_position: 5
---

# Authors API

This page documents the `AuthorsModule` endpoints added under `/api/v1/authors`. The module handles author listing, detail retrieval, photo streaming, and Open Library enrichment.

## Data model

The `Author` model in `prisma/schema.prisma`:

| Column        | Type      | Notes                                               |
| ------------- | --------- | --------------------------------------------------- |
| `id`          | `String`  | UUID primary key                                    |
| `name`        | `String`  | Unique, used as the upsert key when scanning books  |
| `biography`   | `String?` | Fetched from Open Library                           |
| `photoData`   | `Bytes?`  | JPEG bytes stored directly in the database          |
| `goodreadsId` | `String?` | Fetched from `remote_ids.goodreads` on Open Library |

Authors are created automatically by the library scanner when a new book is imported. They are deleted automatically when the last book linked to them is removed.

## Base path

```
/api/v1/authors
```

## Endpoints

### GET `/`

Returns all authors who have at least one book in the library, ordered alphabetically.

**Auth:** JWT required.

**Response** — array of `AuthorListItemDto`:

```json
[
  {
    "id": "uuid",
    "name": "Ursula K. Le Guin",
    "hasCover": true,
    "bookCount": 7
  }
]
```

---

### GET `/:id`

Returns full detail for a single author, including their book list.

**Auth:** JWT required.

**Response** — `AuthorDetailDto`:

```json
{
  "id": "uuid",
  "name": "Ursula K. Le Guin",
  "hasCover": true,
  "biography": "Ursula Kroeber Le Guin was an American author...",
  "goodreadsId": "874602",
  "books": [
    {
      "id": "uuid",
      "title": "The Left Hand of Darkness",
      "hasCover": true,
      "coverUpdatedAt": "2024-01-15T10:30:00.000Z",
      "formats": ["EPUB"]
    }
  ]
}
```

Returns **404** if the author id does not exist.

---

### GET `/:id/photo`

Streams the stored `photoData` bytes as `image/jpeg`. Intended for direct use in `<img>` tags.

**Auth:** None required (browser image compatibility).

**Response headers:**

- `Content-Type: image/jpeg`
- `Cache-Control: public, max-age=31536000`

Returns **404** if no photo is stored for the author.

---

### POST `/enrich`

Enqueues a background task to enrich all authors missing a photo, biography, or Goodreads ID from Open Library. Supports `?force=true` to re-enrich authors that already have data.

**Auth:** JWT required.

**Returns:** `202 Accepted`

```json
{ "taskId": "uuid", "total": 142 }
```

Task progress is visible via the Tasks API. The payload includes `processed`, `total`, and `currentAuthorName`.

---

### POST `/:id/enrich`

Synchronously enriches a single author and returns the updated detail.

**Auth:** JWT required.

**Query params:** `force=true` — overwrite existing data.

**Returns:** `200` with `AuthorDetailDto`, or **404** if the author does not exist.

---

## Enrichment flow

`fetchAuthorDataFromOpenLibrary` in `AuthorsService` follows this three-step sequence:

1. **Author search** — `GET https://openlibrary.org/search/authors.json?q=<name>`
   Finds an exact case-insensitive name match. If no match, returns early.

2. **Author detail** — `GET https://openlibrary.org/authors/<OLID>.json`
   Extracts `photos[]`, `bio` (plain string or `/type/text` object), and `remote_ids.goodreads`.

3. **Photo download** — `GET https://covers.openlibrary.org/a/id/<photoId>-M.jpg`
   Downloads the JPEG bytes.

**Photo guardrails:** bytes are discarded if they are fewer than 2000 bytes or do not begin with the JPEG magic sequence `FF D8 FF`. This prevents storing placeholder images that Open Library returns for authors with no real photo.

Each step uses `AbortSignal.timeout(10000)` (10 s). Failed requests are logged with the URL and fall back gracefully — a missing photo does not prevent biography or Goodreads ID from being saved.

Bulk enrichment applies a 200 ms inter-request delay and respects task cancellation between authors.

## Author cleanup

`BooksService.pruneOrphanedAuthors` is called after any book deletion or author reassignment. It checks whether each previously-linked author still has at least one `BookAuthor` row, and deletes the `Author` record if not. This keeps the author table clean without requiring a scheduled job.

The method is invoked from:

- `deleteBook` — after the book record is removed
- `replaceAuthors` — after author links are swapped during a metadata update
- `matchBook` — after the source book is merged into the target
