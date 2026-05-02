## Implementation Notes

Audiobook playback is implemented using **`react-native-track-player` v5** (`5.0.0-alpha0`). v5 is pre-release and carries some instability risk, but was chosen over v4.x because it ships better compatibility with React Native 0.81 / Expo SDK 54 and exposes newer playback features. If stability issues arise, evaluate patching or pinning to a later alpha; do **not** downgrade to v4.x without first verifying that Expo SDK 54 support is available there.

## Requirements

### Requirement: Audiobook playback service is a singleton

The mobile audiobook player SHALL be backed by a singleton playback service registered before the React tree mounts, so that playback persists across screen navigation, screen unmount, and JS hot reloads.

#### Scenario: Playback survives navigating away from the player screen

- **WHEN** an audiobook is playing and the user navigates away from `AudiobookPlayerScreen`
- **THEN** playback continues uninterrupted
- **AND** the lock-screen / notification controls remain active and usable

#### Scenario: Re-entering the player screen attaches to the existing playback

- **WHEN** an audiobook is already playing and the user navigates back to the audiobook player for the same book
- **THEN** the screen reflects the current playback state (track, position, speed, play/pause status) without resetting the queue or restarting playback

#### Scenario: Opening a different audiobook replaces the queue

- **WHEN** an audiobook is playing and the user opens a different audiobook
- **THEN** the playback service resets the queue and loads the new audiobook's tracks
- **AND** the new audiobook resumes from its previously saved progress (or position 0 if none)

### Requirement: Lock-screen progress reflects total audiobook duration

The Android lock screen and notification tray SHALL display the audiobook's progress bar spanning the **total duration of all audio files in the audiobook**, not the duration of the currently-playing file.

#### Scenario: Multi-file audiobook on lock screen

- **WHEN** an audiobook composed of multiple audio files is playing
- **AND** the user views the Android lock screen or notification tray
- **THEN** the displayed total duration equals the sum of all file durations
- **AND** the displayed elapsed time equals the cumulative position from the start of the first file

#### Scenario: Single-file audiobook on lock screen

- **WHEN** an audiobook composed of a single audio file is playing
- **AND** the user views the Android lock screen or notification tray
- **THEN** the displayed total duration equals that file's duration
- **AND** the displayed elapsed time equals the current position within the file

### Requirement: Audiobook is loaded as a single queue

The playback service SHALL load every audio file of an audiobook into the underlying track player as a single queue, in `fileIndex` order, with deterministic per-track identifiers of the form `audiobook:<bookId>:<fileIndex>`.

#### Scenario: Queue construction from audiobook files

- **WHEN** the user opens an audiobook with N audio files
- **THEN** the playback service builds a queue containing exactly N tracks
- **AND** the tracks are ordered by ascending `fileIndex`
- **AND** each track carries the audiobook's title, joined authors, and cover artwork URL as metadata

#### Scenario: Queue identity check on re-open

- **WHEN** the user opens an audiobook
- **AND** the playback service's current queue's first track id is `audiobook:<bookId>:0`
- **THEN** the playback service does NOT reset the queue or interrupt playback

### Requirement: Auto-advance is handled natively

When a track in the queue finishes, the playback service SHALL advance to the next track without JS-side timers or manual `play()` deferrals.

#### Scenario: Track end advances to next track

- **WHEN** the current track plays to its end
- **AND** there is a next track in the queue
- **THEN** the next track begins playing automatically
- **AND** the lock-screen progress bar continues to advance against the cumulative audiobook duration without resetting to zero

#### Scenario: Last track end signals audiobook completion

- **WHEN** the last track in the queue plays to its end
- **THEN** the playback service emits a queue-ended signal
- **AND** the playback service writes a final progress record reflecting the audiobook's full duration

### Requirement: Cross-file seek operations preserve playing state

The playback service SHALL allow seeking to any absolute position within the audiobook by mapping the absolute target to a `(trackIndex, offsetInTrack)` pair and applying both atomically. If playback was active before the seek, it SHALL remain active after.

#### Scenario: Slider drag crosses a file boundary

- **WHEN** the user drags the in-app slider to a position that lies in a different file than the currently playing track
- **AND** playback was active before the drag completed
- **THEN** the playback service skips to the target track, seeks to the offset within that track, and continues playing without manual JS-side timers

#### Scenario: Chapter selection within the current file

- **WHEN** the user taps a chapter that belongs to the currently-playing track
- **THEN** the playback service seeks to the chapter's start within that track
- **AND** does NOT reset or rebuild the queue

### Requirement: Lock-screen controls offer 30-second skip

The Android notification / lock-screen SHALL expose seek-forward and seek-backward controls that jump 30 seconds, matching the in-app skip buttons.

