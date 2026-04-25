## ADDED Requirements

### Requirement: Web audiobook player renders when audiobook is present

The system SHALL display an audiobook player on the Book detail page when the book has at least one associated `AudiobookFile`. When both an ebook and audiobook exist, the detail page SHALL show a "Read" / "Listen" toggle.

#### Scenario: Listen tab shown for book with audiobook

- **WHEN** the user navigates to a Book detail page for a book that has `hasAudiobook: true`
- **THEN** a "Listen" tab or toggle is visible alongside the existing book details

#### Scenario: Read/Listen toggle switches between ebook reader and audio player

- **WHEN** the user clicks the "Listen" toggle on a book that has both an ebook file and an audiobook
- **THEN** the audiobook section shows a "Play Audiobook" button

---

### Requirement: Range-based audio streaming

The system SHALL stream audio files directly via HTTP Range requests. A short-lived stream token (`?streamToken=<token>`) SHALL be used to authenticate the `<audio>` element without embedding the user's JWT in the URL.

#### Scenario: Stream token fetched on player open

- **WHEN** the user activates the audiobook player
- **THEN** a stream token is fetched via `POST /api/v1/audiobooks/stream-token` and used to construct the audio src URL

#### Scenario: Audio element uses Range-based streaming

- **WHEN** the player loads an audiobook file
- **THEN** the `<audio>` element's `src` is set to `/api/v1/audiobooks/:bookId/files/:fileIndex/stream?streamToken=<token>` and the browser handles range requests natively

---

### Requirement: Speed control at 0.5x increments

The system SHALL provide playback speed control with steps at 0.5×, 1.0×, 1.5×, and 2.0×. The selected speed SHALL persist in `localStorage` across sessions.

#### Scenario: Speed buttons cycle through available rates

- **WHEN** the user clicks the speed control button
- **THEN** the speed cycles through [0.5, 1.0, 1.5, 2.0] and wraps back to 0.5 after 2.0

#### Scenario: Selected speed applied to audio playback

- **WHEN** the speed is changed
- **THEN** `audioElement.playbackRate` is set to the selected value immediately

#### Scenario: Speed preference persisted across page loads

- **WHEN** the user selects a speed and later reopens the player
- **THEN** the previously selected speed is restored from `localStorage`

---

### Requirement: Chapter list navigation

The system SHALL display a chapter list panel showing all chapters across all files of the audiobook. Clicking a chapter SHALL seek the player to that chapter's start time.

#### Scenario: Chapter list displays all chapters

- **WHEN** the audiobook player is open
- **THEN** a chapter list shows each chapter's title and formatted timestamp (HH:MM:SS)

#### Scenario: Current chapter is highlighted

- **WHEN** the audio is playing
- **THEN** the chapter whose `startTime` is closest to and not exceeding the current playback position is highlighted in the chapter list

#### Scenario: Clicking a chapter seeks to its start time

- **WHEN** the user clicks a chapter in the list
- **THEN** playback jumps to that chapter's `startTime` within the appropriate file

---

### Requirement: Keyboard shortcuts for player controls

The player SHALL support the following keyboard shortcuts when focused:

| Key               | Action                           |
| ----------------- | -------------------------------- |
| Space             | Toggle play/pause                |
| ← / →             | Seek backward/forward 10 seconds |
| Shift+← / Shift+→ | Previous / next chapter          |

#### Scenario: Spacebar toggles play/pause

- **WHEN** the player is focused and the user presses Space
- **THEN** playback toggles between playing and paused

#### Scenario: Arrow keys seek 10 seconds

- **WHEN** the player is focused and the user presses ← or →
- **THEN** the current playback position changes by −10 or +10 seconds respectively

---

### Requirement: Progress bar with scrubbing

The system SHALL render a seekable progress bar showing elapsed time, remaining time, and chapter markers as tick marks.

#### Scenario: Progress bar updates during playback

- **WHEN** audio is playing
- **THEN** the progress bar thumb moves in real time to reflect current position

#### Scenario: Clicking progress bar seeks to position

- **WHEN** the user clicks or drags on the progress bar
- **THEN** playback position is set to the proportional time within the total audiobook duration
