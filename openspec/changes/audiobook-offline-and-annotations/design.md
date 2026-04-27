## Context

The audiobook feature (add-audiobook-support) is fully implemented. It introduced a separate `AudiobookBookmark` Prisma model, dedicated bookmark endpoints (`GET/POST/DELETE /api/v1/audiobooks/:bookId/bookmarks`), and a bookmark panel in the web player. The mobile player (`AudiobookPlayerScreen.tsx`) uses `expo-audio` (not `react-native-track-player` as originally scoped) and streams files over HTTP at runtime.

There is no offline support anywhere. The `Annotation` table already exists with a `type` enum that includes `BOOKMARK`, used for ebook reader bookmarks.

## Goals / Non-Goals

**Goals:**

- Allow mobile users to download audiobook files to persistent device storage and play them without network access
- Replace `AudiobookBookmark` with `Annotation` records so that audiobook bookmarks surface on the Annotations page and respect future annotation filtering and UI

**Non-Goals:**

- Offline download on the web player
- Offline download of ebook files
- Syncing download state across devices (downloads are per-device)
- Streaming token refresh while playing from local files (no token needed for local playback)

## Decisions

### Decision: expo-file-system for downloads, document directory for storage

`expo-file-system` is already available in the Expo SDK at the version in use. `FileSystem.downloadAsync` supports custom request headers (needed to attach the JWT) and returns a result object with the local URI. Files are stored in `FileSystem.documentDirectory + 'audiobooks/<bookId>/<fileIndex>.<ext>'` so they persist indefinitely until the user explicitly deletes them or uninstalls the app.

**Alternative considered**: Cache directory (`FileSystem.cacheDirectory`). Rejected because the OS can evict cached files at any time, which would silently break offline playback.

### Decision: AsyncStorage tracks download state, no API involvement

Download state (per-book status: `not-downloaded | downloading | downloaded`, plus per-file completion flags) is tracked in AsyncStorage under `litara-audiobook-dl-<bookId>`. There is no server-side record of what a device has cached.

**Alternative considered**: Track in the API as a new `DeviceDownload` model. Rejected — download state is entirely client-local. Keeping it off the server simplifies the scope and avoids leaking device identifiers.

### Decision: Player resolves file URI before issuing stream token

When `AudiobookPlayerScreen` opens, it checks each file's local path with `FileSystem.getInfoAsync`. If **all** files for the book are present locally, it builds `file://` URIs directly and skips the stream-token fetch. If any file is missing it falls back to the current stream-token + URL flow. Partial downloads do not enable offline mode — the player only switches to local URIs when the full book is cached.

**Alternative considered**: Always fetch a stream token and have the server redirect to a local URL. Impractical — the server cannot know about on-device file paths.

### Decision: Multi-file downloads run sequentially, resumable from last incomplete file

Each `AudiobookFile` record for a book is downloaded in `fileIndex` order to `FileSystem.documentDirectory + 'audiobooks/<bookId>/<fileIndex>.<ext>'`. Per-file completion is written to AsyncStorage after each successful file so that if the app is killed mid-download the next attempt resumes from the first missing file rather than restarting the whole book. Progress UI shows "File N of M — X%".

**Alternative considered**: Parallel downloads. Rejected — sequential is simpler to implement correctly, avoids saturating a slow connection, and audiobooks are background-friendly so wall-clock time is not critical.

### Decision: Offline progress uses a two-layer write (AsyncStorage first, then API)

Every progress save (10-second tick, pause, player close) writes the position to AsyncStorage under `litara-audiobook-progress-pending-<bookId>` before attempting the API PUT. If the PUT succeeds, the pending key is cleared. If it fails (offline), the key remains. An `AppState` `change→active` listener and a `NetInfo` connectivity listener both check for pending keys on reconnect and flush them. This ensures no position data is lost during offline listening.

**Alternative considered**: Fire-and-forget API call with no local backup. Already the current behavior — rejected because a 1-hour offline session would lose all progress saves silently.

### Decision: Download UI lives in the audiobook player screen

A "Download for offline" button with a progress indicator is added to `AudiobookPlayerScreen`. There is no separate download management screen. The user can also delete the cached download from the same screen.

**Alternative considered**: Separate download management screen reachable from book detail. Rejected — the added navigation complexity is not worth it for v1. The player screen is where the user already interacts with the audiobook.

### Decision: Audiobook bookmarks use type BOOKMARK with location `audiobook:<fileIndex>:<timestamp>`

The existing `Annotation.location` field is a free-form string. Ebook bookmarks use CFI strings (e.g., `epubcfi(/6/4[chap01ref]!/4[body01]/10[para05]/2/1:3)`). Audiobook bookmarks use a prefixed format `audiobook:<fileIndex>:<timestamp>` (e.g., `audiobook:0:432.5`). The `audiobook:` prefix makes the type detectable at the client without querying a separate model; CFI strings never start with `audiobook:`.

**Alternative considered**: JSON encoding `{"audiobook":true,"fileIndex":0,"timestamp":432.5}`. Rejected — more verbose, harder to read in the DB, no practical benefit over a delimited string for two numeric fields.

**Alternative considered**: A dedicated `audiobook_timestamp` column on `Annotation`. Rejected — schema changes are heavier and unnecessary when the location string encoding is unambiguous.

### Decision: Migrate AudiobookBookmark rows in a Prisma migration, then drop the table

The migration script copies each `AudiobookBookmark` row into `Annotation` (`type=BOOKMARK`, `location=audiobook:<fileIndex>:<timestamp>`, `note=note`, `text=NULL`, `color=NULL`), then drops the `AudiobookBookmark` table. The three bookmark API endpoints are removed in the same PR.

**Alternative considered**: Soft-deprecate the old endpoints and run both in parallel. Rejected — parallel code paths increase maintenance burden and the migration is straightforward with no risk of data loss if run in a transaction.

## Risks / Trade-offs

- **Storage consumption on device** → Users may fill device storage with downloaded audiobooks. Mitigated by showing the file size before downloading and allowing per-book deletion.
- **Download interrupted mid-way** → If the app is killed during a multi-file download, some files will be present and others absent. Mitigated by tracking per-file completion in AsyncStorage and resuming from the first incomplete file on next attempt.
- **Migration irreversibility** → Once `AudiobookBookmark` is dropped, the old bookmark endpoints return 404. Any client older than this release will fail silently when it tries to save a bookmark. Mitigated by shipping the web and mobile player changes in the same release as the API change.

## Migration Plan

1. Write a Prisma migration that:
   a. Copies `AudiobookBookmark` rows → `Annotation` (as BOOKMARK type with `audiobook:` location prefix)
   b. Drops the `AudiobookBookmark` table
2. Remove the three bookmark API endpoints and the `AudiobookBookmarkResponseDto`
3. Update web `AudiobookPlayer.tsx` bookmark panel to use annotation endpoints
4. Update mobile `AudiobookPlayerScreen.tsx` bookmark button to use annotation endpoints
5. Add download UI to `AudiobookPlayerScreen.tsx`
6. Add `audiobook-offline-download` API module (download endpoint already exists at task 5.3)

**Rollback**: Restore the migration (re-create table from git history) and revert controller/component changes. Data written as `Annotation` rows after the migration would need to be manually back-ported, but since this is the initial migration there should be no production window where both schemas exist simultaneously.
