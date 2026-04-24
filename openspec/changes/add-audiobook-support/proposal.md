## Why

Litara currently manages ebooks but has no audiobook support, leaving users who own both formats (or only audiobooks) unable to use it as their single book library. Adding audiobook support — with cross-session progress sync and direct range-based streaming — makes Litara a complete self-hosted library for all book media.

## What Changes

- **BREAKING**: `Book` entity gains an `hasAudiobook` flag and a new `AudiobookFile` relation; the library scanner gains audiobook detection logic
- New `AudiobookModule` with scanner, range-based streaming endpoint, and metadata extraction
- Audiobook folder detection heuristic: a folder with 1+ `.m4b` files, 3+ `.mp3` files, or a single `.mp3`/`.m4a` file with duration >45 minutes is treated as an audiobook
- Chapter ordering: parse leading numeric prefixes from filenames (e.g., `01`, `001`), fall back to `.cue` file timestamps if present, then fall back to alphabetical sort
- Embedded m4b chapter atoms are parsed when present and used as chapter markers within a single file
- ABS (`metadata.json`) metadata is read if present (nice-to-have, non-blocking)
- Audio served via HTTP Range requests (no transcoding, no disk cache, no additional binaries)
- Persistent web player (React + Mantine) fixed at the bottom of the screen with speed control, chapter list, volume control, timestamped bookmarks, and keyboard shortcuts
- React Native player in `apps/mobile` with speed control and chapter navigation
- Playback position synced to the API after every 10 seconds of play and on pause/close
- Unified `Book` detail page shows a "Read" and "Listen" toggle when both ebook and audiobook exist for the same title

## Capabilities

### New Capabilities

- `audiobook-scanning`: Detect and import audiobook files (m4b, mp3 folders, single large mp3) during library scan; parse chapter order from filenames and .cue files
- `audiobook-metadata`: Extract title, author, narrator, duration, cover art, and chapter list from audio file tags (via `music-metadata`) and optional sidecar files
- `audiobook-player-web`: Persistent bottom-bar audiobook player with speed control, chapter list, volume control, timestamped bookmarks, scrubbing, and position sync
- `audiobook-player-mobile`: React Native audiobook player with the same controls, background playback, and lock screen controls
- `audiobook-progress-sync`: Store and retrieve per-user playback position and completion status across sessions and devices

### Modified Capabilities

- `reading-progress`: Extend progress tracking to cover audiobook position (currentTime in seconds, completed chapters) alongside existing ebook progress

## Impact

- **API**: New `AudiobookModule`, new Prisma models (`AudiobookFile`, `AudiobookChapter`, `AudiobookProgress`, `AudiobookBookmark`); `Book` model gains `hasAudiobook`
- **Database**: New migration adding audiobook tables; `Book` table gains `hasAudiobook` column
- **Dependencies (API)**: `music-metadata` (audio tag extraction), custom `.cue` file parser
- **Dependencies (Mobile)**: `react-native-track-player` (background audio, lock screen controls, speed control)
- **Scanner**: `LibraryScannerService` gains audiobook detection and delegates to new `AudiobookScannerService`
- **Frontend**: Persistent bottom player bar; book detail page shows "Play Audiobook" button when audiobook is present
