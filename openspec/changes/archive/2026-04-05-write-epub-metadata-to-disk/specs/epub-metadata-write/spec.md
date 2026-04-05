## ADDED Requirements

### Requirement: Write epub metadata button in book modal

The book modal SHALL display a yellow "Write to File" button for books that have at least one epub file. The button SHALL be enabled only when both conditions are true: the admin `allow_disk_writes` setting is `true` AND the library directory is not mounted read-only (as reported by the server capabilities). When either condition is false, the button SHALL be visible but disabled with a tooltip explaining why.

#### Scenario: Button enabled when writes allowed and directory writable

- **WHEN** the book has an epub file AND `allowDiskWrites` is `true` AND `isReadOnlyMount` is `false`
- **THEN** the "Write to File" button is enabled and clickable

#### Scenario: Button disabled when disk writes not allowed in admin settings

- **WHEN** `allowDiskWrites` is `false`
- **THEN** the "Write to File" button is visible but disabled with tooltip "Enable disk writes in Admin → Disk Settings"

#### Scenario: Button disabled when library directory is read-only

- **WHEN** `isReadOnlyMount` is `true`
- **THEN** the "Write to File" button is visible but disabled with tooltip "Library directory is read-only"

#### Scenario: Button hidden for non-epub books

- **WHEN** the book has no epub files (only mobi, cbz, pdf, etc.)
- **THEN** the "Write to File" button is not rendered

### Requirement: Write metadata to epub file on demand

The system SHALL provide a `POST /api/v1/books/:bookId/write-epub-metadata` endpoint (admin-only, JWT-protected) that writes the book's current Litara metadata into its primary epub file on disk. Only metadata fields with a non-null, non-empty value SHALL be written; fields with no value SHALL be left unchanged in the OPF. The write SHALL use a temp-file strategy: write to a temp file first, then atomically replace the original on success.

#### Scenario: Successful metadata write

- **WHEN** a valid bookId is provided AND the book has an epub file AND the disk is writable
- **THEN** the endpoint returns `{ success: true, filePath: string }` and the epub OPF is updated with current metadata

#### Scenario: Book has no epub file

- **WHEN** the book exists but has no epub BookFile
- **THEN** the endpoint returns 422 Unprocessable Entity with message "No epub file found for this book"

#### Scenario: Disk write guard blocks the request

- **WHEN** `allow_disk_writes` is `false` in admin settings
- **THEN** the endpoint returns 403 Forbidden

#### Scenario: Only fields with values are written

- **WHEN** a book has `title = "Dune"` and `subtitle = null`
- **THEN** the OPF `<dc:title>` is updated to "Dune" and no subtitle element is added or modified

### Requirement: OPF metadata field mapping

The write service SHALL map Litara metadata fields to OPF/Dublin Core elements as follows: `title` → `<dc:title>`, `description` → `<dc:description>`, `authors` → `<dc:creator>` (one element per author, replacing all existing creators), `publisher` → `<dc:publisher>`, `publishedDate` → `<dc:date>`, `language` → `<dc:language>`, `isbn13` → `<dc:identifier opf:scheme="ISBN-13">`, `isbn10` → `<dc:identifier opf:scheme="ISBN-10">`, `genres` and `tags` → `<dc:subject>` (combined, deduplicated, replacing all existing subjects), `seriesName` → `<meta name="calibre:series">`, `seriesNumber` → `<meta name="calibre:series_index">`, `subtitle` → `<meta property="dcterms:alternative">`.

#### Scenario: Authors replace existing OPF creators

- **WHEN** the epub OPF has `<dc:creator>Old Author</dc:creator>` and Litara has authors ["New Author A", "New Author B"]
- **THEN** the OPF is updated to have two `<dc:creator>` elements and the old one is removed

#### Scenario: Genres and tags combined as subjects

- **WHEN** Litara has genres ["Science Fiction"] and tags ["space", "classic"]
- **THEN** the OPF has `<dc:subject>` elements for "Science Fiction", "space", and "classic" (deduplicated)

### Requirement: Admin setting — auto-write metadata to epub on enrichment

The admin settings page SHALL include a toggle **"Auto-write metadata to epub after enrichment"** (default off). When enabled, the bulk metadata enrichment pipeline SHALL call the epub write service for each book after applying enriched metadata, but only for books that have an epub file. This setting SHALL be stored as `auto_write_metadata_on_enrich` in `ServerSettings`. This toggle SHALL only be interactive when `allowDiskWrites` is `true` AND `isReadOnlyMount` is `false`; otherwise it is disabled with an explanatory note.

#### Scenario: Auto-write enabled — enrichment writes to epub

- **WHEN** `auto_write_metadata_on_enrich` is `true` AND a bulk enrichment completes for a book with an epub file
- **THEN** the epub write service is called for that book immediately after metadata is saved to the database

#### Scenario: Auto-write enabled — non-epub books skipped silently

- **WHEN** `auto_write_metadata_on_enrich` is `true` AND a bulk enrichment completes for a book with no epub file
- **THEN** no write attempt is made and no error is logged

#### Scenario: Auto-write disabled — enrichment does not touch files

- **WHEN** `auto_write_metadata_on_enrich` is `false`
- **THEN** enrichment runs as before without modifying any epub files

#### Scenario: Toggle disabled when disk writes not allowed

- **WHEN** `allowDiskWrites` is `false` OR `isReadOnlyMount` is `true`
- **THEN** the auto-write toggle is shown but disabled in admin settings

### Requirement: Epub write is safe against file corruption

The write service SHALL write epub metadata changes to a temporary file in the same directory before replacing the original. If any step fails (ZIP parse, XML patch, temp write), the original file SHALL remain unmodified.

#### Scenario: Write failure leaves original intact

- **WHEN** an error occurs during the OPF XML patching step
- **THEN** the original epub file is not modified and the endpoint returns 500 with the error message

#### Scenario: Successful write replaces original atomically

- **WHEN** the temp file is written successfully
- **THEN** it is renamed over the original epub file path
