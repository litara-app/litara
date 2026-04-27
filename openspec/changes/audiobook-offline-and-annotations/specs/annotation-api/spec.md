## MODIFIED Requirements

### Requirement: Annotation type enum

The `Annotation` model SHALL include a `type` field using a `AnnotationType` enum with values `HIGHLIGHT`, `UNDERLINE`, `STRIKETHROUGH`, and `BOOKMARK`. The default value SHALL be `HIGHLIGHT`. Existing rows without a type SHALL be migrated to `HIGHLIGHT`.

Annotations with `type: BOOKMARK` and a location string beginning with `audiobook:` are audiobook bookmarks. The location format for audiobook bookmarks SHALL be `audiobook:<fileIndex>:<timestamp>` where `fileIndex` is the zero-based integer index of the `AudiobookFile` and `timestamp` is the playback position in seconds (e.g., `audiobook:0:432.5`). The `text` field SHALL be null for audiobook bookmarks. The `note` field stores the optional user label.

#### Scenario: Default type on existing rows

- **WHEN** the migration runs on a database with existing Annotation rows that have no `type` value
- **THEN** all existing rows SHALL have `type` set to `HIGHLIGHT`

#### Scenario: Bookmark has no required text

- **WHEN** a `BOOKMARK` annotation is created with no `text` field
- **THEN** the annotation SHALL be saved successfully with `text` as null

#### Scenario: Audiobook bookmark location format

- **WHEN** a `BOOKMARK` annotation is created for an audiobook position at file index 1, timestamp 3661.2 seconds
- **THEN** the annotation is saved with `location: "audiobook:1:3661.2"` and `text: null`

---

## REMOVED Requirements

### Requirement: AudiobookBookmark dedicated endpoints

**Reason**: Replaced by the standard annotation API. Audiobook bookmarks are now `Annotation` records with `type: BOOKMARK` and an `audiobook:<fileIndex>:<timestamp>` location prefix, giving them first-class status on the Annotations page and in annotation filtering.

**Migration**:

- A Prisma migration copies all `AudiobookBookmark` rows into the `Annotation` table (`type=BOOKMARK`, `location=audiobook:<fileIndex>:<timestamp>`, `note=note`, `text=NULL`, `color=NULL`) then drops the `AudiobookBookmark` table.
- `GET /api/v1/audiobooks/:bookId/bookmarks` → use `GET /api/v1/books/:bookId/annotations?type=BOOKMARK` and filter client-side for entries whose location starts with `audiobook:`.
- `POST /api/v1/audiobooks/:bookId/bookmarks` → use `POST /api/v1/books/:bookId/annotations` with `{ type: "BOOKMARK", location: "audiobook:<fileIndex>:<timestamp>", note: "<label>" }`.
- `DELETE /api/v1/audiobooks/:bookId/bookmarks/:id` → use `DELETE /api/v1/books/:bookId/annotations/:id`.
