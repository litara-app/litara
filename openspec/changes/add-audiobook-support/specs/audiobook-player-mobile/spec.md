## ADDED Requirements

### Requirement: React Native player uses react-native-track-player with direct streaming

The system SHALL implement the audiobook player in `apps/mobile` using `react-native-track-player` (RNTP) to load and play audio files via direct HTTP Range-based streaming. Authentication uses a short-lived stream token issued by `POST /api/v1/audiobooks/stream-token`. RNTP's `Track` queue SHALL be populated with one entry per `AudiobookFile`, in `fileIndex` order, with each track URL set to `GET /api/v1/audiobooks/:bookId/files/:fileIndex/stream?streamToken=<token>`.

#### Scenario: Player loads audiobook tracks on open

- **WHEN** the user opens the audiobook player for a book
- **THEN** a stream token is fetched via JWT-authenticated `POST /api/v1/audiobooks/stream-token`
- **THEN** RNTP's queue is reset and populated with one track per `AudiobookFile`, each track's URL pointing to the direct stream endpoint with the stream token as a query parameter

#### Scenario: Player resumes at saved position on open

- **WHEN** an `AudiobookProgress` record exists for the user and book
- **THEN** RNTP skips to `currentFileIndex` and seeks to `currentTime` before starting playback

---

### Requirement: Background audio playback

The system SHALL support background audio playback so the user can navigate away from the player screen without interrupting playback.

#### Scenario: Audio continues when app is backgrounded

- **WHEN** the user presses the home button or switches to another app while audio is playing
- **THEN** audio continues playing

#### Scenario: Lock screen controls are functional

- **WHEN** audio is playing with the device screen locked
- **THEN** the lock screen shows the book title, author, cover art, and play/pause, previous chapter, and next chapter buttons

---

### Requirement: Speed control at 0.5x increments on mobile

The system SHALL provide playback speed control via RNTP's `rate` property, with the same steps as the web player (0.5×, 1.0×, 1.5×, 2.0×). The selected speed SHALL persist via `AsyncStorage`.

#### Scenario: Speed changes apply to active playback

- **WHEN** the user selects a speed on the mobile player
- **THEN** `TrackPlayer.setRate(speed)` is called and playback rate changes immediately

#### Scenario: Speed preference persisted across app restarts

- **WHEN** the app is restarted and the player is opened
- **THEN** the last selected speed is restored from `AsyncStorage`

---

### Requirement: Chapter navigation on mobile

The system SHALL display a scrollable chapter list and allow the user to jump to any chapter. The active chapter SHALL be highlighted based on current playback position.

#### Scenario: Tapping a chapter seeks to its start time

- **WHEN** the user taps a chapter in the chapter list
- **THEN** RNTP skips to the appropriate track index and seeks to `startTime` within that track

#### Scenario: Chapter list scrolls to active chapter

- **WHEN** the audiobook advances to a new chapter during playback
- **THEN** the chapter list automatically scrolls to keep the active chapter visible

---

### Requirement: Seek bar with chapter markers on mobile

The system SHALL render a seek bar with the current position, total duration, and visual tick marks at chapter boundaries.

#### Scenario: Seek bar reflects current position during playback

- **WHEN** audio is playing
- **THEN** the seek bar thumb position updates at regular intervals to reflect `TrackPlayer.getProgress().position`

#### Scenario: Dragging seek bar changes playback position

- **WHEN** the user drags the seek bar thumb to a new position
- **THEN** `TrackPlayer.seekTo(newPosition)` is called with the proportional time
