---
sidebar_position: 4
---

# Metadata Enrichment API

This page documents the bulk metadata enrichment endpoints added under `BulkMetadataModule`. All routes require a valid JWT and admin role.

## Base path

```
/api/v1/admin/metadata-match
```

## Endpoints

### GET `/config`

Returns the current field-source configuration array stored in `ServerSettings` (key `metadata_field_config`). Falls back to the hardcoded default if not yet saved.

**Response** — array of `FieldConfigItem`:

```json
[
  { "field": "isbn13",      "provider": "open-library", "enabled": true },
  { "field": "title",       "provider": "google-books", "enabled": true },
  { "field": "description", "provider": "google-books", "enabled": true },
  ...
]
```

### PUT `/config`

Saves the field-source configuration.

**Body** — `UpdateFieldConfigDto`:

```json
{
  "config": [
    { "field": "isbn13", "provider": "open-library", "enabled": true },
    ...
  ]
}
```

### GET `/throttle`

Returns the current throttle delay (`ServerSettings` key `metadata_match_throttle_ms`, default 500).

```json
{ "throttleMs": 500 }
```

### PUT `/throttle`

Updates the throttle delay (50–5000 ms).

```json
{ "throttleMs": 800 }
```

### POST `/candidates`

Fetches up to 3 Open Library candidates for a given book, used by the guided disambiguation modal.

**Body** — `CandidatesRequestDto`:

```json
{ "bookId": "clxxx...", "limit": 3 }
```

**Response** — array of `CandidateDto`:

```json
[
  {
    "openLibraryKey": "/works/OL1234W",
    "title": "The Hobbit",
    "authors": ["J.R.R. Tolkien"],
    "year": 1937,
    "coverUrl": "https://covers.openlibrary.org/b/id/8406786-M.jpg",
    "isbn13": "9780261102217"
  }
]
```

### POST `/run`

Starts a bulk enrichment run as a background job. Returns the created `Task` ID immediately.

**Body** — `RunBulkMatchDto`:

```json
{
  "scope": "library",
  "scopeId": "clxxx...",
  "overwrite": false,
  "guidedSelections": [
    {
      "bookId": "clyyy...",
      "openLibraryKey": "/works/OL1234W",
      "isbn13": "9780261102217"
    }
  ],
  "throttleMs": 500
}
```

| Field              | Type                            | Description                                                   |
| ------------------ | ------------------------------- | ------------------------------------------------------------- |
| `scope`            | `"all" \| "library" \| "shelf"` | Which books to process                                        |
| `scopeId`          | string (optional)               | ID of the library or shelf when scope is not `"all"`          |
| `overwrite`        | boolean (optional)              | Replace existing field values (default: `false`)              |
| `guidedSelections` | array (optional)                | Explicit Open Library key + ISBN per book from disambiguation |
| `throttleMs`       | number (optional)               | Override the saved throttle for this run                      |

**Response**:

```json
{ "taskId": "clzzz..." }
```

### POST `/cancel/:taskId`

Sets the task status to `CANCELLED`. The background loop checks cancellation at the start of each book and exits cleanly.

Returns `204 No Content`.

### GET `/tasks`

Returns the 20 most recent `BULK_METADATA_MATCH` tasks, ordered newest first.

### GET `/task/:taskId`

Returns a single task for polling. The `payload` field contains progress information:

```json
{
  "id": "clzzz...",
  "status": "PROCESSING",
  "payload": {
    "processed": 12,
    "total": 48,
    "currentBook": "The Name of the Wind"
  }
}
```

## Architecture notes

- **Provider chaining** — `BulkMetadataService` always calls the ISBN-13 provider first. The resolved ISBN is injected into `EnrichInput.isbn13` for every subsequent provider call, improving match accuracy.
- **Field-level apply** — only the fields in the active config (enabled + assigned to a provider) are written. Other fields are untouched.
- **Background jobs** — runs are fire-and-forget async methods; the controller returns the `taskId` before enrichment begins. Progress is tracked by updating the `Task.payload` JSON blob after each book.
- **Cancellation** — the loop re-fetches the `Task` row at the start of each iteration. If the status is `CANCELLED` it exits without processing further books.
