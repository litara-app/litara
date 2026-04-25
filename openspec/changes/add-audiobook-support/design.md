## Context

Litara is a NestJS + React monorepo ebook manager. It already has a `LibraryModule` with a `LibraryScannerService` that watches folders for ebook files (epub, mobi, cbz, pdf, etc.) and stores them in a Postgres database via Prisma. A React Native app exists at `apps/mobile` and consumes the same REST API.

Audiobook files (`.m4b`, `.mp3`, `.m4a`) are currently ignored by the scanner entirely. Users who own audiobooks cannot use Litara to manage or play them.

## Goals / Non-Goals

**Goals:**

- Detect audiobook files during library scan (m4b, m4a, mp3 folders, single large mp3/m4a)
- Extract metadata (title, author, narrator, duration, cover art, chapters) from audio files
- Stream audio via HTTP Range requests for simple, dependency-free playback on web and mobile
- Provide a persistent web player (React + Mantine) with speed control, chapter navigation, volume control, and timestamped bookmarks
- Provide a React Native player with the same controls, background playback, and lock screen controls
- Sync playback position per-user across sessions and devices

**Non-Goals:**

- Podcast or music library management
- Transcoding audiobooks to different formats (e.g., mp3 → m4b)
- Full Audiobookshelf migration tooling (metadata.json is read if present, but not a primary flow)
- Downloading or purchasing audiobooks from external stores
- DRM-protected audiobook handling

## Decisions

### 1. Direct Range-based Streaming (not HLS)

**Decision**: Serve audio files directly via HTTP `Accept-Ranges` byte-range requests. Authenticated via a short-lived stream token (`?streamToken=<token>`) so the `<audio>` element never embeds the user's JWT in the URL.

**Rationale**: Range-based streaming is simpler, requires no server-side transcoding, no disk cache, and no additional binaries. It works natively with the HTML5 `<audio>` element and with React Native's audio libraries. Multi-file seeking is handled client-side by tracking per-file `fileStartOffset` values computed from the duration list returned by the API.

**Implementation details**:

- Stream token issued via `POST /api/v1/audiobooks/stream-token` (JWT-authenticated). Token is short-lived (4 hours).
- `GET /api/v1/audiobooks/:bookId/files/:fileIndex/stream?streamToken=<token>` serves the raw file with `Content-Range` support.
- Download endpoint: `GET /api/v1/audiobooks/:bookId/files/:fileIndex/download` (JWT-authenticated).

### 2. music-metadata for Tag Extraction

**Decision**: Use `music-metadata` (npm) to read audio file tags (ID3v2/ID3v3 for mp3, MP4 atoms for m4b/m4a).

**Rationale**: Pure JavaScript, no native binaries, handles all relevant formats including embedded cover art and chapter markers (MP4 `chpl` atom). Actively maintained. Alternative `node-taglib2` requires native compilation which breaks on some platforms.

### 3. Unified Book Entity (not a separate Audiobook table)

**Decision**: Add `AudiobookFile` and `AudiobookChapter` models that relate to the existing `Book` model. `Book` gains a `hasAudiobook` boolean computed from the presence of `AudiobookFile` records.

**Rationale**: User chose the unified entity approach so that a book with both epub and m4b is represented as one `Book` record. Avoids duplication of title/author/cover metadata. Simpler UI (one detail page shows both formats).

**Schema additions**:

