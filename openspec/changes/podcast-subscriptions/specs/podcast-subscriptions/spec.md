## ADDED Requirements

### Requirement: User can subscribe to a podcast via RSS URL

The system SHALL allow authenticated users to add a podcast subscription by providing an RSS 2.0 or Atom feed URL. On subscription, the system SHALL immediately fetch and parse the feed to populate the podcast title, description, artwork URL, and episode list.

#### Scenario: Successful subscription

- **WHEN** a user submits a valid RSS/Atom feed URL
- **THEN** the system creates a `Podcast` record with title, description, and artwork parsed from the feed, and returns it to the caller

#### Scenario: Invalid or unreachable feed URL

- **WHEN** a user submits a URL that is unreachable or does not return a valid RSS/Atom feed
- **THEN** the system returns a descriptive error and does not create a subscription

#### Scenario: Duplicate subscription

- **WHEN** a user submits a feed URL that is already subscribed
- **THEN** the system returns an error indicating the subscription already exists

### Requirement: User can view all subscriptions

The system SHALL provide an endpoint and UI that lists all podcast subscriptions with their title, artwork, episode count, and last-refreshed timestamp.

#### Scenario: List subscriptions

- **WHEN** a user requests their podcast subscription list
- **THEN** the system returns all subscriptions ordered by title with metadata

### Requirement: User can edit per-subscription settings

The system SHALL allow users to update per-subscription settings: `refreshIntervalMinutes` (minimum 15, maximum 10080 = 1 week), `downloadPolicy` (`all`, `latestN`, `manual`), `keepLatestN` (integer, required when policy is `latestN`), and `retentionPolicy` (`keepAll`, `deleteAfterListened`, `keepLatestN`).

#### Scenario: Update download policy

- **WHEN** a user changes the download policy for a subscription to `latestN` and sets `keepLatestN = 5`
- **THEN** the system saves the settings and applies them on the next scheduled refresh

#### Scenario: Invalid refresh interval

- **WHEN** a user sets a refresh interval below 15 minutes
- **THEN** the system returns a validation error

### Requirement: User can unsubscribe from a podcast

The system SHALL allow users to delete a subscription. Deleting a subscription SHALL remove the `Podcast` record and all associated `PodcastEpisode` records. Downloaded files on disk SHALL be deleted. Active downloads SHALL be cancelled before deletion.

#### Scenario: Unsubscribe removes data

- **WHEN** a user unsubscribes from a podcast
- **THEN** the subscription, episodes, and downloaded audio files are permanently removed

#### Scenario: Unsubscribe cancels active download

- **WHEN** a user unsubscribes while an episode is actively downloading
- **THEN** the download is cancelled and the partial file is deleted

### Requirement: Subscription stores parsed feed metadata

Each `Podcast` record SHALL store: `feedUrl`, `title`, `description`, `artworkUrl`, `author`, `websiteUrl`, `lastRefreshedAt`, `refreshIntervalMinutes`, `downloadPolicy`, `keepLatestN`, `retentionPolicy`.

#### Scenario: Feed metadata persisted

- **WHEN** a podcast is subscribed or refreshed
- **THEN** the latest title, description, and artwork from the feed are stored in the database
