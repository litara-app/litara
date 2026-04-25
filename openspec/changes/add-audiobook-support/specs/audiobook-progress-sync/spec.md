## ADDED Requirements

### Requirement: Playback position save endpoint

The system SHALL expose `PUT /api/v1/audiobooks/:bookId/progress` that upserts an `AudiobookProgress` record for the authenticated user, storing `currentFileIndex`, `currentTime`, and optional `completedAt`.

#### Scenario: Progress upserted for authenticated user

- **WHEN** a `PUT /api/v1/audiobooks/:bookId/progress` request is made with `{ currentFileIndex: 1, currentTime: 432.5 }`
- **THEN** the `AudiobookProgress` record for the user/book pair is created or updated
- **THEN** the endpoint returns the updated progress record

#### Scenario: Completing the last chapter marks audiobook as done

- **WHEN** `PUT /api/v1/audiobooks/:bookId/progress` is called with `currentTime` within 30 seconds of the total duration of the last file
- **THEN** `AudiobookProgress.completedAt` is set to the current timestamp

---

### Requirement: Playback position retrieval endpoint

The system SHALL expose `GET /api/v1/audiobooks/:bookId/progress` that returns the current `AudiobookProgress` for the authenticated user, or `null` if no progress exists.

#### Scenario: Progress returned for existing record

- **WHEN** an authenticated user requests `GET /api/v1/audiobooks/:bookId/progress` and a progress record exists
- **THEN** the endpoint returns `{ currentFileIndex, currentTime, totalDuration, completedAt, updatedAt }`

#### Scenario: Null returned when no progress exists

- **WHEN** an authenticated user requests progress for a book they have never listened to
- **THEN** the endpoint returns `{ progress: null }` with status `200`

---

### Requirement: Periodic progress auto-save during playback

The web and mobile players SHALL automatically save playback progress to the API every 10 seconds during active playback, and immediately on pause or player close.

#### Scenario: Progress saved every 10 seconds during playback

- **WHEN** audio is playing continuously
- **THEN** `PUT /api/v1/audiobooks/:bookId/progress` is called at most once per 10-second interval with the current position

#### Scenario: Progress saved immediately on pause

- **WHEN** the user pauses playback
- **THEN** `PUT /api/v1/audiobooks/:bookId/progress` is called immediately with the paused position

#### Scenario: Progress saved on player close or navigation away

- **WHEN** the user closes the player or navigates away from the player screen (web or mobile)
- **THEN** `PUT /api/v1/audiobooks/:bookId/progress` is called with the last known position before unload

---

### Requirement: Cross-device progress sync

The system SHALL serve the latest saved progress to any device the user authenticates on, allowing seamless continuation across web and mobile.

#### Scenario: Mobile player resumes at position saved on web

- **WHEN** a user was listening on the web at position X and opens the mobile player for the same book
- **THEN** the mobile player loads progress from `GET /api/v1/audiobooks/:bookId/progress` and offers to resume from position X

#### Scenario: Conflicts resolved by most-recent timestamp

- **WHEN** two devices have saved different positions for the same book
- **THEN** the server stores the most recently updated position (determined by `updatedAt`) and serves it to both devices
