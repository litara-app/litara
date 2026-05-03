## ADDED Requirements

### Requirement: Web app displays podcast episode library

The web app SHALL provide a `/podcasts` route (only visible when `podcastsEnabled` is true) that lists all subscriptions. Each subscription SHALL be expandable to show its episodes with title, published date, duration, and download status badge.

#### Scenario: Episode list renders subscription episodes

- **WHEN** a user navigates to a podcast subscription page
- **THEN** all episodes are listed with title, published date, duration, and a status badge (Downloaded / Not Downloaded / Downloading)

#### Scenario: Podcast route hidden when disabled

- **WHEN** `podcastsEnabled` is false
- **THEN** the `/podcasts` route is not accessible and the sidebar link is not rendered

### Requirement: Web app can play a downloaded podcast episode

The system SHALL allow users to play a downloaded episode in the web audio player. Clicking "Play" on a downloaded episode SHALL load the episode's audio file URL (served by the API) into the existing `AudioPlayer` component.

#### Scenario: Play downloaded episode

- **WHEN** a user clicks Play on a downloaded episode
- **THEN** the audio player loads and begins playing the episode's audio file

#### Scenario: Play button disabled for non-downloaded episode

- **WHEN** an episode has `downloadStatus` other than `downloaded`
- **THEN** the Play button is disabled or replaced with a download action

### Requirement: API serves podcast episode audio files

The system SHALL expose a protected endpoint `GET /api/v1/podcasts/episodes/:id/stream` that streams the downloaded audio file for a given episode. The endpoint SHALL return 404 if the episode is not downloaded.

#### Scenario: Stream downloaded episode

- **WHEN** an authenticated user requests the stream endpoint for a downloaded episode
- **THEN** the API streams the audio file with appropriate `Content-Type` and `Content-Length` headers, supporting HTTP Range requests

#### Scenario: Stream not-downloaded episode returns 404

- **WHEN** an authenticated user requests the stream endpoint for an episode with `downloadStatus` != `downloaded`
- **THEN** the API returns 404

### Requirement: Mobile app shows podcast tab when enabled

The mobile app SHALL show a "Podcasts" tab in the bottom tab bar only when `podcastsEnabled` is true. The tab SHALL contain a list of subscriptions and allow navigating to individual subscription episode lists.

#### Scenario: Podcasts tab visible when enabled

- **WHEN** the mobile app loads and `podcastsEnabled` is true
- **THEN** a "Podcasts" tab appears in the bottom navigation bar

#### Scenario: Podcasts tab hidden when disabled

- **WHEN** the mobile app loads and `podcastsEnabled` is false
- **THEN** no "Podcasts" tab is rendered in the bottom navigation bar

### Requirement: Mobile app can play a downloaded podcast episode

The system SHALL allow users to play a downloaded episode on mobile via `react-native-track-player`. Playing an episode SHALL replace the current RNTP queue with the episode track. Audiobook playback progress SHALL be saved before the queue is replaced.

#### Scenario: Play podcast episode on mobile

- **WHEN** a user taps Play on a downloaded episode
- **THEN** any current audiobook progress is saved, the RNTP queue is replaced with the episode track, and playback begins

#### Scenario: Episode track metadata displayed in player

- **WHEN** a podcast episode is playing on mobile
- **THEN** the RNTP notification and in-app player show the episode title and podcast show name

### Requirement: Playback progress is saved for podcast episodes

The system SHALL save playback progress for podcast episodes using the same `ReadingProgress` mechanism as audiobooks, identified by `episodeId`. Progress SHALL be restored when the user resumes an episode.

#### Scenario: Progress saved on pause

- **WHEN** a user pauses episode playback
- **THEN** the current position is saved to the backend

#### Scenario: Progress restored on resume

- **WHEN** a user opens an episode that has saved progress
- **THEN** playback resumes from the saved position
