## ADDED Requirements

### Requirement: Audio tag extraction via music-metadata

The system SHALL use `music-metadata` to extract the following fields from audio files during scan, populating the associated `Book` and `AudiobookFile` records:

| Field     | Source tag                                    | Target                           |
| --------- | --------------------------------------------- | -------------------------------- |
| Title     | `common.album` (m4b/mp3) or `common.title`    | `Book.title`                     |
| Author    | `common.artist` or `common.albumartist`       | `Book.authors`                   |
| Narrator  | `common.composer` or custom `NART`/`©nrt` tag | `AudiobookFile.narrator`         |
| Duration  | `format.duration`                             | `AudiobookFile.duration`         |
| Cover art | `common.picture[0]`                           | `Book.coverImage` (stored as-is) |
| Year      | `common.year`                                 | `Book.published`                 |

#### Scenario: Metadata extracted from m4b file

- **WHEN** a `.m4b` file is scanned
- **THEN** `music-metadata` reads the file's MP4 atoms and populates `Book.title`, `Book.authors`, `AudiobookFile.narrator`, `AudiobookFile.duration`, and `Book.coverImage` from the available tags

#### Scenario: Missing tags fall back to filename

- **WHEN** an audio file has no title tag or an empty title tag
- **THEN** `Book.title` is derived from the parent folder name (stripping leading numeric prefixes and common suffixes like ` - Unabridged`)

#### Scenario: Cover art embedded in audio file is stored

- **WHEN** an audio file contains embedded cover art in `common.picture[0]`
- **THEN** the image data is stored as `Book.coverImage` if `Book.coverImage` is currently null

---

### Requirement: Embedded m4b chapter atom parsing

The system SHALL parse embedded chapter markers (`chpl` atom) from `.m4b` files using `music-metadata`, creating `AudiobookChapter` records for each marker.

#### Scenario: m4b with embedded chapters produces chapter records

- **WHEN** a `.m4b` file contains a `chpl` chapter atom with N chapters
- **THEN** N `AudiobookChapter` records are created with `title`, `startTime`, and `endTime` populated from the atom data

#### Scenario: Embedded chapters take priority over filename-derived chapters

- **WHEN** a `.m4b` file has both embedded chapter atoms and a corresponding `.cue` file
- **THEN** the `.cue` file chapter timestamps are used (`.cue` is considered more authoritative for ripped files); embedded chapters are the fallback when no `.cue` is present

---

### Requirement: ABS metadata.json sidecar support

The system SHOULD read an Audiobookshelf-compatible `metadata.json` file when present in the audiobook folder, using it to fill in metadata fields not available from audio tags.

#### Scenario: metadata.json populates narrator when tag is absent

- **WHEN** the audiobook folder contains a `metadata.json` with a `narrator` field and the audio file has no narrator tag
- **THEN** `AudiobookFile.narrator` is set from `metadata.json`

#### Scenario: Audio tags take priority over metadata.json

- **WHEN** both audio tags and `metadata.json` contain a title
- **THEN** the audio tag value is used; `metadata.json` values are only used for fields missing from tags