#### Scenario: Lock-screen seek-forward button

- **WHEN** the user taps the seek-forward button on the lock screen during audiobook playback
- **THEN** playback advances 30 seconds in the absolute audiobook timeline
- **AND** the in-app slider, chapter highlight, and time labels reflect the new position when the screen is next visible

#### Scenario: Lock-screen seek-backward button

- **WHEN** the user taps the seek-backward button on the lock screen during audiobook playback
- **THEN** playback rewinds 30 seconds in the absolute audiobook timeline (clamped to 0 of the first track)

### Requirement: Progress is saved every 10 seconds while playing and on pause

The playback service SHALL persist progress every 10 seconds while playback is active, and SHALL persist progress whenever playback transitions from playing to paused or stopped. The persisted record SHALL contain `{ currentFileIndex, currentTime, totalDuration }` where `currentTime` is the position within `currentFileIndex` (not absolute), preserving the existing API contract.

#### Scenario: Periodic save while playing

- **WHEN** an audiobook is playing
- **THEN** the playback service writes progress to the server at approximately every 10 seconds of playback

#### Scenario: Save on pause

- **WHEN** an audiobook transitions from playing to paused
- **THEN** the playback service writes progress to the server within one playback-event cycle

#### Scenario: Save persists when the screen is unmounted

- **WHEN** the audiobook player screen is unmounted but playback continues from the lock screen
- **THEN** periodic and pause-driven saves still occur

### Requirement: Offline progress is queued and flushed on foreground

If a progress save fails (e.g., network unavailable), the playback service SHALL persist the progress record locally and SHALL retry the flush the next time the application enters the active foreground state.

#### Scenario: Save fails while offline

- **WHEN** a progress save HTTP request fails
- **THEN** the record is written to AsyncStorage under `litara-audiobook-progress-pending-<bookId>`
- **AND** is NOT lost when the app is suspended or relaunched

#### Scenario: Pending save is flushed on foreground

- **WHEN** the app transitions to the active foreground state
- **AND** a pending progress record exists in AsyncStorage
- **THEN** the playback service attempts to send it to the server
- **AND** removes it from AsyncStorage on success
- **AND** restores it to AsyncStorage on failure (so a future foreground transition retries)

### Requirement: Playback rate is configurable and persisted

The audiobook player SHALL expose playback rates of 0.5×, 1.0×, 1.5×, and 2.0×. The selected rate SHALL persist across app launches.

#### Scenario: User cycles speed

- **WHEN** the user taps the speed control
- **THEN** the rate cycles through 0.5×, 1.0×, 1.5×, 2.0× and back to 0.5×
- **AND** the new rate is applied to the currently-playing audiobook immediately
- **AND** the new rate is written to AsyncStorage under `litara-audiobook-speed`

#### Scenario: Rate is restored on next launch

- **WHEN** the user opens an audiobook in a new app launch
- **AND** a previously-saved rate exists in AsyncStorage
- **THEN** the audiobook plays at that rate

### Requirement: Source resolution prefers downloaded files over streaming

When loading the audiobook queue, the playback service SHALL use locally-downloaded files when all of the audiobook's files are present on disk; otherwise it SHALL use the streaming URL with an issued stream token.

#### Scenario: All files downloaded — use local

- **WHEN** every file of an audiobook exists at its expected local path
- **THEN** the queue's track URLs point at the local file paths
- **AND** no stream token is requested

#### Scenario: Files not downloaded — use stream

- **WHEN** at least one file of an audiobook is missing locally
- **THEN** the playback service issues a stream token
- **AND** the queue's track URLs are streaming URLs incorporating that token

### Requirement: Chapter highlighting and auto-scroll continue to work

The in-app player UI SHALL highlight the chapter containing the current absolute position, and the chapter list SHALL auto-scroll to keep the active chapter visible.

#### Scenario: Active chapter changes during playback

- **WHEN** playback advances past a chapter boundary (in the same file or by crossing a track boundary)
- **THEN** the active chapter highlight updates to the new chapter
- **AND** the chapter list scrolls so the active chapter is visible

### Requirement: Returning to the player screen mid-playback shows live state

When the user navigates back to `AudiobookPlayerScreen` while playback is in progress, the screen SHALL render the active track's title, the absolute position, the play/pause state, and the active chapter without re-loading the queue or restarting playback.

#### Scenario: Re-mount during playback

- **WHEN** an audiobook is playing
- **AND** the user navigates back to the player screen
- **THEN** the slider, time labels, chapter highlight, and play/pause icon reflect the current playback state within one render cycle
- **AND** no additional network requests are issued for queue setup
