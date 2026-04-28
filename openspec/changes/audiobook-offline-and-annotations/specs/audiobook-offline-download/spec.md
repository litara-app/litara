## ADDED Requirements

### Requirement: Download all audiobook files for offline playback

The mobile app SHALL allow the user to download all `AudiobookFile` records for a book to persistent device storage (`FileSystem.documentDirectory/audiobooks/<bookId>/<fileIndex>.<ext>`). Files are downloaded sequentially in `fileIndex` order using the JWT-authenticated download endpoint (`GET /api/v1/audiobooks/:bookId/files/:fileIndex/download`). Per-file completion is persisted to AsyncStorage after each file so that an interrupted download resumes from the first missing file.

#### Scenario: Initiate download from player screen

- **WHEN** the user taps "Download for offline" in `AudiobookPlayerScreen`
- **THEN** the app begins downloading files sequentially, showing a progress indicator with "File N of M — X%"
- **AND** the download status in AsyncStorage is set to `downloading`

#### Scenario: Download completes successfully

- **WHEN** all files for the book have been downloaded
- **THEN** the download status in AsyncStorage is set to `downloaded`
- **AND** the UI shows a "Downloaded" indicator with a delete option

#### Scenario: Download resumes after interruption

- **WHEN** the app is killed or loses connectivity mid-download and the user reopens the player
- **THEN** the download resumes from the first file not yet present on disk, not from the beginning

#### Scenario: Download requires authentication

- **WHEN** downloading a file
- **THEN** the request includes the user's JWT as a Bearer token in the Authorization header

---

### Requirement: Player uses local files when all files are downloaded

When `AudiobookPlayerScreen` opens, the app SHALL check whether all `AudiobookFile` records for the book are present locally using `FileSystem.getInfoAsync`. If all files exist, the player SHALL construct `file://` URIs directly and skip the stream-token fetch entirely. If any file is missing, the player SHALL fall back to the standard stream-token + HTTP URL flow.

#### Scenario: All files cached — player starts offline

- **WHEN** the user opens the audiobook player and all files are downloaded and the device has no network connection
- **THEN** playback begins using local `file://` URIs without attempting any network requests for audio data

#### Scenario: Partial download — player falls back to streaming

- **WHEN** the user opens the audiobook player and one or more files are not present locally
- **THEN** the player fetches a stream token and uses HTTP stream URLs for all files

#### Scenario: Online playback unaffected when files are not downloaded

- **WHEN** no files are downloaded for a book
- **THEN** the player behaves identically to the pre-download-feature behavior

---

### Requirement: Delete cached download

The user SHALL be able to delete all locally cached files for a book from `AudiobookPlayerScreen`. Deletion removes all files under `documentDirectory/audiobooks/<bookId>/` and clears the AsyncStorage download state for that book.

#### Scenario: Delete downloaded audiobook

- **WHEN** the user taps "Delete download" on a fully downloaded book
- **THEN** all local audio files for that book are deleted
- **AND** the AsyncStorage download status is reset to `not-downloaded`
- **AND** the UI returns to showing the "Download for offline" button

#### Scenario: Delete during active download

- **WHEN** the user taps "Delete download" while a download is in progress
- **THEN** the in-progress download is cancelled
- **AND** any already-downloaded files for that book are removed

---

### Requirement: Offline progress sync on reconnect

Every progress save (10-second playback tick, pause event, player unmount) SHALL write the current position to AsyncStorage under `litara-audiobook-progress-pending-<bookId>` before attempting the API PUT. If the PUT call fails due to network unavailability, the pending key remains. When the app returns to the foreground (`AppState` change) or network connectivity is restored (via `expo-network`), the app SHALL detect any pending keys and flush them to `PUT /api/v1/audiobooks/:bookId/progress`.

#### Scenario: Progress saved locally when offline

- **WHEN** the user pauses playback while offline
- **THEN** the current position is written to AsyncStorage immediately
- **AND** the API PUT is attempted but silently fails
- **AND** the pending-sync key remains in AsyncStorage

#### Scenario: Progress flushed on reconnect

- **WHEN** the device regains network connectivity after an offline session
- **THEN** the app detects the pending-sync key and calls `PUT /api/v1/audiobooks/:bookId/progress` with the saved position
- **AND** the pending-sync key is cleared after a successful API response

#### Scenario: Progress flushed on app foreground

- **WHEN** the user backgrounds the app while offline and later brings it to the foreground with network available
- **THEN** the pending-sync key is detected via the `AppState` listener and flushed to the API

#### Scenario: No duplicate flush

- **WHEN** both the `AppState` listener and the `NetInfo` listener fire in quick succession
- **THEN** the progress is sent to the API only once (guarded by clearing the pending key before the second flush fires)
