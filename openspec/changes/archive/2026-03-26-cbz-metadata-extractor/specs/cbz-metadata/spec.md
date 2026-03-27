## ADDED Requirements

### Requirement: Extract metadata from ComicInfo.xml

The system SHALL parse `ComicInfo.xml` from the root of a CBZ archive and map its fields to the standard `ExtractedFileMetadata` interface. Mapped fields: `Title` → title, `Writer` → authors (split on `,`), `Publisher` → publisher, `Series` → series name stored in ids, `Year`/`Month`/`Day` → publishedDate, `Summary` → description, `LanguageISO` → language, `Genre` → subjects (split on `,`), `Tags` → subjects (appended, split on `,`).

#### Scenario: CBZ with ComicInfo.xml containing full metadata

- **WHEN** `extractCbzMetadata` is called on a CBZ archive that contains a valid `ComicInfo.xml` with Title, Writer, Publisher, and Year fields
- **THEN** the returned metadata SHALL have title, authors, publisher, and publishedDate populated from the XML values

#### Scenario: CBZ with ComicInfo.xml containing multiple writers

- **WHEN** the `Writer` field in `ComicInfo.xml` is `"John Smith, Jane Doe"`
- **THEN** the returned authors array SHALL be `["John Smith", "Jane Doe"]`

#### Scenario: CBZ without ComicInfo.xml

- **WHEN** `extractCbzMetadata` is called on a CBZ archive that contains no `ComicInfo.xml`
- **THEN** the returned metadata SHALL have title derived from the filename and an empty authors array

#### Scenario: ComicInfo.xml with missing optional fields

- **WHEN** `ComicInfo.xml` is present but omits Publisher, Summary, and LanguageISO
- **THEN** those fields SHALL be `undefined` in the returned metadata (not empty strings)

### Requirement: Extract cover image from CBZ archive

The system SHALL extract the cover image from a CBZ archive and return it as a `Buffer`.

#### Scenario: Archive with FrontCover page tag

- **WHEN** `ComicInfo.xml` contains a `<Pages>` element with a page marked `Type="FrontCover"` at index N
- **THEN** `extractCbzCover` SHALL return the image at position N (zero-indexed) in the sorted image list

#### Scenario: Archive without FrontCover tag

- **WHEN** no `FrontCover` page tag exists in `ComicInfo.xml`, or there is no `ComicInfo.xml`
- **THEN** `extractCbzCover` SHALL return the first alphabetically-sorted image entry in the archive

#### Scenario: Archive with no image files

- **WHEN** the CBZ archive contains no `.jpg`, `.jpeg`, `.png`, `.gif`, or `.webp` files
- **THEN** `extractCbzCover` SHALL return `undefined`

### Requirement: Integration with file metadata extraction pipeline

The system SHALL route CBZ and CBR file extensions through `extractCbzMetadata` in the shared `extractFileMetadata` function.

#### Scenario: CBZ file processed by scanner

- **WHEN** the library scanner imports a `.cbz` file
- **THEN** `extractFileMetadata` SHALL call the CBZ parser and return populated metadata fields instead of the filename-only fallback

#### Scenario: Cover extraction for CBZ books

- **WHEN** the library scanner attempts cover extraction for a `.cbz` file
- **THEN** it SHALL call `extractCbzCover` and store the result in `book.coverData`
