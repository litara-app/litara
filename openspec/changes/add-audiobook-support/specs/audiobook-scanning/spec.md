## ADDED Requirements

### Requirement: Audiobook folder detection heuristic

The system SHALL classify a folder (or single file) as an audiobook when any of the following conditions are met:

- The folder contains one or more `.m4b` or `.m4a` files
- The folder contains three or more `.mp3` files
- A single `.mp3` or `.m4a` file exists with an audio duration greater than 2700 seconds (45 minutes)

Cover art files (`.jpg`, `.jpeg`, `.png`) and sidecar files (`.cue`, `metadata.json`) in the folder SHALL NOT count toward the audio file thresholds.

#### Scenario: Folder with m4b files is detected as audiobook

- **WHEN** the scanner encounters a folder containing at least one `.m4b` file
- **THEN** the folder is classified as an audiobook and an `AudiobookFile` record is created for each `.m4b` file

#### Scenario: Folder with three or more mp3 files is detected as audiobook

- **WHEN** the scanner encounters a folder containing exactly three or more `.mp3` files
- **THEN** the folder is classified as an audiobook

#### Scenario: Folder with fewer than three mp3 files is not detected as audiobook

- **WHEN** the scanner encounters a folder containing one or two `.mp3` files and no `.m4b` or `.m4a` files
- **THEN** the folder is NOT classified as an audiobook and the files are ignored

#### Scenario: Single large mp3 file is detected as audiobook

- **WHEN** the scanner encounters a single `.mp3` file whose audio duration exceeds 2700 seconds
- **THEN** the file is classified as a single-file audiobook

#### Scenario: Single short mp3 file is ignored

- **WHEN** the scanner encounters a single `.mp3` file whose audio duration is 2700 seconds or less
- **THEN** the file is ignored by the audiobook scanner

---

### Requirement: Each audiobook folder maps to one Book record

The system SHALL group all audio files within a single folder into one audiobook, linked to one `Book` record. Nested subfolders are treated as separate audiobooks.

#### Scenario: Multi-file audiobook creates one book with multiple AudiobookFile records

- **WHEN** a folder contains multiple `.mp3` files (e.g., `01.mp3`, `02.mp3`, `03.mp3`)
- **THEN** one `Book` record is created (or matched to an existing one) and one `AudiobookFile` record is created per audio file

#### Scenario: Nested subfolder is treated as a separate audiobook

- **WHEN** folder `Audiobooks/Series/Book1/` contains audio files and `Audiobooks/Series/Book2/` contains separate audio files
- **THEN** two separate `Book` records are created, one per subfolder

---

### Requirement: Audiobook file ordering by filename numeric prefix

The system SHALL determine the playback order of audio files by parsing leading numeric prefixes from filenames. Files without a numeric prefix SHALL be sorted alphabetically as a fallback.

Supported prefix formats: `01`, `001`, `01.`, `01 `, `01-`, `1 -`, `01_`.

#### Scenario: Files with two-part numeric prefix are ordered correctly

- **WHEN** a folder contains files named `01 01 - Chapter One.mp3`, `02 02 - Chapter Two.mp3`
- **THEN** `AudiobookFile.fileIndex` is set to 0 and 1 respectively

#### Scenario: Files with single numeric prefix are ordered correctly

- **WHEN** a folder contains files named `01 Chapter One.mp3`, `02 Chapter Two.mp3`
- **THEN** `AudiobookFile.fileIndex` is set to 0 and 1 respectively

#### Scenario: Files without numeric prefix fall back to alphabetical order

- **WHEN** a folder contains files named `alpha.mp3`, `beta.mp3`, `gamma.mp3` with no leading digits
- **THEN** files are ordered alphabetically and assigned `fileIndex` 0, 1, 2

---

### Requirement: Cue file chapter parsing

When a `.cue` file is present alongside audio files, the system SHALL parse it to extract chapter timestamps and titles, using them to populate `AudiobookChapter` records for the associated audio file.

#### Scenario: Cue file parsed to produce chapter records

- **WHEN** a folder contains `audiobook.m4b` and `audiobook.cue`
- **THEN** `AudiobookChapter` records are created for each `TRACK` entry in the `.cue` file, with `startTime` converted from MM:SS:FF format to seconds

#### Scenario: Cue file takes precedence over filename ordering for chapter titles

- **WHEN** both a `.cue` file and numeric filename prefixes are present
- **THEN** chapter titles and timestamps from the `.cue` file are used; filename prefix ordering is used only for `fileIndex`

---

### Requirement: Audiobook scan responds to filesystem changes

The system SHALL detect newly added or removed audiobook files via the existing chokidar watcher and update the database accordingly.

#### Scenario: New audiobook file added to watched folder

- **WHEN** a new `.m4b` file is added to a watched folder at runtime
- **THEN** the scanner creates or updates the associated `Book` and `AudiobookFile` records within the chokidar event debounce window

#### Scenario: Audiobook file removed from watched folder

- **WHEN** an existing `AudiobookFile`'s source file is deleted from the filesystem
- **THEN** the `AudiobookFile` record is deleted; the parent `Book` record is deleted only if it has no remaining `BookFile` or `AudiobookFile` records