```
model AudiobookFile {
  id          String   @id @default(uuid())
  bookId      String
  book        Book     @relation(fields: [bookId], references: [id], onDelete: Cascade)
  filePath    String   @unique
  fileHash    String
  fileIndex   Int      // ordering within multi-file audiobook
  duration    Float    // seconds
  mimeType    String   // audio/mp4, audio/mpeg
  narrator    String?
  createdAt   DateTime @default(now())
  chapters    AudiobookChapter[]
}

model AudiobookChapter {
  id              String        @id @default(uuid())
  audiobookFileId String
  audiobookFile   AudiobookFile @relation(fields: [audiobookFileId], references: [id], onDelete: Cascade)
  index           Int
  title           String
  startTime       Float         // seconds within file
  endTime         Float?        // null = end of file
}

model AudiobookProgress {
  id              String   @id @default(uuid())
  userId          String
  bookId          String
  currentFileIndex Int     @default(0)
  currentTime     Float    @default(0)  // seconds within current file
  totalDuration   Float    // total seconds across all files
  completedAt     DateTime?
  updatedAt       DateTime @updatedAt
  @@unique([userId, bookId])
}

model AudiobookBookmark {
  id          String   @id @default(uuid())
  userId      String
  bookId      String
  timeSeconds Float    // absolute position within total audiobook duration
  note        String   @default("")
  createdAt   DateTime @default(now())
}
```

### 4. Chapter Detection Priority

**Decision**: Priority order for chapter data:

1. Embedded MP4 `chpl` chapter atoms in `.m4b` files (parsed by `music-metadata`)
2. `.cue` file in the same folder as the audio file(s)
3. Numeric prefix from filename (`01`, `001`, `1.`, `01.` etc.)
4. Alphabetical sort fallback

**Rationale**: Embedded chapters are most accurate. `.cue` files are common for ripped single-file audiobooks. Filename prefix is the predominant convention for multi-file audiobooks downloaded from online stores. Alphabetical covers the remainder.

### 5. Audiobook Folder Detection Heuristic

**Decision**: A folder (or single file) is classified as an audiobook if:

- It contains 1+ `.m4b` or `.m4a` files, OR
- It contains 3+ `.mp3` files (minimum to distinguish from a single music track with bonus tracks), OR
- It is a single `.mp3` or `.m4a` file with `duration > 2700 seconds` (45 minutes)

The threshold for single `.mp3` was set at 45 minutes based on the user's note that some audiobooks are delivered as a single file. Cover art (`.jpg`/`.png` in the folder) and metadata sidecars (`.cue`, `metadata.json`) are treated as companion files, not audio files.

### 6. Persistent Web Player

**Decision**: The web player is a fixed bottom bar (88px, full-width) rendered in `AppShell.Footer`, persisting across navigation. It reads from a global Jotai atom (`audiobookPlayerAtom`) set when the user clicks "Play Audiobook" from a book detail page.

**Rationale**: Allows continuous listening while browsing the library. The Mantine `AppShell.Footer` automatically adjusts the navbar and main content area so no UI elements are hidden behind the player.

**Features**: Play/pause, skip chapter (±), skip 60s (±), progress scrub bar, volume control, speed cycle (0.5×/1×/1.5×/2×), chapter list panel, timestamped bookmark panel, close button.

## Risks / Trade-offs

- **[Risk] music-metadata chapter parsing incomplete** → Mitigation: Fall through to .cue / filename parsing if embedded chapters are absent or malformed.
- **[Risk] Multi-file audiobook matching** (which files belong together) → Mitigation: Files in the same folder are grouped into one audiobook. Each folder = one audiobook entry. Nested subfolders are treated as separate audiobooks.
- **[Risk] react-native-track-player upgrade friction** → Mitigation: RNTP v4+ uses an Expo-compatible API; pin to a specific minor version in `package.json`.

## Migration Plan

1. Apply new Prisma migration (`add-audiobook-tables`) to add `AudiobookFile`, `AudiobookChapter`, `AudiobookProgress`, `AudiobookBookmark` tables and `Book.hasAudiobook` column.
2. On next API startup, `LibraryScannerService` performs a full re-scan; audiobook files in watched folders are detected and imported. Existing ebook `Book` records are untouched unless audiobook files for the same title/author are found in the same folder.
3. `apps/mobile` updated with RNTP installation and new player screen. Existing screens unaffected.

**Rollback**: Drop the new Prisma models and the `Book.hasAudiobook` column. No ebook data is affected.

## Open Questions

- Should audiobook metadata enrichment (narrator, description) be pulled from Audible / Google Books / Hardcover? Not in this change; metadata providers can be extended later.
